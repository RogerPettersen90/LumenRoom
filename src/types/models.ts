// TypeScript mirrors of the Rust structs in src-tauri/src/db/models.rs.
// Keep these in sync — serde uses camelCase on the wire.

export interface ImageMeta {
  id: string;
  path: string;
  filename: string;
  width: number | null;
  height: number | null;
  format: string;
  cameraModel: string | null;
  lens: string | null;
  iso: number | null;
  aperture: number | null;
  shutter: string | null;
  focalLength: number | null;
  capturedAt: number | null;
  orientation: number;
  rating: number;
  flag: number;
  colorLabel: ColorLabel | null;
  /** Set when this row is a virtual copy of another image. */
  copyOf: string | null;
  /** Stacking: shared stack id + position (0 = top, shown when collapsed). */
  stackId: string | null;
  stackPos: number;
  thumbReady: boolean;
}

export type ColorLabel = "red" | "yellow" | "green" | "blue" | "purple";

export interface EditParams {
  /**
   * Camera profile / base look applied under all user adjustments
   * ("" = neutral default; "color" | "vivid" | "portrait" | "landscape" |
   * "bw"). Looks live in features/develop/profiles.ts (=== pipeline.rs).
   */
  profile: string;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  clarity: number;
  /** Presence: dehaze (-100..100). */
  dehaze: number;
  /** Presence: texture (-100..100). */
  texture: number;
  // Geometry: crop rect normalized [0,1] over the straightened frame + the
  // straighten angle in degrees (auto-zoomed, no empty corners).
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  angle: number;
  /** Lateral CA correction: radial R/B scale (-100..100 → ±0.5%). */
  caRed: number;
  caBlue: number;
  /** Lens distortion correction (-100..100; + corrects barrel). */
  distortion: number;
  /** Lens-profile distortion (lensfun ptlens cubic); all zero = off. */
  lensA: number;
  lensB: number;
  lensC: number;
  /** Transform: perspective keystone (-100..100). */
  perspV: number;
  perspH: number;
  /** Point tone curve: (x,y) control points normalized [0,1], sorted by x. */
  toneCurve: Array<[number, number]>;
  /** Per-channel point curves (composed under the master). */
  toneCurveR: Array<[number, number]>;
  toneCurveG: Array<[number, number]>;
  toneCurveB: Array<[number, number]>;
  /** Parametric curve regions (-100..100), applied under the point curves. */
  curveHighlights: number;
  curveLights: number;
  curveDarks: number;
  curveShadows: number;
  /** HSL mixer: 8 bands (Red→Magenta), values -100..100. */
  hslHue: number[];
  hslSat: number[];
  hslLum: number[];
  /** Color grading: per-zone hue 0..360, sat 0..100, lum -100..100; balance -100..100. */
  gradeShadowHue: number;
  gradeShadowSat: number;
  gradeShadowLum: number;
  gradeMidHue: number;
  gradeMidSat: number;
  gradeMidLum: number;
  gradeHighHue: number;
  gradeHighSat: number;
  gradeHighLum: number;
  gradeBalance: number;
  /** Effects: post-crop vignette + grain. */
  vignetteAmount: number;
  vignetteMidpoint: number;
  grainAmount: number;
  /** Treatment: black & white. */
  blackWhite: boolean;
  /** Calibration: per-primary hue (±100→±45°) and saturation (-100..100). */
  calRedHue: number;
  calRedSat: number;
  calGreenHue: number;
  calGreenSat: number;
  calBlueHue: number;
  calBlueSat: number;
  /** Detail: unsharp-mask sharpening (0..100) + edge masking (0..100). */
  sharpenAmount: number;
  sharpenMasking: number;
  /** Detail: noise reduction (0..100). */
  noiseLuminance: number;
  noiseColor: number;
  /** Local adjustment masks (max 4 rendered). */
  masks: Mask[];
  /** Heal/clone spots (max 8 rendered). */
  spots: Spot[];
}

/** One heal/clone spot (frame coords). */
export interface Spot {
  x: number;
  y: number;
  srcX: number;
  srcY: number;
  radius: number;
  heal: boolean;
  /** Edge softness 0..1 (0 = hard stamp). */
  feather: number;
}

export const DEFAULT_SPOT: Spot = {
  x: 0.5,
  y: 0.5,
  srcX: 0.58,
  srcY: 0.5,
  radius: 0.04,
  heal: true,
  feather: 0.4,
};

/** One local-adjustment mask; geometry normalized over the straightened frame. */
export interface Mask {
  kind: "linear" | "radial" | "brush" | "raster" | "global";
  /** Raster masks: weight-map PNG id in the cache (lumen://mask/<id>). */
  rasterId: string;
  x0: number; // linear start / radial center
  y0: number;
  x1: number; // linear end / radial radii / brush stroke radius
  y1: number;
  /** Brush stroke path (frame coords, max 24 points). */
  points: Array<[number, number]>;
  feather: number;
  /** Radial ellipse rotation, degrees (-180..180). */
  rotation: number;
  invert: boolean;
  exposure: number; // EV
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  /** Range refinement. */
  rangeType: "none" | "luminance" | "color";
  rangeLo: number;
  rangeHi: number;
  rangeSoft: number;
  rangeHue: number;
  rangeTol: number;
}

export const DEFAULT_RADIAL_MASK: Mask = {
  kind: "radial",
  rasterId: "",
  x0: 0.5,
  y0: 0.5,
  x1: 0.25,
  y1: 0.25,
  points: [],
  feather: 0.5,
  rotation: 0,
  invert: false,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  rangeType: "none",
  rangeLo: 0,
  rangeHi: 1,
  rangeSoft: 0.1,
  rangeHue: 0,
  rangeTol: 0.3,
};

export const DEFAULT_LINEAR_MASK: Mask = {
  ...DEFAULT_RADIAL_MASK,
  kind: "linear",
  x0: 0.5,
  y0: 0,
  x1: 0.5,
  y1: 0.6,
};

export const DEFAULT_BRUSH_MASK: Mask = {
  ...DEFAULT_RADIAL_MASK,
  kind: "brush",
  x1: 0.06, // stroke radius
  points: [],
};

export const NEUTRAL_EDIT: EditParams = {
  profile: "",
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  clarity: 0,
  dehaze: 0,
  texture: 0,
  cropX: 0,
  cropY: 0,
  cropW: 1,
  cropH: 1,
  angle: 0,
  caRed: 0,
  caBlue: 0,
  distortion: 0,
  lensA: 0,
  lensB: 0,
  lensC: 0,
  perspV: 0,
  perspH: 0,
  toneCurve: [
    [0, 0],
    [1, 1],
  ],
  toneCurveR: [
    [0, 0],
    [1, 1],
  ],
  toneCurveG: [
    [0, 0],
    [1, 1],
  ],
  toneCurveB: [
    [0, 0],
    [1, 1],
  ],
  curveHighlights: 0,
  curveLights: 0,
  curveDarks: 0,
  curveShadows: 0,
  hslHue: [0, 0, 0, 0, 0, 0, 0, 0],
  hslSat: [0, 0, 0, 0, 0, 0, 0, 0],
  hslLum: [0, 0, 0, 0, 0, 0, 0, 0],
  gradeShadowHue: 0,
  gradeShadowSat: 0,
  gradeShadowLum: 0,
  gradeMidHue: 0,
  gradeMidSat: 0,
  gradeMidLum: 0,
  gradeHighHue: 0,
  gradeHighSat: 0,
  gradeHighLum: 0,
  gradeBalance: 0,
  vignetteAmount: 0,
  vignetteMidpoint: 50,
  grainAmount: 0,
  blackWhite: false,
  calRedHue: 0,
  calRedSat: 0,
  calGreenHue: 0,
  calGreenSat: 0,
  calBlueHue: 0,
  calBlueSat: 0,
  sharpenAmount: 0,
  sharpenMasking: 0,
  noiseLuminance: 0,
  noiseColor: 0,
  masks: [],
  spots: [],
};

export function gradeIsIdentity(p: EditParams): boolean {
  return (
    p.gradeShadowSat === 0 &&
    p.gradeMidSat === 0 &&
    p.gradeHighSat === 0 &&
    p.gradeShadowLum === 0 &&
    p.gradeMidLum === 0 &&
    p.gradeHighLum === 0
  );
}

export function hslIsIdentity(p: EditParams): boolean {
  return [...p.hslHue, ...p.hslSat, ...p.hslLum].every((v) => v === 0);
}

export function geometryIsIdentity(p: EditParams): boolean {
  return (
    p.angle === 0 &&
    p.cropX === 0 &&
    p.cropY === 0 &&
    p.cropW === 1 &&
    p.cropH === 1 &&
    p.perspV === 0 &&
    p.perspH === 0
  );
}

/** Keys of EditParams whose values are plain numbers (slider-driveable). */
export type NumericEditKey = {
  [K in keyof EditParams]: EditParams[K] extends number ? K : never;
}[keyof EditParams];

export function curveIsIdentity(curve: Array<[number, number]>): boolean {
  return (
    curve.length < 2 ||
    (curve.length === 2 &&
      curve[0][0] === 0 && curve[0][1] === 0 &&
      curve[1][0] === 1 && curve[1][1] === 1)
  );
}

/** A virtual album. */
export interface Collection {
  id: number;
  name: string;
  count: number;
  /** Publish-to-folder destination (null = not configured). */
  publishDir: string | null;
}

/** A tag; `count` populated in list contexts. */
export interface Keyword {
  id: number;
  name: string;
  count: number;
  /** Hierarchical keywords: parent keyword id (null = root). */
  parentId: number | null;
}

/** A reusable develop "look" (geometry stripped on save/apply). */
export interface Preset {
  id: number;
  name: string;
  params: EditParams;
  createdAt: number;
}

/** A named point-in-time state of one image's settings (incl. geometry). */
export interface Snapshot {
  id: number;
  name: string;
  params: EditParams;
  createdAt: number;
}

/** Copy of `p` with neutral geometry — used when saving/applying presets. */
export function stripGeometry(p: EditParams): EditParams {
  return { ...p, cropX: 0, cropY: 0, cropW: 1, cropH: 1, angle: 0, perspV: 0, perspH: 0 };
}

/** Apply a preset onto current params, preserving the photo's own geometry. */
export function mergePreset(current: EditParams, preset: EditParams): EditParams {
  return {
    ...preset,
    cropX: current.cropX,
    cropY: current.cropY,
    cropW: current.cropW,
    cropH: current.cropH,
    angle: current.angle,
    perspV: current.perspV,
    perspH: current.perspH,
  };
}

export interface HistoryStep {
  seq: number;
  label: string;
  params: EditParams;
  createdAt: number;
}

// Discriminated union mirroring Rust's ScanEvent enum (serde tag = "type").
export type ScanEvent =
  | { type: "started"; total: number }
  | { type: "imported"; image: ImageMeta }
  | { type: "failed"; path: string; error: string }
  | { type: "progress"; done: number; total: number }
  | { type: "finished"; imported: number; failed: number };
