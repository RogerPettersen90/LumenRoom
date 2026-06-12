import { useEffect, useState } from "react";
import { useCatalogStore } from "@/store/catalogStore";
import { useZoomStore } from "@/store/zoomStore";
import { fullUrl, previewUrl } from "@/api/protocol";
import { ZoomPane } from "@/components/ZoomPane";
import { InfoOverlay } from "@/components/InfoOverlay";

/**
 * Library Loupe with tiered previews: the 2048px standard proxy for fit/fill
 * browsing, swapping to the 1:1 full-resolution preview once zoomed past
 * 100% — so sharpness checks see true pixels (the classic 1:1 preview behaviour).
 */
export function LoupeView() {
  const selectedId = useCatalogStore((s) => s.selectedId);
  const image = useCatalogStore((s) => (selectedId ? s.byId[selectedId] : null));
  const zoomScale = useZoomStore((s) => s.scale);

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tier, setTier] = useState<"std" | "full">("std");

  // New photo → back to the standard proxy.
  useEffect(() => {
    setDims(null);
    setTier("std");
  }, [image?.id]);

  // Zoomed past ~100% of the proxy → upgrade to the 1:1 preview.
  useEffect(() => {
    if (!image || tier === "full" || zoomScale <= 1.01) return;
    let cancelled = false;
    const prevW = dims?.w ?? 0;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // Keep the on-screen magnification identical across the swap: the
      // content is now higher-res, so the numeric scale shrinks by the ratio.
      const z = useZoomStore.getState();
      if (prevW > 0 && typeof z.mode === "number") {
        z.setMode(z.mode * (prevW / img.naturalWidth));
      }
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setTier("full");
    };
    img.src = fullUrl(image.id);
    return () => {
      cancelled = true;
    };
  }, [zoomScale, tier, image]);

  if (!image || !image.thumbReady) {
    return (
      <div className="loupe-stage">
        <div className="empty">
          {image ? `Preview unavailable (${image.format})` : "Select an image."}
        </div>
      </div>
    );
  }

  const src = tier === "full" ? fullUrl(image.id) : previewUrl(image.id);

  return (
    <div className="loupe-stage">
      {dims ? (
        <ZoomPane contentW={dims.w} contentH={dims.h} contentKey={image.id}>
          <img src={src} alt={image.filename} draggable={false} />
        </ZoomPane>
      ) : (
        // First load: measure the proxy's natural size, then hand to ZoomPane.
        <img
          src={src}
          alt={image.filename}
          onLoad={(e) =>
            setDims({
              w: (e.target as HTMLImageElement).naturalWidth,
              h: (e.target as HTMLImageElement).naturalHeight,
            })
          }
        />
      )}
      <InfoOverlay />
      <div className="loupe-verdict">
        {tier === "full" && <span className="tier-badge">1:1</span>}
        {image.flag === 1 && <span className="flag pick">⚑ Pick</span>}
        {image.flag === -1 && <span className="flag reject">⚑ Reject</span>}
        {image.rating > 0 && <span className="stars">{"★".repeat(image.rating)}</span>}
        {image.colorLabel && <span className={`swatch swatch-${image.colorLabel} on`} />}
      </div>
    </div>
  );
}
