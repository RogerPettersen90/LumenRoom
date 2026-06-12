import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalogStore } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";
import { buildCanvasMenu } from "@/features/library/menus";
import { fullUrl, maskUrl, previewUrl } from "@/api/protocol";
import { useZoomStore } from "@/store/zoomStore";
import { NEUTRAL_EDIT } from "@/types/models";
import { DevelopRenderer } from "./gl/Renderer";
import { histogramBus } from "./histogram/histogramBus";
import { CropOverlay } from "./CropOverlay";
import { MaskOverlay } from "./MaskOverlay";
import { SpotOverlay } from "./SpotOverlay";
import { InfoOverlay } from "@/components/InfoOverlay";
import { ZoomPane } from "@/components/ZoomPane";

/**
 * The Develop preview surface, rendered on the GPU.
 *
 * A ~2048px upright proxy of the unedited original (lazily baked + cached by
 * the backend, served over lumen://preview) is uploaded once as a WebGL
 * texture; every slider change re-runs the adjustment fragment shader — full
 * interactive feedback with zero CPU pixel work and no IPC round-trip.
 *
 * In crop mode the shader ignores the crop window (full straightened frame)
 * and the CropOverlay draws the interactive rect on top.
 *
 * The histogram read-back (gl.readPixels of the whole proxy) is throttled, so
 * the per-frame GPU draw stays smooth while dragging while the histogram still
 * refreshes several times a second.
 */
const HISTOGRAM_THROTTLE_MS = 100;

export function ImageCanvas() {
  const imageId = useDevelopStore((s) => s.imageId);
  const liveParams = useDevelopStore((s) => s.params);
  const cropMode = useDevelopStore((s) => s.cropMode);
  const showBefore = useDevelopStore((s) => s.showBefore);
  const maskOverlay = useDevelopStore((s) => s.maskOverlay);
  const activeMaskIndex = useDevelopStore((s) => s.activeMaskIndex);
  const maskDraft = useDevelopStore((s) => s.maskDraft);
  const spotTool = useDevelopStore((s) => s.spotTool);
  const showClipping = useDevelopStore((s) => s.showClipping);
  const image = useCatalogStore((s) => (imageId ? s.byId[imageId] : null));

  // Before/After (Y): show the unedited original but keep the geometry, so
  // the framing doesn't jump while comparing.
  const params = showBefore
    ? {
        ...NEUTRAL_EDIT,
        cropX: liveParams.cropX,
        cropY: liveParams.cropY,
        cropW: liveParams.cropW,
        cropH: liveParams.cropH,
        angle: liveParams.angle,
      }
    : liveParams;

  // The overlay needs the live element, so track it in state (not just a ref).
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [contentSize, setContentSize] = useState({ w: 1, h: 1 });
  const rendererRef = useRef<DevelopRenderer | null>(null);
  const histTimer = useRef<number | null>(null);

  // Resolution tier: the 2048px proxy normally, the native-res 1:1 once the
  // user zooms past 100% of the proxy (mirrors the Library Loupe's swap, so
  // Develop sharpness matches what culling showed).
  const zoomScale = useZoomStore((s) => s.scale);
  const [tier, setTier] = useState<"std" | "full">("std");
  const texW = useRef(0); // current texture width (for the no-jump rescale)
  const upgradeFor = useRef<string | null>(null); // image id with an in-flight 1:1 load

  // Keep React in sync with the canvas's pixel size (changes with crop).
  const syncContentSize = useCallback((c: HTMLCanvasElement | null) => {
    if (!c) return;
    setContentSize((prev) =>
      prev.w === c.width && prev.h === c.height ? prev : { w: c.width, h: c.height }
    );
  }, []);

  // Coalesce histogram read-backs to at most one per throttle window.
  const scheduleHistogram = useCallback(() => {
    if (histTimer.current != null) return;
    histTimer.current = window.setTimeout(() => {
      histTimer.current = null;
      const renderer = rendererRef.current;
      if (renderer) histogramBus.publish(renderer.computeHistogram());
    }, HISTOGRAM_THROTTLE_MS);
  }, []);

  // Create the WebGL renderer once per canvas element.
  useEffect(() => {
    if (!canvasEl) return;
    try {
      rendererRef.current = new DevelopRenderer(canvasEl);
    } catch (e) {
      console.error("WebGL init failed:", e);
    }
    return () => {
      if (histTimer.current != null) window.clearTimeout(histTimer.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [canvasEl]);

  // (Re)load the texture whenever the open image changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !image || !image.thumbReady) return;

    setTier("std"); // new photo starts back on the fast proxy
    upgradeFor.current = null;
    const img = new Image();
    img.crossOrigin = "anonymous"; // lumen:// sends ACAO:* so the texture stays untainted
    img.onload = () => {
      texW.current = img.naturalWidth;
      renderer.setImage(img);
      const s = useDevelopStore.getState();
      renderer.render(s.params, { fullFrame: s.cropMode, clip: s.showClipping, maskView: s.maskOverlay || s.maskDraft ? s.activeMaskIndex : -1 });
      syncContentSize(canvasEl);
      histogramBus.publish(renderer.computeHistogram()); // immediate on load
    };
    img.onerror = () => console.warn("failed to load develop proxy");
    img.src = previewUrl(image.id);
  }, [image?.id, image?.thumbReady, canvasEl, syncContentSize]);

  // Upgrade the texture to the 1:1 preview (native res; full demosaic when
  // the pref is on) shortly after the photo opens — classic-editor loads 1:1 in Develop
  // too. The brief delay keeps rapid filmstrip stepping on the cheap proxy.
  // Capped to the GPU's max texture edge via an offscreen downscale.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !image?.thumbReady) return;
    if (tier === "full") return;

    if (upgradeFor.current === image.id) return; // already loading

    let cancelled = false;
    const delay = window.setTimeout(() => {
      if (cancelled) return;
      startUpgrade();
    }, 350);

    const startUpgrade = () => {
    upgradeFor.current = image.id; // guard double loads; the badge waits
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const r = rendererRef.current;
      if (cancelled || !r) return;
      let source: HTMLImageElement | HTMLCanvasElement = img;
      let w = img.naturalWidth;
      const maxTex = r.maxTextureSize();
      if (Math.max(img.naturalWidth, img.naturalHeight) > maxTex) {
        const k = maxTex / Math.max(img.naturalWidth, img.naturalHeight);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        source = c;
        w = c.width;
      }
      // No visual jump: the content is higher-res now, so a numeric zoom
      // shrinks by the resolution ratio (same trick as the Loupe swap).
      const z = useZoomStore.getState();
      if (texW.current > 0 && typeof z.mode === "number") {
        z.setMode(z.mode * (texW.current / w));
      }
      texW.current = w;
      r.setImage(source);
      const s = useDevelopStore.getState();
      r.render(s.params, { fullFrame: s.cropMode, clip: s.showClipping, maskView: s.maskOverlay || s.maskDraft ? s.activeMaskIndex : -1 });
      syncContentSize(canvasEl);
      histogramBus.publish(r.computeHistogram());
      setTier("full"); // badge turns on only once true pixels are showing
    };
    img.onerror = () => {
      if (!cancelled) upgradeFor.current = null; // allow a retry
    };
    img.src = fullUrl(image.id);
    };

    return () => {
      cancelled = true;
      window.clearTimeout(delay);
    };
  }, [zoomScale, tier, image?.id, image?.thumbReady, canvasEl, syncContentSize]);

  // Raster mask preview: keep texture unit 3 holding the first raster mask's
  // weight map (one map in the live preview; exports render them all). A
  // brush-painting session (rasterDraft) takes priority — it IS the live map.
  const rasterDraft = useDevelopStore((s) => s.rasterDraft);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const draftIdx = params.masks
      .slice(0, 4)
      .findIndex((m) => m.kind === "raster" && m.rasterId === "");
    if (rasterDraft && draftIdx >= 0) {
      const key = `draft-${rasterDraft.version}`;
      if (renderer.rasterKey === key) return;
      const img = new Image();
      img.onload = () => {
        const r = rendererRef.current;
        if (!r) return;
        r.setRasterMask(img, draftIdx, key);
        const s = useDevelopStore.getState();
        r.render(s.params, { fullFrame: s.cropMode, clip: s.showClipping, maskView: s.maskOverlay || s.maskDraft ? s.activeMaskIndex : -1 });
        scheduleHistogram();
      };
      img.src = rasterDraft.dataUrl; // data: URL — same-origin, no CORS needed
      return;
    }
    const idx = params.masks
      .slice(0, 4)
      .findIndex((m) => m.kind === "raster" && m.rasterId !== "");
    const key = idx >= 0 ? params.masks[idx].rasterId : "";
    if (renderer.rasterKey === key) return;
    if (idx < 0) {
      renderer.setRasterMask(null, -1, "");
      renderer.render(params, { fullFrame: cropMode, clip: showClipping });
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const r = rendererRef.current;
      if (!r) return;
      r.setRasterMask(img, idx, key);
      const s = useDevelopStore.getState();
      r.render(s.params, { fullFrame: s.cropMode, clip: s.showClipping, maskView: s.maskOverlay || s.maskDraft ? s.activeMaskIndex : -1 });
      scheduleHistogram();
    };
    img.onerror = () => console.warn("failed to load raster mask map");
    img.src = maskUrl(key);
  }, [params, rasterDraft, cropMode, showClipping, scheduleHistogram]);

  // Re-render on every param / crop-mode / zoom change; histogram throttled.
  // The zoom level feeds the detail-tap stretch so NR/sharpen/texture
  // previews stay visible at fit on a native-res texture.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.viewScale = zoomScale;
    renderer.render(params, {
      fullFrame: cropMode,
      clip: showClipping,
      maskView: maskOverlay || maskDraft ? activeMaskIndex : -1,
    });
    syncContentSize(canvasEl);
    scheduleHistogram();
  }, [params, cropMode, showClipping, zoomScale, maskOverlay, maskDraft, activeMaskIndex, scheduleHistogram, canvasEl, syncContentSize]);

  const ready = image && image.thumbReady;

  return (
    <div
      className="canvas-area"
      onContextMenu={(e) => {
        e.preventDefault();
        useUiStore.getState().openContextMenu(e.clientX, e.clientY, buildCanvasMenu());
      }}
    >
      <ZoomPane
        contentW={contentSize.w}
        contentH={contentSize.h}
        contentKey={`${imageId}:${cropMode}`}
        disabled={cropMode}
      >
        <canvas
          ref={setCanvasEl}
          className="develop-canvas"
          style={{ display: ready ? "block" : "none" }}
        />
      </ZoomPane>
      {ready && cropMode && <CropOverlay canvas={canvasEl} />}
      {ready && !cropMode && (maskOverlay || maskDraft) && <MaskOverlay canvas={canvasEl} />}
      {ready && !cropMode && spotTool && <SpotOverlay canvas={canvasEl} />}
      {ready && showBefore && <div className="before-badge">Before</div>}
      {ready && tier === "full" && <span className="tier-badge">1:1</span>}
      {ready && (maskDraft || maskOverlay || spotTool || cropMode) && (
        <button
          className="tool-done"
          onClick={() => {
            const s = useDevelopStore.getState();
            if (s.cropMode) {
              void s.commit("Crop & Straighten");
              s.toggleCropMode();
            } else if (s.spotTool) {
              s.setSpotTool(false);
              void s.commit("Spots applied");
            } else {
              void s.applyMaskSession();
            }
          }}
          title="Finish the active tool (Esc also exits)"
        >
          ✓ Done
        </button>
      )}
      {ready && <InfoOverlay />}
      {!ready && (
        <div className="empty">
          {image ? `Preview unavailable (${image.format})` : "No image selected."}
        </div>
      )}
    </div>
  );
}
