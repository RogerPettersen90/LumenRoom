import { useMemo, useRef, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useDevelopStore } from "@/store/developStore";
import { curveIsIdentity } from "@/types/models";
import type { CurvePoints } from "../curve";
import { makeCurveEval } from "../curve";

const SIZE = 256; // SVG viewbox (square)
const MIN_DX = 0.02; // minimum x-gap between control points
const HIT = 0.04; // pointer-to-point hit radius, normalized

type Channel = "toneCurve" | "toneCurveR" | "toneCurveG" | "toneCurveB";

const CHANNELS: { key: Channel; label: string; color: string }[] = [
  { key: "toneCurve", label: "RGB", color: "var(--text-0)" },
  { key: "toneCurveR", label: "R", color: "#e5484d" },
  { key: "toneCurveG", label: "G", color: "#3ecf6a" },
  { key: "toneCurveB", label: "B", color: "#4a9eff" },
];

/**
 * classic-style point tone curve. Click the curve to add a control point,
 * drag points to shape the curve (monotone cubic — no overshoot), double-click
 * an interior point to remove it. Endpoints set black/white levels and only
 * move vertically. Commits one history step on pointer-up.
 */
export function ToneCurvePanel() {
  const [channel, setChannel] = useState<Channel>("toneCurve");
  const points = useDevelopStore((s) => s.params[channel]);
  const setParamStore = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const chMeta = CHANNELS.find((c) => c.key === channel)!;

  // All existing editing logic operates on the active channel's points.
  const setParam = (_key: "toneCurve", value: CurvePoints) => setParamStore(channel, value);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number>(-1);
  const dirty = useRef(false);

  // Sampled curve path for display.
  const path = useMemo(() => {
    const evalCurve = makeCurveEval(points);
    const steps = 100;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      const y = evalCurve(x);
      d += `${i === 0 ? "M" : "L"}${(x * SIZE).toFixed(1)},${((1 - y) * SIZE).toFixed(1)}`;
    }
    return d;
  }, [points]);

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      clamp01((e.clientX - r.left) / r.width),
      clamp01(1 - (e.clientY - r.top) / r.height),
    ];
  };

  const hitTest = (x: number, y: number): number => {
    let best = -1;
    let bestD = HIT;
    points.forEach(([px, py], i) => {
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const [x, y] = toNorm(e);
    let idx = hitTest(x, y);
    if (idx < 0) {
      // Add a new control point at the pointer, keeping x-order.
      const next: CurvePoints = [...points.map((p) => [...p] as [number, number]), [x, y]];
      next.sort((a, b) => a[0] - b[0]);
      idx = next.findIndex((p) => p[0] === x && p[1] === y);
      setParam("toneCurve", next);
      dirty.current = true;
    }
    dragIdx.current = idx;
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const idx = dragIdx.current;
    if (idx < 0) return;
    const [x, y] = toNorm(e);
    const next = points.map((p) => [...p] as [number, number]);
    const last = next.length - 1;

    if (idx === 0) {
      next[0] = [0, y]; // black point: vertical only
    } else if (idx === last) {
      next[last] = [1, y]; // white point: vertical only
    } else {
      const lo = next[idx - 1][0] + MIN_DX;
      const hi = next[idx + 1][0] - MIN_DX;
      next[idx] = [Math.min(hi, Math.max(lo, x)), y];
    }
    setParam("toneCurve", next);
    dirty.current = true;
  };

  const onPointerUp = () => {
    if (dragIdx.current >= 0 && dirty.current) {
      void commit(`Tone Curve ${chMeta.label}`);
      dirty.current = false;
    }
    dragIdx.current = -1;
  };

  const onDoubleClick = (e: React.PointerEvent | React.MouseEvent) => {
    const [x, y] = toNorm(e as React.PointerEvent);
    const idx = hitTest(x, y);
    // Interior points only — endpoints always remain.
    if (idx > 0 && idx < points.length - 1) {
      const next = points.filter((_, i) => i !== idx);
      setParam("toneCurve", next);
      void commit(`Tone Curve ${chMeta.label}`);
    }
  };

  const reset = () => {
    setParam("toneCurve", [
      [0, 0],
      [1, 1],
    ]);
    void commit("Tone Curve Reset");
  };

  return (
    <PanelSection title="Tone Curve">
      <div className="seg hsl-tabs">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            className={channel === c.key ? "active" : ""}
            style={{ color: c.color }}
            onClick={() => setChannel(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="curve-editor"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* Quarter grid + reference diagonal */}
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line className="grid" x1={t * SIZE} y1={0} x2={t * SIZE} y2={SIZE} />
            <line className="grid" x1={0} y1={t * SIZE} x2={SIZE} y2={t * SIZE} />
          </g>
        ))}
        <line className="diag" x1={0} y1={SIZE} x2={SIZE} y2={0} />
        <path className="curve" d={path} style={{ stroke: chMeta.color }} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            className="curve-point"
            cx={x * SIZE}
            cy={(1 - y) * SIZE}
            r={5}
          />
        ))}
      </svg>
      <div className="actions">
        <button onClick={reset} disabled={curveIsIdentity(points)}>
          Reset
        </button>
        <span className="panel-muted" style={{ alignSelf: "center" }}>
          Click to add · double-click to remove
        </span>
      </div>

      {channel === "toneCurve" && <ParametricSliders />}
    </PanelSection>
  );
}

/** the classic parametric region sliders, applied under the point curves. */
function ParametricSliders() {
  const params = useDevelopStore((s) => s.params);
  const setParamStore = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);

  const rows = [
    { key: "curveHighlights" as const, label: "Highlights" },
    { key: "curveLights" as const, label: "Lights" },
    { key: "curveDarks" as const, label: "Darks" },
    { key: "curveShadows" as const, label: "Shadows" },
  ];

  return (
    <div className="subgroup">
      <h4>Region</h4>
      {rows.map((r) => (
        <ParametricSlider
          key={r.key}
          label={r.label}
          value={params[r.key]}
          onChange={(v) => setParamStore(r.key, v)}
          onCommit={() => commit(`Curve ${r.label} ${Math.round(params[r.key])}`)}
        />
      ))}
    </div>
  );
}

function ParametricSlider({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="slider">
      <div className="row">
        <span className="label">{label}</span>
        <span className="value">{value > 0 ? `+${Math.round(value)}` : Math.round(value)}</span>
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
