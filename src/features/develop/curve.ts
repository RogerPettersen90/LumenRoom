// Fritsch–Carlson monotone cubic interpolation for the point tone curve —
// no overshoot, the standard for photo curves.
// MUST match `curve_lut` in src-tauri/src/imaging/pipeline.rs.

import { profileLook } from "./profiles";

export type CurvePoints = Array<[number, number]>;

/** Build an evaluator for the curve. Points must be sorted by x. */
export function makeCurveEval(points: CurvePoints): (x: number) => number {
  const n = points.length;
  if (n < 2) return (x) => clamp01(x);

  // Interval slopes.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-6, points[i + 1][0] - points[i][0]);
    d.push((points[i + 1][1] - points[i][1]) / dx);
  }
  // Tangents.
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) * 0.5;
  }
  // Monotonicity fix.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }

  return (x: number): number => {
    if (x <= points[0][0]) return clamp01(points[0][1]);
    if (x >= points[n - 1][0]) return clamp01(points[n - 1][1]);
    let k = 0;
    while (k < n - 2 && x > points[k + 1][0]) k++;
    const h = Math.max(1e-6, points[k + 1][0] - points[k][0]);
    const t = (x - points[k][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return clamp01(
      h00 * points[k][1] + h10 * h * m[k] + h01 * points[k + 1][1] + h11 * h * m[k + 1]
    );
  };
}

/** Bake one curve into a 256-entry byte LUT (identity bootstrap). */
export function bakeCurveLut(points: CurvePoints): Uint8Array {
  const e = makeCurveEval(points);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = Math.round(e(i / 255) * 255);
    lut[i * 3] = v;
    lut[i * 3 + 1] = v;
    lut[i * 3 + 2] = v;
  }
  return lut;
}

/**
 * Parametric region anchors (the classic Shadows/Darks/Lights/Highlights),
 * ±100 → ±0.12. MUST match parametric_points in pipeline.rs.
 */
export function parametricPoints(p: {
  curveShadows: number;
  curveDarks: number;
  curveLights: number;
  curveHighlights: number;
}): CurvePoints {
  const off = (v: number) => (v / 100) * 0.12;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return [
    [0, 0],
    [0.125, clamp01(0.125 + off(p.curveShadows))],
    [0.375, clamp01(0.375 + off(p.curveDarks))],
    [0.625, clamp01(0.625 + off(p.curveLights))],
    [0.875, clamp01(0.875 + off(p.curveHighlights))],
    [1, 1],
  ];
}

/**
 * Bake profile + parametric + per-channel + master curves into one 256×1 RGB
 * LUT, composing out_c = master(channel_c(parametric(profile(x)))). The
 * profile base curve sits at the very bottom — user curves shape the
 * profiled rendering. MUST match channel_curve_luts in pipeline.rs.
 */
export function bakeCurveLuts(p: {
  profile: string;
  toneCurve: CurvePoints;
  toneCurveR: CurvePoints;
  toneCurveG: CurvePoints;
  toneCurveB: CurvePoints;
  curveShadows: number;
  curveDarks: number;
  curveLights: number;
  curveHighlights: number;
}): Uint8Array {
  const profCurve = profileLook(p.profile).curve;
  const prof = profCurve ? makeCurveEval(profCurve) : null;
  const para = makeCurveEval(parametricPoints(p));
  const m = makeCurveEval(p.toneCurve);
  const evals = [
    makeCurveEval(p.toneCurveR),
    makeCurveEval(p.toneCurveG),
    makeCurveEval(p.toneCurveB),
  ];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = para(prof ? prof(i / 255) : i / 255);
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(m(evals[c](x)) * 255);
    }
  }
  return lut;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
