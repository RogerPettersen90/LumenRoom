use serde::{Deserialize, Serialize};

/// Metadata for one catalogued image. `camelCase` so it maps 1:1 onto the
/// TypeScript `ImageMeta` interface on the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub format: String,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<u32>,
    pub aperture: Option<f32>,
    pub shutter: Option<String>,
    pub focal_length: Option<f32>,
    pub captured_at: Option<i64>,
    pub orientation: u16,
    pub rating: i32,
    pub flag: i32,
    /// classic-style color label: red/yellow/green/blue/purple, or None.
    pub color_label: Option<String>,
    /// When set, this row is a virtual copy of the referenced image id.
    pub copy_of: Option<String>,
    /// Stacking: photos sharing a stack_id form a stack; stack_pos orders
    /// them (0 = top, the photo shown while the stack is collapsed).
    pub stack_id: Option<String>,
    pub stack_pos: i32,
    /// The frontend builds `lumen://thumb/{id}` — no bytes cross the IPC bridge.
    pub thumb_ready: bool,
}

/// Mirrors the JSON stored in `edit_params.params`. Defaults are a neutral
/// edit, so a fresh image renders identically to the original until the user
/// moves a slider. (`serde(default)` keeps previously saved JSON compatible
/// whenever new fields are added.)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EditParams {
    /// Camera profile / base look applied under all user adjustments
    /// ("" = neutral default; "color"|"vivid"|"portrait"|"landscape"|"bw").
    /// Looks are defined in pipeline.rs `profile_look` (=== profiles.ts).
    pub profile: String,
    pub exposure: f32,    // EV, -5.0 ..= 5.0
    pub contrast: f32,    // -100 ..= 100
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32, // white-balance Kelvin offset
    pub tint: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub clarity: f32,
    /// Presence: dehaze (-100..100), pointwise veil removal approximation.
    pub dehaze: f32,
    /// Presence: texture (-100..100), mid-frequency band enhancement
    /// (positive crisps fine detail, negative smooths skin).
    pub texture: f32,
    // Geometry: crop rect normalized [0,1] over the straightened frame, plus
    // the straighten angle in degrees (auto-zoomed so no empty corners).
    pub crop_x: f32,
    pub crop_y: f32,
    pub crop_w: f32, // default 1.0
    pub crop_h: f32, // default 1.0
    pub angle: f32,  // -45 ..= 45
    /// Lateral chromatic aberration correction: radial scale of the R and B
    /// channels relative to G (-100..100 → ±0.5%).
    pub ca_red: f32,
    pub ca_blue: f32,
    /// Lens distortion correction (-100..100 → ±0.15 radial r² coefficient;
    /// positive corrects barrel, negative corrects pincushion).
    pub distortion: f32,
    /// Lens-profile distortion (lensfun, ptlens cubic: Rd = Ru·(a·Ru³ +
    /// b·Ru² + c·Ru + d), d = 1−a−b−c, r normalized to min(w,h)/2).
    /// All zero = no profile.
    pub lens_a: f32,
    pub lens_b: f32,
    pub lens_c: f32,
    /// Transform: perspective keystone correction (-100..100 → ±0.35
    /// projective coefficient). Vertical fixes converging buildings.
    pub persp_v: f32,
    pub persp_h: f32,
    /// Point tone curve: control points (x, y) normalized [0,1], sorted by x.
    /// Default [(0,0),(1,1)] = identity. Interpolated with a monotone cubic.
    pub tone_curve: Vec<(f32, f32)>,
    /// Per-channel point curves (applied before the master curve composes).
    pub tone_curve_r: Vec<(f32, f32)>,
    pub tone_curve_g: Vec<(f32, f32)>,
    pub tone_curve_b: Vec<(f32, f32)>,
    /// Parametric curve regions (-100..100), applied under the point curves.
    pub curve_highlights: f32,
    pub curve_lights: f32,
    pub curve_darks: f32,
    pub curve_shadows: f32,
    /// HSL / Color Mixer: per-band adjustments (-100..100), 8 bands in order
    /// Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta.
    pub hsl_hue: [f32; 8],
    pub hsl_sat: [f32; 8],
    pub hsl_lum: [f32; 8],
    /// Color grading (3-way split toning): per-zone hue (0..360°),
    /// saturation (0..100) and luminance (-100..100), plus balance (-100..100)
    /// which shifts the shadows/highlights pivot.
    pub grade_shadow_hue: f32,
    pub grade_shadow_sat: f32,
    pub grade_shadow_lum: f32,
    pub grade_mid_hue: f32,
    pub grade_mid_sat: f32,
    pub grade_mid_lum: f32,
    pub grade_high_hue: f32,
    pub grade_high_sat: f32,
    pub grade_high_lum: f32,
    pub grade_balance: f32,
    /// Effects: post-crop vignette (amount -100..100, midpoint 0..100) + grain.
    pub vignette_amount: f32,
    pub vignette_midpoint: f32, // default 50
    pub grain_amount: f32,      // 0..100
    /// Treatment: render as black & white (channel-neutral luma conversion).
    pub black_white: bool,
    /// Calibration: per-primary hue (-100..100 → ±45°) and saturation
    /// (-100..100) remapping of the camera primaries (the classic Calibration).
    pub cal_red_hue: f32,
    pub cal_red_sat: f32,
    pub cal_green_hue: f32,
    pub cal_green_sat: f32,
    pub cal_blue_hue: f32,
    pub cal_blue_sat: f32,
    /// Detail: unsharp-mask sharpening amount (0..100) + edge masking
    /// (0..100; higher = only strong edges get sharpened, the classic Masking).
    pub sharpen_amount: f32,
    pub sharpen_masking: f32,
    /// Detail: noise reduction (0..100) — luminance (edge-preserving bilateral)
    /// and color (chroma smoothing).
    pub noise_luminance: f32,
    pub noise_color: f32,
    /// Local adjustment masks (linear/radial gradients), in straightened-frame
    /// normalized coordinates so they stay glued to the image through crops.
    pub masks: Vec<Mask>,
    /// Heal/clone spots (frame coords; preview renders the first 8).
    pub spots: Vec<Spot>,
}

/// One heal/clone spot: replace the circle at (x,y) with pixels sampled from
/// (src_x, src_y). Heal additionally transfers the destination's low
/// frequency so the patch blends tonally.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Spot {
    pub x: f32,
    pub y: f32,
    pub src_x: f32,
    pub src_y: f32,
    pub radius: f32,
    pub heal: bool,
    /// Edge softness 0..1 (0 = hard stamp, 1 = blend from the center out).
    pub feather: f32,
}

impl Default for Spot {
    fn default() -> Self {
        Spot {
            x: 0.5,
            y: 0.5,
            src_x: 0.58,
            src_y: 0.5,
            radius: 0.04,
            heal: true,
            feather: 0.4,
        }
    }
}

/// One local-adjustment mask. Geometry is normalized [0,1] over the
/// straightened (pre-crop) frame, top-down.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Mask {
    pub kind: String, // "linear" | "radial" | "brush" | "raster"
    /// Raster masks: id of a grayscale weight-map PNG in the cache's masks/
    /// dir (frame-space, top-down). Generated (luminosity masks today, AI
    /// segmentation later) — referenced, never inlined in JSON.
    pub raster_id: String,
    /// linear: gradient start; radial: center; brush: unused.
    pub x0: f32,
    pub y0: f32,
    /// linear: gradient end; radial: radii (rx, ry); brush: x1 = stroke radius.
    pub x1: f32,
    pub y1: f32,
    /// Brush stroke path (frame coords, capped at 24 points).
    pub points: Vec<(f32, f32)>,
    pub feather: f32, // radial edge softness 0..1
    /// Radial ellipse rotation in degrees (-180..180).
    pub rotation: f32,
    pub invert: bool,
    // Local adjustments (exposure in EV; the rest -100..100).
    pub exposure: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    // Range refinement: restrict the mask by pixel luminance or color.
    pub range_type: String, // "none" | "luminance" | "color"
    pub range_lo: f32,      // luminance band low (0..1)
    pub range_hi: f32,      // luminance band high (0..1)
    pub range_soft: f32,    // band edge softness (0..0.5)
    pub range_hue: f32,     // color target hue (0..360)
    pub range_tol: f32,     // color tolerance (0..1)
}

impl Default for Mask {
    fn default() -> Self {
        Mask {
            kind: "radial".into(),
            raster_id: String::new(),
            x0: 0.5,
            y0: 0.5,
            x1: 0.25,
            y1: 0.25,
            points: Vec::new(),
            feather: 0.5,
            rotation: 0.0,
            invert: false,
            exposure: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            temperature: 0.0,
            tint: 0.0,
            range_type: "none".into(),
            range_lo: 0.0,
            range_hi: 1.0,
            range_soft: 0.1,
            range_hue: 0.0,
            range_tol: 0.3,
        }
    }
}

impl Default for EditParams {
    fn default() -> Self {
        EditParams {
            profile: String::new(),
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            temperature: 0.0,
            tint: 0.0,
            saturation: 0.0,
            vibrance: 0.0,
            clarity: 0.0,
            dehaze: 0.0,
            texture: 0.0,
            crop_x: 0.0,
            crop_y: 0.0,
            crop_w: 1.0,
            crop_h: 1.0,
            angle: 0.0,
            ca_red: 0.0,
            ca_blue: 0.0,
            distortion: 0.0,
            lens_a: 0.0,
            lens_b: 0.0,
            lens_c: 0.0,
            persp_v: 0.0,
            persp_h: 0.0,
            tone_curve: vec![(0.0, 0.0), (1.0, 1.0)],
            tone_curve_r: vec![(0.0, 0.0), (1.0, 1.0)],
            tone_curve_g: vec![(0.0, 0.0), (1.0, 1.0)],
            tone_curve_b: vec![(0.0, 0.0), (1.0, 1.0)],
            curve_highlights: 0.0,
            curve_lights: 0.0,
            curve_darks: 0.0,
            curve_shadows: 0.0,
            hsl_hue: [0.0; 8],
            hsl_sat: [0.0; 8],
            hsl_lum: [0.0; 8],
            grade_shadow_hue: 0.0,
            grade_shadow_sat: 0.0,
            grade_shadow_lum: 0.0,
            grade_mid_hue: 0.0,
            grade_mid_sat: 0.0,
            grade_mid_lum: 0.0,
            grade_high_hue: 0.0,
            grade_high_sat: 0.0,
            grade_high_lum: 0.0,
            grade_balance: 0.0,
            vignette_amount: 0.0,
            vignette_midpoint: 50.0,
            grain_amount: 0.0,
            black_white: false,
            cal_red_hue: 0.0,
            cal_red_sat: 0.0,
            cal_green_hue: 0.0,
            cal_green_sat: 0.0,
            cal_blue_hue: 0.0,
            cal_blue_sat: 0.0,
            sharpen_amount: 0.0,
            sharpen_masking: 0.0,
            noise_luminance: 0.0,
            noise_color: 0.0,
            masks: Vec::new(),
            spots: Vec::new(),
        }
    }
}

impl EditParams {
    /// True when the geometry is untouched (full frame, no rotation/keystone).
    pub fn geometry_is_identity(&self) -> bool {
        self.angle == 0.0
            && self.crop_x == 0.0
            && self.crop_y == 0.0
            && self.crop_w == 1.0
            && self.crop_h == 1.0
            && self.persp_v == 0.0
            && self.persp_h == 0.0
    }

    /// True when one curve is the identity (straight 0→1 diagonal).
    pub fn one_curve_is_identity(c: &[(f32, f32)]) -> bool {
        c.len() < 2 || c == [(0.0, 0.0), (1.0, 1.0)]
    }

    /// True when master, channel AND parametric curves are all identity.
    pub fn curve_is_identity(&self) -> bool {
        Self::one_curve_is_identity(&self.tone_curve)
            && Self::one_curve_is_identity(&self.tone_curve_r)
            && Self::one_curve_is_identity(&self.tone_curve_g)
            && Self::one_curve_is_identity(&self.tone_curve_b)
            && self.curve_highlights == 0.0
            && self.curve_lights == 0.0
            && self.curve_darks == 0.0
            && self.curve_shadows == 0.0
    }

    /// True when Calibration is untouched.
    pub fn calibration_is_identity(&self) -> bool {
        self.cal_red_hue == 0.0
            && self.cal_red_sat == 0.0
            && self.cal_green_hue == 0.0
            && self.cal_green_sat == 0.0
            && self.cal_blue_hue == 0.0
            && self.cal_blue_sat == 0.0
    }

    /// True when the HSL mixer is untouched (all 24 sliders at zero).
    pub fn hsl_is_identity(&self) -> bool {
        self.hsl_hue.iter().all(|v| *v == 0.0)
            && self.hsl_sat.iter().all(|v| *v == 0.0)
            && self.hsl_lum.iter().all(|v| *v == 0.0)
    }
}

/// A reusable develop "look" (geometry excluded on save/apply).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: i64,
    pub name: String,
    pub params: EditParams,
    pub created_at: i64,
}

/// A named point-in-time state of one image's develop settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: i64,
    pub name: String,
    pub params: EditParams,
    pub created_at: i64,
}

/// A virtual album. `count` is populated in list contexts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub count: i64,
    /// Publish-to-folder: destination directory (None = not configured).
    pub publish_dir: Option<String>,
}

/// A tag. `count` is populated in list contexts (0 otherwise).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyword {
    pub id: i64,
    pub name: String,
    pub count: i64,
    /// Hierarchical keywords: parent keyword id (None = root). Created via
    /// "Travel > Norway" syntax; filtering a parent includes descendants.
    pub parent_id: Option<i64>,
}

/// One entry in an image's history log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStep {
    pub seq: i64,
    pub label: String,
    pub params: EditParams,
    pub created_at: i64,
}
