import { useEffect, useRef } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";
import { thumbUrl } from "@/api/protocol";
import {
  computeHistogramFromImage,
  drawHistogram,
  HIST_H,
  HIST_W,
} from "@/features/develop/histogram/plot";

/**
 * Library-module histogram of the selected photo, computed CPU-side from the
 * cached thumbnail (no WebGL surface exists in Library). Shows the photo's
 * key EXIF beneath, like the classic editor's histogram header.
 */
export function HistogramPanel() {
  const image = useCatalogStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!image || !image.thumbReady) {
      drawHistogram(ref.current, null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) drawHistogram(ref.current, computeHistogramFromImage(img));
    };
    img.onerror = () => !cancelled && drawHistogram(ref.current, null);
    img.src = thumbUrl(image.id);
    return () => {
      cancelled = true;
    };
  }, [image?.id, image?.thumbReady]);

  return (
    <PanelSection title="Histogram">
      <canvas ref={ref} className="histogram" width={HIST_W} height={HIST_H} />
      {image && (
        <div className="histogram-exif">
          {image.iso != null && <span>ISO {image.iso}</span>}
          {image.focalLength != null && <span>{Math.round(image.focalLength)} mm</span>}
          {image.aperture != null && <span>f/{image.aperture}</span>}
          {image.shutter && <span>{image.shutter} sec</span>}
        </div>
      )}
    </PanelSection>
  );
}
