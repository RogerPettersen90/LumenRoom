import { useCallback, useEffect, useRef, useState } from "react";
import { useDevelopStore } from "@/store/developStore";

const MIN_SIZE = 0.05; // minimum crop extent, normalized

type DragMode =
  | "none"
  | "move"
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
  mode: DragMode;
  startX: number; // pointer position at drag start, normalized
  startY: number;
  crop: { x: number; y: number; w: number; h: number }; // crop at drag start
}

/**
 * The crop tool overlay: positioned exactly over the (full-frame) canvas,
 * renders the crop rect with a rule-of-thirds grid, 8 resize handles, and
 * drag-to-move. All interaction happens in normalized [0,1] image coords;
 * the canvas's displayed bounding box maps them to pixels.
 */
export function CropOverlay({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const params = useDevelopStore((s) => s.params);
  const setMany = useDevelopStore((s) => s.setMany);
  const cropRatio = useDevelopStore((s) => s.cropRatio);

  /** Target pixel aspect (w/h), or null when free. "original" = the frame's. */
  const targetRatio = useCallback((): number | null => {
    if (!cropRatio || !canvas) return null;
    const frame = canvas.width / Math.max(1, canvas.height);
    if (cropRatio === "original") return frame;
    const [rw, rh] = cropRatio.split(":").map(Number);
    return rw > 0 && rh > 0 ? rw / rh : null;
  }, [cropRatio, canvas]);

  // Choosing a ratio snaps the current rect to it (center-anchored).
  useEffect(() => {
    const R = targetRatio();
    if (!R || !canvas) return;
    const A = canvas.width / Math.max(1, canvas.height);
    const s = useDevelopStore.getState().params;
    let w = s.cropW;
    let h = (w * A) / R;
    if (h > 1) {
      h = 1;
      w = (h * R) / A;
    }
    const cx = s.cropX + s.cropW / 2;
    const cy = s.cropY + s.cropH / 2;
    setMany({
      cropX: clamp(cx - w / 2, 0, 1 - w),
      cropY: clamp(cy - h / 2, 0, 1 - h),
      cropW: w,
      cropH: h,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropRatio]);

  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<DragState>({ mode: "none", startX: 0, startY: 0, crop: { x: 0, y: 0, w: 1, h: 1 } });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Track the canvas's displayed rect, positioned relative to .canvas-area
  // (the overlay's offset parent — the canvas itself now lives inside the
  // ZoomPane's transformed content).
  useEffect(() => {
    if (!canvas) return;
    const parent = canvas.closest(".canvas-area") as HTMLElement | null;
    if (!parent) return;

    const update = () => {
      const c = canvas.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvas]);

  const toNorm = useCallback(
    (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
      if (!canvas) return { x: 0, y: 0 };
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      };
    },
    [canvas]
  );

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toNorm(e);
    drag.current = {
      mode,
      startX: p.x,
      startY: p.y,
      crop: { x: params.cropX, y: params.cropY, w: params.cropW, h: params.cropH },
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === "none") return;
    const p = toNorm(e);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    const c = d.crop;

    let { x, y, w, h } = c;

    if (d.mode === "move") {
      x = clamp(c.x + dx, 0, 1 - c.w);
      y = clamp(c.y + dy, 0, 1 - c.h);
    } else {
      // Edges/corners: adjust the dragged sides, keep the opposite fixed.
      const left = d.mode === "nw" || d.mode === "w" || d.mode === "sw";
      const right = d.mode === "ne" || d.mode === "e" || d.mode === "se";
      const top = d.mode === "nw" || d.mode === "n" || d.mode === "ne";
      const bottom = d.mode === "sw" || d.mode === "s" || d.mode === "se";

      if (left) {
        const nx = clamp(c.x + dx, 0, c.x + c.w - MIN_SIZE);
        w = c.x + c.w - nx;
        x = nx;
      }
      if (right) {
        w = clamp(c.w + dx, MIN_SIZE, 1 - c.x);
      }
      if (top) {
        const ny = clamp(c.y + dy, 0, c.y + c.h - MIN_SIZE);
        h = c.y + c.h - ny;
        y = ny;
      }
      if (bottom) {
        h = clamp(c.h + dy, MIN_SIZE, 1 - c.y);
      }

      // Aspect lock: derive the other dimension, anchored to the fixed edges.
      const R = targetRatio();
      if (R && canvas) {
        const A = canvas.width / Math.max(1, canvas.height);
        if (d.mode === "n" || d.mode === "s") {
          // Vertical drags drive height; width follows, kept centered.
          let nw = (h * R) / A;
          if (nw > 1) {
            nw = 1;
            h = (nw * A) / R;
            if (top) y = c.y + c.h - h;
          }
          const cx = c.x + c.w / 2;
          x = clamp(cx - nw / 2, 0, 1 - nw);
          w = nw;
        } else {
          // Horizontal/corner drags drive width; height follows.
          let nh = (w * A) / R;
          if (nh > 1) {
            nh = 1;
            w = (nh * R) / A;
            if (left) x = c.x + c.w - w;
          }
          y = top ? clamp(c.y + c.h - nh, 0, 1 - nh) : clamp(c.y, 0, 1 - nh);
          h = nh;
        }
      }
    }

    setMany({ cropX: x, cropY: y, cropW: w, cropH: h });
  };

  const endDrag = () => {
    drag.current.mode = "none";
  };

  if (!box) return null;

  const { cropX, cropY, cropW, cropH } = params;
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div
      ref={overlayRef}
      className="crop-overlay"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* Dim everything outside the crop rect. */}
      <div className="crop-dim" style={{ left: 0, top: 0, right: 0, height: pct(cropY) }} />
      <div className="crop-dim" style={{ left: 0, top: pct(cropY + cropH), right: 0, bottom: 0 }} />
      <div className="crop-dim" style={{ left: 0, top: pct(cropY), width: pct(cropX), height: pct(cropH) }} />
      <div
        className="crop-dim"
        style={{ left: pct(cropX + cropW), top: pct(cropY), right: 0, height: pct(cropH) }}
      />

      {/* The crop rect: thirds grid + move surface + handles. Double-click
          anywhere inside commits the crop instantly (classic behaviour). */}
      <div
        className="crop-rect"
        style={{ left: pct(cropX), top: pct(cropY), width: pct(cropW), height: pct(cropH) }}
        onPointerDown={beginDrag("move")}
        onDoubleClick={() => {
          const s = useDevelopStore.getState();
          void s.commit("Crop & Straighten");
          if (s.cropMode) s.toggleCropMode();
        }}
      >
        <div className="thirds v" style={{ left: "33.333%" }} />
        <div className="thirds v" style={{ left: "66.667%" }} />
        <div className="thirds h" style={{ top: "33.333%" }} />
        <div className="thirds h" style={{ top: "66.667%" }} />

        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((m) => (
          <div key={m} className={`crop-handle ${m}`} onPointerDown={beginDrag(m)} />
        ))}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
