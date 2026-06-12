import type { EditParams } from "@/types/models";

// Calibration matrix — TS twin of calibration_matrix in pipeline.rs.
// Columns are what each pure camera primary maps to after hue rotation (±45°)
// and saturation scaling, luma-normalized. Applied in linear light before WB.

export function calibrationIsIdentity(p: EditParams): boolean {
  return (
    p.calRedHue === 0 &&
    p.calRedSat === 0 &&
    p.calGreenHue === 0 &&
    p.calGreenSat === 0 &&
    p.calBlueHue === 0 &&
    p.calBlueSat === 0
  );
}

export function calibrationMatrix(p: EditParams): [number[], number[], number[]] {
  const col = (baseHue: number, hue: number, sat: number): number[] => {
    const h = (((baseHue + (hue / 100) * 45) % 360) + 360) % 360;
    const s = Math.min(1, Math.max(0, 1 + sat / 100));
    const [r, g, b] = hsv2rgb(h / 360, s, 1);
    const l = Math.max(1e-4, luma(r, g, b));
    const base =
      baseHue === 0 ? luma(1, 0, 0) : baseHue === 120 ? luma(0, 1, 0) : luma(0, 0, 1);
    const k = base / l;
    return [r * k, g * k, b * k];
  };
  return [
    col(0, p.calRedHue, p.calRedSat),
    col(120, p.calGreenHue, p.calGreenSat),
    col(240, p.calBlueHue, p.calBlueSat),
  ];
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const h6 = ((h % 1) + 1) % 1 * 6;
  const i = Math.floor(h6) % 6;
  const f = h6 - Math.floor(h6);
  const p2 = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return [v, t, p2];
    case 1: return [q, v, p2];
    case 2: return [p2, v, t];
    case 3: return [p2, q, v];
    case 4: return [t, p2, v];
    default: return [v, p2, q];
  }
}
