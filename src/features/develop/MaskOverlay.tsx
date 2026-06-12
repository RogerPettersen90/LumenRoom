import { useEffect, useRef, useState } from "react";
import { useDevelopStore } from "@/store/developStore";
import { useZoomStore } from "@/store/zoomStore";
import type { Mask } from "@/types/models";
import { DEFAULT_BRUSH_MASK, DEFAULT_LINEAR_MASK, DEFAULT_RADIAL_MASK } from "@/types/models";

const BRUSH_MIN_SPACING = 0.004; // frame units between visual path points
const PAINT_LONG_EDGE = 1200; // offscreen weight-map resolution

type DragMode =
  | "none"
  | "draft" // creating a new mask
  | "move" // radial center / whole linear
  | "p0" | "p1" // linear endpoints
  | "rx" | "ry"; // radial radii

/**
 * On-canvas mask placement & editing.
 *  - With a draft armed (+Linear/+Radial), drag on the photo to create the
 *    mask: linear drags start→end; radial drags center→radius.
 *  - The active mask shows draggable handles: linear endpoints / radial center
 *    + radius handles.
 * Mask geometry lives in straightened-frame coords; the canvas shows the
 * cropped frame, so positions convert through the crop rect.
 */
export function MaskOverlay({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const maskDraft = useDevelopStore((s) => s.maskDraft);
  const setMaskDraft = useDevelopStore((s) => s.setMaskDraft);
  const activeIdx = useDevelopStore((s) => s.activeMaskIndex);
  const setActiveIdx = useDevelopStore((s) => s.setActiveMaskIndex);
  const brushErase = useDevelopStore((s) => s.brushErase);
  const brushSize = useDevelopStore((s) => s.brushSize);
  const brushFeather = useDevelopStore((s) => s.brushFeather);
  const setRasterDraft = useDevelopStore((s) => s.setRasterDraft);
  const imageId = useDevelopStore((s) => s.imageId);
  const spacePan = useZoomStore((s) => s.spacePan);

  /** Apply (double-click or panel button): persists a painted brush draft,
   * dismisses the overlay — the mask stays active for the sliders. */
  const applyMask = () => {
    void useDevelopStore.getState().applyMaskSession();
  };

  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [draftStroke, setDraftStroke] = useState<Array<[number, number]>>([]);
  const drag = useRef<{ mode: DragMode; fx: number; fy: number; mask: Mask | null }>({
    mode: "none",
    fx: 0,
    fy: 0,
    mask: null,
  });

  // Offscreen weight-map painter (frame space). Unlimited strokes accumulate
  // here; each stroke end publishes a flattened snapshot for the GPU preview.
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const paintVer = useRef(0);
  const lastPt = useRef<[number, number] | null>(null);
  useEffect(() => {
    // New photo → fresh painting session.
    paintRef.current = null;
    lastPt.current = null;
  }, [imageId]);

  const ensurePaint = (): HTMLCanvasElement | null => {
    if (paintRef.current) return paintRef.current;
    if (!canvas) return null;
    // FULL-frame aspect (the canvas may be showing a crop window).
    const A =
      (canvas.width / Math.max(1e-3, cropW)) /
      Math.max(1, canvas.height / Math.max(1e-3, cropH));
    const c = document.createElement("canvas");
    c.width = A >= 1 ? PAINT_LONG_EDGE : Math.max(2, Math.round(PAINT_LONG_EDGE * A));
    c.height = A >= 1 ? Math.max(2, Math.round(PAINT_LONG_EDGE / A)) : PAINT_LONG_EDGE;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    paintRef.current = c;
    return c;
  };

  /** Paint one stroke segment into the weight map (white = full effect;
   * eraser stamps black). Brush feather widens a low-alpha halo. */
  const paintSegment = (from: [number, number], to: [number, number]) => {
    const c = ensurePaint();
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const rad = Math.max(2, brushSize * c.width);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = brushErase ? "#000" : "#fff";
    const seg = (width: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(from[0] * c.width, from[1] * c.height);
      ctx.lineTo(to[0] * c.width, to[1] * c.height);
      ctx.stroke();
    };
    if (brushFeather > 0.05) {
      seg(rad * 2.0 * (1 + 1.8 * brushFeather), 0.22 + 0.18 * brushFeather);
      seg(rad * 2.0 * (1 + 0.8 * brushFeather), 0.45);
    }
    seg(rad * 2.0, 1.0); // core
    ctx.globalAlpha = 1;
  };

  /** Publish the current weight map to the live GPU preview. */
  const publishDraft = () => {
    const c = paintRef.current;
    if (!c) return;
    paintVer.current += 1;
    setRasterDraft({ dataUrl: c.toDataURL("image/png"), version: paintVer.current });
  };

  // Track the canvas's displayed rect relative to .canvas-area. ZoomPane
  // moves the canvas with CSS transforms, which do NOT fire ResizeObserver —
  // subscribe to the zoom store too, or the overlay drifts when zooming
  // (masks "didn't stay in place", brush painted beside the cursor).
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
    const unsub = useZoomStore.subscribe(update);
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [canvas]);

  if (!box) return null;

  const { cropX, cropY, cropW, cropH } = params;

  // Pointer → straightened-frame coords (through the crop window).
  const toFrame = (e: React.PointerEvent): [number, number] => {
    const r = canvas!.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    return [cropX + u * cropW, cropY + v * cropH];
  };
  // Frame coords → percentage position within the canvas box.
  const toPct = (fx: number, fy: number): [number, number] => [
    ((fx - cropX) / cropW) * 100,
    ((fy - cropY) / cropH) * 100,
  ];

  const active: Mask | undefined = params.masks[activeIdx];

  const updateActive = (patch: Partial<Mask>) => {
    const next = params.masks.map((m, i) => (i === activeIdx ? { ...m, ...patch } : m));
    setParam("masks", next);
  };

  // Container only handles DRAFT placement/painting. Geometry handles carry
  // their own pointer handlers (with capture), so outside the handles the
  // overlay is pointer-transparent and pan/zoom reach the surface beneath.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!maskDraft) return;
    const [fx, fy] = toFrame(e);
    drag.current = { mode: "draft", fx, fy, mask: null };
    if (maskDraft === "brush") {
      paintSegment([fx, fy], [fx, fy]); // a click stamps a dot
      lastPt.current = [fx, fy];
      setDraftStroke([[fx, fy]]);
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  /** Start a geometry drag from a handle/line element (captures the pointer
   * so the drag survives the pointer-transparent container). */
  const beginGeom = (mode: DragMode) => (e: React.PointerEvent) => {
    if (!active || maskDraft) return;
    e.preventDefault();
    e.stopPropagation();
    const [fx, fy] = toFrame(e);
    drag.current = { mode, fx, fy, mask: { ...active } };
    (e.target as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
      e.pointerId
    );
  };
  const geomProps = (mode: DragMode) => ({
    onPointerDown: beginGeom(mode),
    onPointerMove,
    onPointerUp,
  });

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === "none") return;
    const [fx, fy] = toFrame(e);

    if (d.mode === "draft") {
      // Brushes paint live into the weight map; other drafts resolve on release.
      if (maskDraft === "brush") {
        const last = lastPt.current ?? [fx, fy];
        if (Math.hypot(fx - last[0], fy - last[1]) >= BRUSH_MIN_SPACING) {
          paintSegment(last, [fx, fy]);
          lastPt.current = [fx, fy];
          setDraftStroke((prev) => [...prev, [fx, fy]]);
        }
      }
      return;
    }

    const m = d.mask!;
    const dx = fx - d.fx;
    const dy = fy - d.fy;
    switch (d.mode) {
      case "move":
        if (m.kind === "brush") {
          updateActive({
            points: m.points.map(([px, py]) => [px + dx, py + dy] as [number, number]),
          });
        } else {
          updateActive({
            x0: m.x0 + dx,
            y0: m.y0 + dy,
            ...(m.kind === "linear" ? { x1: m.x1 + dx, y1: m.y1 + dy } : {}),
          });
        }
        break;
      case "p0":
        updateActive({ x0: m.x0 + dx, y0: m.y0 + dy });
        break;
      case "p1":
        updateActive({ x1: m.x1 + dx, y1: m.y1 + dy });
        break;
      case "rx":
        updateActive({ x1: Math.max(0.02, m.x1 + dx) });
        break;
      case "ry":
        updateActive({ y1: Math.max(0.02, m.y1 + dy) });
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = { mode: "none", fx: 0, fy: 0, mask: null };
    if (d.mode === "none") return;

    if (d.mode === "draft" && maskDraft === "brush") {
      // Stroke finished — keep painting armed (unlimited strokes; Apply or
      // double-click ends the session). Publish the map to the live preview
      // and make sure a draft raster mask exists so sliders bite already.
      setDraftStroke([]);
      lastPt.current = null;
      const hasDraftMask = params.masks.some((m) => m.kind === "raster" && m.rasterId === "");
      if (!hasDraftMask) {
        const mask: Mask = { ...DEFAULT_BRUSH_MASK, kind: "raster", rasterId: "", points: [] };
        const next = [...params.masks, mask].slice(0, 4);
        setParam("masks", next);
        setActiveIdx(next.length - 1);
      }
      publishDraft();
      return;
    }

    if (d.mode === "draft" && maskDraft) {
      const [fx, fy] = toFrame(e);
      const template = maskDraft === "linear" ? DEFAULT_LINEAR_MASK : DEFAULT_RADIAL_MASK;
      const mask: Mask =
        maskDraft === "linear"
          ? {
              ...template,
              x0: d.fx,
              y0: d.fy,
              x1: Math.hypot(fx - d.fx, fy - d.fy) < 0.02 ? d.fx : fx,
              y1: Math.hypot(fx - d.fx, fy - d.fy) < 0.02 ? d.fy + 0.3 : fy,
            }
          : {
              ...template,
              x0: d.fx,
              y0: d.fy,
              x1: Math.max(0.05, Math.abs(fx - d.fx)),
              y1: Math.max(0.05, Math.abs(fy - d.fy)),
            };
      const next = [...params.masks, mask].slice(0, 4);
      setParam("masks", next);
      setActiveIdx(next.length - 1);
      setMaskDraft(null);
      void commit(`Add ${mask.kind} mask`);
      return;
    }

    void commit("Mask geometry");
  };

  // ── Render the active mask's handles ──
  const renderActive = () => {
    if (!active) return null;
    if (active.kind === "global") return null; // shaped purely by Range
    if (active.kind === "raster") {
      // Tint is rendered IN THE SHADER now (u_maskView) — same math as the
      // effect, so it cannot be misplaced. Nothing to draw DOM-side.
      return null;
    }
    if (active.kind === "brush") {
      if (active.points.length === 0) return null;
      const pts = active.points.map(([px, py]) => toPct(px, py));
      const path = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px} ${py}`).join(" ");
      // Painted-area highlight: stroke width matches the brush diameter.
      const widthPx = box.width * ((active.x1 * 2) / cropW);
      return (
        <svg className="mask-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={path}
            className="mask-paint"
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: widthPx }}
          />
          <path d={path} className="mask-line" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      );
    }
    if (active.kind === "linear") {
      const [x0, y0] = toPct(active.x0, active.y0);
      const [x1, y1] = toPct(active.x1, active.y1);
      return (
        <svg className="mask-svg">
          <line
            x1={`${x0}%`} y1={`${y0}%`} x2={`${x1}%`} y2={`${y1}%`}
            className="mask-line"
            {...geomProps("move")}
          />
          <circle cx={`${x0}%`} cy={`${y0}%`} r={7} className="mask-handle start" {...geomProps("p0")} />
          <circle cx={`${x1}%`} cy={`${y1}%`} r={7} className="mask-handle" {...geomProps("p1")} />
        </svg>
      );
    }
    const [cx, cy] = toPct(active.x0, active.y0);
    const rxPct = (active.x1 / cropW) * 100;
    const ryPct = (active.y1 / cropH) * 100;
    return (
      <svg className="mask-svg">
        <ellipse
          cx={`${cx}%`}
          cy={`${cy}%`}
          rx={`${rxPct}%`}
          ry={`${ryPct}%`}
          className="mask-line"
          transform={`rotate(${active.rotation} ${(cx / 100) * box.width} ${(cy / 100) * box.height})`}
          {...geomProps("move")}
        />
        <circle cx={`${cx}%`} cy={`${cy}%`} r={7} className="mask-handle start" {...geomProps("move")} />
        <circle cx={`${cx + rxPct}%`} cy={`${cy}%`} r={6} className="mask-handle" {...geomProps("rx")} />
        <circle cx={`${cx}%`} cy={`${cy + ryPct}%`} r={6} className="mask-handle" {...geomProps("ry")} />
      </svg>
    );
  };

  return (
    <div
      className={`mask-overlay ${maskDraft ? "placing" : ""} ${
        // Space = hand tool: the whole overlay yields so dragging pans.
        spacePan ||
        (!maskDraft && (active?.kind === "raster" || active?.kind === "global"))
          ? "pass-through"
          : ""
      }`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={applyMask}
      title="Double-click to apply the mask"
    >
      {renderActive()}
      {draftStroke.length > 0 && (
        <svg className="mask-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={draftStroke
              .map(([px, py]) => toPct(px, py))
              .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px} ${py}`)
              .join(" ")}
            className="mask-paint"
            fill="none"
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: box.width * ((brushSize * 2) / cropW) }}
          />
        </svg>
      )}
      {maskDraft && (
        <div className="mask-hint">
          {maskDraft === "brush"
            ? `${brushErase ? "Erasing" : "Painting"} — stroke as much as you like, then Apply (double-click)`
            : `Drag to place the ${maskDraft} mask`}
        </div>
      )}
    </div>
  );
}
