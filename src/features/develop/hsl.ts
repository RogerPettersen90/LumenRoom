import type { EditParams } from "@/types/models";

// HSL / Color Mixer shared machinery.
// MUST match hsl_lut / HSL_CENTERS in src-tauri/src/imaging/pipeline.rs.

/** Band centers in degrees: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta. */
export const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 280, 320] as const;

export const HSL_BANDS = [
  { name: "Red", color: "#e5484d" },
  { name: "Orange", color: "#f08c3a" },
  { name: "Yellow", color: "#f5c451" },
  { name: "Green", color: "#3ecf6a" },
  { name: "Aqua", color: "#3ecfcf" },
  { name: "Blue", color: "#4a9eff" },
  { name: "Purple", color: "#9a6cf5" },
  { name: "Magenta", color: "#e54da0" },
] as const;

/**
 * Bake the mixer into a 360×1 RGB LUT for the shader:
 *   R: hue shift, (shift/60° + 0.5)   — ±100 slider → ±30°
 *   G: sat multiplier / 2             — ±100 slider → ×0..2
 *   B: lum multiplier − 0.5           — ±100 slider → ×0.5..1.5
 */
export function bakeHslLut(p: EditParams): Uint8Array {
  const lut = new Uint8Array(360 * 3);
  for (let deg = 0; deg < 360; deg++) {
    // Surrounding pair of band centers (wrapping Magenta→Red).
    let k = 7;
    for (let i = 0; i < 7; i++) {
      if (deg >= HSL_CENTERS[i] && deg < HSL_CENTERS[i + 1]) {
        k = i;
        break;
      }
    }
    const c0 = HSL_CENTERS[k];
    const c1 = k === 7 ? 360 : HSL_CENTERS[k + 1];
    const i1 = (k + 1) % 8;
    const t = Math.min(1, Math.max(0, (deg - c0) / (c1 - c0)));

    const hue = (1 - t) * p.hslHue[k] + t * p.hslHue[i1];
    const sat = (1 - t) * p.hslSat[k] + t * p.hslSat[i1];
    const lum = (1 - t) * p.hslLum[k] + t * p.hslLum[i1];

    const shiftDeg = (hue / 100) * 30;
    const satMul = 1 + sat / 100;
    const lumMul = 1 + (0.5 * lum) / 100;

    lut[deg * 3] = encode(shiftDeg / 60 + 0.5);
    lut[deg * 3 + 1] = encode(satMul / 2);
    lut[deg * 3 + 2] = encode(lumMul - 0.5);
  }
  return lut;
}

function encode(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}
