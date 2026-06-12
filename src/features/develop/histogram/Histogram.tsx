import { useEffect, useRef, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useDevelopStore } from "@/store/developStore";
import { histogramBus } from "./histogramBus";
import { drawHistogram, HIST_H, HIST_W } from "./plot";

/**
 * Live RGB histogram for the Develop panel, with the classic clipping indicators:
 * the corner triangles light up when shadows/highlights clip; clicking one
 * (or pressing J) toggles the on-image clipping overlay.
 */
export function Histogram() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [clipLo, setClipLo] = useState(false);
  const [clipHi, setClipHi] = useState(false);
  const showClipping = useDevelopStore((s) => s.showClipping);
  const toggleClipping = useDevelopStore((s) => s.toggleClipping);

  useEffect(() => {
    return histogramBus.subscribe((data) => {
      drawHistogram(ref.current, data);
      if (!data) {
        setClipLo(false);
        setClipHi(false);
        return;
      }
      const total = data.r.reduce((a, b) => a + b, 0) || 1;
      const lo = data.r[0] + data.g[0] + data.b[0];
      const hi = data.r[255] + data.g[255] + data.b[255];
      // Light up when >0.1% of samples sit on the rails.
      setClipLo(lo / (3 * total) > 0.001);
      setClipHi(hi / (3 * total) > 0.001);
    });
  }, []);

  return (
    <PanelSection title="Histogram">
      <div className="hist-wrap">
        <canvas ref={ref} className="histogram" width={HIST_W} height={HIST_H} />
        <button
          className={`clip-tri lo ${clipLo ? "lit" : ""} ${showClipping ? "on" : ""}`}
          title="Shadow clipping (J toggles the overlay)"
          onClick={toggleClipping}
        >
          ◤
        </button>
        <button
          className={`clip-tri hi ${clipHi ? "lit" : ""} ${showClipping ? "on" : ""}`}
          title="Highlight clipping (J toggles the overlay)"
          onClick={toggleClipping}
        >
          ◥
        </button>
      </div>
    </PanelSection>
  );
}
