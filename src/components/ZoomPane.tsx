import { useCallback, useEffect, useRef, useState } from "react";
import { useZoomStore } from "@/store/zoomStore";
import type { ZoomMode } from "@/store/zoomStore";

interface ZoomPaneProps {
  contentW: number; // natural pixel size of the child content
  contentH: number;
  /** Changing this key resets the view to Fit (new image opened). */
  contentKey: string;
  /** Disable interactions and force Fit (e.g. while the crop tool is open). */
  disabled?: boolean;
  children: React.ReactNode;
}

const MIN_SCALE_FACTOR = 0.25; // of fit
const MAX_SCALE = 8;

/**
 * Shared zoom/pan surface for Loupe and the Develop canvas.
 *  - Fit / Fill / percentage modes (driven via zoomStore, e.g. the Navigator)
 *  - mouse-wheel zoom anchored at the cursor
 *  - click toggles Fit ↔ 100% at the clicked point; drag pans when zoomed
 * Publishes the effective scale + visible viewport for the Navigator.
 */
export function ZoomPane({ contentW, contentH, contentKey, disabled, children }: ZoomPaneProps) {
  const mode = useZoomStore((s) => s.mode);
  const setMode = useZoomStore((s) => s.setMode);
  const publish = useZoomStore((s) => s.publish);
  const centerReq = useZoomStore((s) => s.centerReq);
  const spacePan = useZoomStore((s) => s.spacePan);

  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 }); // translation in px
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const lastCenterGen = useRef(0);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setBox({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // New image → back to Fit.
  useEffect(() => {
    setMode("fit");
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const fitScale =
    contentW > 0 && box.w > 0 ? Math.min(box.w / contentW, box.h / contentH) : 1;
  const fillScale =
    contentW > 0 && box.w > 0 ? Math.max(box.w / contentW, box.h / contentH) : 1;

  const effMode: ZoomMode = disabled ? "fit" : mode;
  const scale =
    effMode === "fit" ? fitScale : effMode === "fill" ? fillScale : (effMode as number);

  // Clamp/center the translation for the current scale.
  const layout = useCallback(
    (p: { x: number; y: number }) => {
      const sw = contentW * scale;
      const sh = contentH * scale;
      const tx = sw <= box.w ? (box.w - sw) / 2 : clamp(p.x, box.w - sw, 0);
      const ty = sh <= box.h ? (box.h - sh) / 2 : clamp(p.y, box.h - sh, 0);
      return { tx, ty, sw, sh };
    },
    [contentW, contentH, scale, box.w, box.h]
  );

  const { tx, ty, sw, sh } = layout(pan);

  // Publish scale + viewport for the Navigator.
  useEffect(() => {
    if (contentW === 0 || box.w === 0) return;
    publish(scale, {
      x: clamp(-tx / sw, 0, 1),
      y: clamp(-ty / sh, 0, 1),
      w: clamp(box.w / sw, 0, 1),
      h: clamp(box.h / sh, 0, 1),
    });
  }, [scale, tx, ty, sw, sh, box.w, box.h, contentW, publish]);

  // Navigator asked to center on a normalized point.
  useEffect(() => {
    if (!centerReq || centerReq.gen === lastCenterGen.current) return;
    lastCenterGen.current = centerReq.gen;
    setPan({
      x: box.w / 2 - centerReq.x * contentW * scale,
      y: box.h / 2 - centerReq.y * contentH * scale,
    });
  }, [centerReq, box.w, box.h, contentW, contentH, scale]);

  const zoomAt = (cx: number, cy: number, nextScale: number) => {
    const s2 = clamp(nextScale, fitScale * MIN_SCALE_FACTOR, MAX_SCALE);
    // Keep the content point under the cursor stationary.
    const px = (cx - tx) / scale;
    const py = (cy - ty) / scale;
    setPan({ x: cx - px * s2, y: cy - py * s2 });
    setMode(s2);
  };

  // Wheel zoom listens on the PARENT stage (e.g. .canvas-area), not this
  // div: tool overlays (mask/spot/crop) are siblings layered on top of us,
  // so events over them would otherwise never reach the zoom surface —
  // "scroll zoom stops working once a tool is open".
  const wheelLogic = useRef<(e: WheelEvent) => void>(() => undefined);
  wheelLogic.current = (e: WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const r = containerRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX - r.left, e.clientY - r.top, scale * factor);
  };
  useEffect(() => {
    const host = containerRef.current?.parentElement ?? containerRef.current;
    if (!host) return;
    const h = (e: WheelEvent) => wheelLogic.current(e);
    host.addEventListener("wheel", h, { passive: false });
    return () => host.removeEventListener("wheel", h);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved && (sw > box.w || sh > box.h)) {
      setPan({ x: d.px + dx, y: d.py + dy });
      if (spacePan) useZoomStore.getState().markSpacePanUsed();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || disabled) return;
    // Plain click: toggle Fit ↔ 100% at the clicked point (classic behaviour).
    const r = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    if (scale < 0.999) zoomAt(cx, cy, 1);
    else setMode("fit");
  };

  return (
    <div
      ref={containerRef}
      className={`zoom-pane ${sw > box.w || sh > box.h ? "pannable" : ""} ${
        spacePan ? "space-pan" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="zoom-content"
        style={{
          width: contentW,
          height: contentH,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
