import { useEffect, useRef, useState } from "react";
import { useDevelopStore } from "@/store/developStore";
import { useZoomStore } from "@/store/zoomStore";
import { DEFAULT_SPOT } from "@/types/models";

type SpotDrag = { kind: "dst" | "src"; index: number } | null;

const MAX_SPOTS = 8;

/**
 * Heal/clone overlay: click to place a spot (destination at the click, source
 * auto-offset), drag the solid circle (destination) or dashed circle (source)
 * to reposition. Double-click applies (dismisses the tool).
 */
export function SpotOverlay({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const activeIdx = useDevelopStore((s) => s.activeSpotIndex);
  const setActiveIdx = useDevelopStore((s) => s.setActiveSpotIndex);
  const setSpotTool = useDevelopStore((s) => s.setSpotTool);
  const spacePan = useZoomStore((s) => s.spacePan);

  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<SpotDrag>(null);

  useEffect(() => {
    if (!canvas) return;
    const parent = canvas.closest(".canvas-area") as HTMLElement | null;
    if (!parent) return;
    const update = () => {
      const c = canvas.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      setBox({ left: c.left - pr.left, top: c.top - pr.top, width: c.width, height: c.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    ro.observe(parent);
    // CSS-transform zoom/pan doesn't fire ResizeObserver — track it too.
    const unsub = useZoomStore.subscribe(update);
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [canvas]);

  if (!box) return null;

  const { cropX, cropY, cropW, cropH } = params;
  const toFrame = (e: React.PointerEvent): [number, number] => {
    const r = canvas!.getBoundingClientRect();
    return [
      cropX + ((e.clientX - r.left) / r.width) * cropW,
      cropY + ((e.clientY - r.top) / r.height) * cropH,
    ];
  };
  const toPct = (fx: number, fy: number): [number, number] => [
    ((fx - cropX) / cropW) * 100,
    ((fy - cropY) / cropH) * 100,
  ];

  const updateSpot = (i: number, patch: Partial<(typeof params.spots)[number]>) => {
    setParam(
      "spots",
      params.spots.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const [fx, fy] = toFrame(e);
    // Hit-test existing spots (source circles first — they're smaller targets).
    const tol = (12 / box.width) * cropW;
    for (let i = params.spots.length - 1; i >= 0; i--) {
      const s = params.spots[i];
      if (Math.hypot(fx - s.srcX, fy - s.srcY) < Math.max(s.radius * 0.7, tol)) {
        drag.current = { kind: "src", index: i };
        setActiveIdx(i);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      if (Math.hypot(fx - s.x, fy - s.y) < Math.max(s.radius, tol)) {
        drag.current = { kind: "dst", index: i };
        setActiveIdx(i);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    }
    // Empty area: place a new spot here.
    if (params.spots.length >= MAX_SPOTS) return;
    const next = [
      ...params.spots,
      {
        ...DEFAULT_SPOT,
        x: fx,
        y: fy,
        srcX: fx + 0.08,
        srcY: fy,
        // Heal and Clone are armed as separate tools now.
        heal: useDevelopStore.getState().spotMode === "heal",
      },
    ];
    setParam("spots", next);
    setActiveIdx(next.length - 1);
    drag.current = { kind: "src", index: next.length - 1 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [fx, fy] = toFrame(e);
    if (d.kind === "dst") updateSpot(d.index, { x: fx, y: fy });
    else updateSpot(d.index, { srcX: fx, srcY: fy });
  };

  const onPointerUp = () => {
    if (drag.current) void commit("Heal/clone spot");
    drag.current = null;
  };

  return (
    <div
      className={`mask-overlay placing ${spacePan ? "pass-through" : ""}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        setSpotTool(false);
        void commit("Spots applied");
      }}
      title="Click to place · drag circles to adjust · double-click to apply"
    >
      <svg className="mask-svg">
        {params.spots.map((s, i) => {
          const [dx, dy] = toPct(s.x, s.y);
          const [sx, sy] = toPct(s.srcX, s.srcY);
          const rx = (s.radius / cropW) * 100;
          const ry = (s.radius / cropH) * 100;
          const cls = i === activeIdx ? "spot active" : "spot";
          return (
            <g key={i} className={cls}>
              <line x1={`${dx}%`} y1={`${dy}%`} x2={`${sx}%`} y2={`${sy}%`} className="spot-link" />
              <ellipse cx={`${dx}%`} cy={`${dy}%`} rx={`${rx}%`} ry={`${ry}%`} className="spot-dst" />
              <ellipse cx={`${sx}%`} cy={`${sy}%`} rx={`${rx}%`} ry={`${ry}%`} className="spot-src" />
            </g>
          );
        })}
      </svg>
      <div className="mask-hint">Click to place a spot · drag dashed circle to choose the source</div>
    </div>
  );
}
