// Built-in camera profiles (the classic editor's Profile slot atop the Basic panel):
// a base look applied UNDER every user adjustment — a tone curve composed
// beneath the user curves, a global saturation multiplier, and an optional
// B&W treatment. "" (or any unknown id) is the neutral default.
// MUST match `profile_look` in src-tauri/src/imaging/pipeline.rs.

import type { CurvePoints } from "./curve";

export interface ProfileDef {
  id: string;
  label: string;
  /** Base tone curve, or null for identity. */
  curve: CurvePoints | null;
  /** Global saturation multiplier (1 = neutral). */
  sat: number;
  /** Renders as black & white (like the Treatment toggle). */
  bw: boolean;
}

export const PROFILES: ProfileDef[] = [
  { id: "", label: "Default", curve: null, sat: 1.0, bw: false },
  {
    id: "color",
    label: "Color",
    curve: [[0, 0], [0.25, 0.24], [0.5, 0.51], [0.75, 0.765], [1, 1]],
    sat: 1.08,
    bw: false,
  },
  {
    id: "vivid",
    label: "Vivid",
    curve: [[0, 0], [0.25, 0.225], [0.5, 0.515], [0.75, 0.78], [1, 1]],
    sat: 1.2,
    bw: false,
  },
  {
    id: "portrait",
    label: "Portrait",
    curve: [[0, 0], [0.25, 0.262], [0.5, 0.505], [0.75, 0.755], [1, 1]],
    sat: 1.02,
    bw: false,
  },
  {
    id: "landscape",
    label: "Landscape",
    curve: [[0, 0], [0.25, 0.23], [0.5, 0.51], [0.75, 0.775], [1, 1]],
    sat: 1.15,
    bw: false,
  },
  { id: "bw", label: "Black & White", curve: null, sat: 1.0, bw: true },
];

const NEUTRAL: ProfileDef = PROFILES[0];

export function profileLook(id: string): ProfileDef {
  return PROFILES.find((p) => p.id === id) ?? NEUTRAL;
}
