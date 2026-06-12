use crate::db::models::EditParams;
use image::RgbImage;
use rayon::prelude::*;

// Full-resolution develop pipeline. This is the CPU twin of the WebGL fragment
// shader in src/features/develop/gl/Renderer.ts — the operations and constants
// are kept in lockstep so an exported image matches the live preview. When you
// change one, change the other.

/// Normalised parameters (UI ranges mapped into the shader's working space).
struct Norm {
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    temp: f32,
    tint: f32,
    saturation: f32,
    vibrance: f32,
    clarity: f32,
    dehaze: f32,
    // Color grading: per-zone (hue 0..1, sat 0..1, lum -1..1) + balance -1..1.
    grade_s: (f32, f32, f32),
    grade_m: (f32, f32, f32),
    grade_h: (f32, f32, f32),
    grade_balance: f32,
    bw: bool,
    /// Profile saturation multiplier (1.0 = neutral), applied with Saturation.
    sat_mul: f32,
}

impl Norm {
    fn from(p: &EditParams) -> Self {
        // exposure is already in EV; everything else is a -100..100 UI slider
        // (grading hues are 0..360°, sats 0..100).
        let (_, sat_mul, prof_bw) = profile_look(&p.profile);
        Norm {
            exposure: p.exposure,
            contrast: p.contrast / 100.0,
            highlights: p.highlights / 100.0,
            shadows: p.shadows / 100.0,
            whites: p.whites / 100.0,
            blacks: p.blacks / 100.0,
            temp: p.temperature / 100.0,
            tint: p.tint / 100.0,
            saturation: p.saturation / 100.0,
            vibrance: p.vibrance / 100.0,
            clarity: p.clarity / 100.0,
            dehaze: p.dehaze / 100.0,
            grade_s: (
                p.grade_shadow_hue / 360.0,
                p.grade_shadow_sat / 100.0,
                p.grade_shadow_lum / 100.0,
            ),
            grade_m: (
                p.grade_mid_hue / 360.0,
                p.grade_mid_sat / 100.0,
                p.grade_mid_lum / 100.0,
            ),
            grade_h: (
                p.grade_high_hue / 360.0,
                p.grade_high_sat / 100.0,
                p.grade_high_lum / 100.0,
            ),
            grade_balance: p.grade_balance / 100.0,
            bw: p.black_white || prof_bw,
            sat_mul,
        }
    }

    fn grade_is_identity(&self) -> bool {
        self.grade_s.1 == 0.0
            && self.grade_m.1 == 0.0
            && self.grade_h.1 == 0.0
            && self.grade_s.2 == 0.0
            && self.grade_m.2 == 0.0
            && self.grade_h.2 == 0.0
    }

    fn is_identity(&self) -> bool {
        self.exposure == 0.0
            && self.contrast == 0.0
            && self.highlights == 0.0
            && self.shadows == 0.0
            && self.whites == 0.0
            && self.blacks == 0.0
            && self.temp == 0.0
            && self.tint == 0.0
            && self.saturation == 0.0
            && self.vibrance == 0.0
            && self.clarity == 0.0
            && self.dehaze == 0.0
            && self.grade_is_identity()
            && !self.bw
            && self.sat_mul == 1.0
    }
}

/// Built-in camera profiles (the classic Profile slot atop Basic): a base look applied
/// UNDER every user adjustment — a tone curve composed beneath the user curves,
/// a global saturation multiplier, and an optional B&W treatment. "" (or any
/// unknown name) is the neutral default, preserving pre-profile renders.
/// MUST match PROFILES in src/features/develop/profiles.ts.
pub fn profile_look(name: &str) -> (Option<Vec<(f32, f32)>>, f32, bool) {
    match name {
        "color" => (
            Some(vec![(0.0, 0.0), (0.25, 0.24), (0.5, 0.51), (0.75, 0.765), (1.0, 1.0)]),
            1.08,
            false,
        ),
        "vivid" => (
            Some(vec![(0.0, 0.0), (0.25, 0.225), (0.5, 0.515), (0.75, 0.78), (1.0, 1.0)]),
            1.20,
            false,
        ),
        "portrait" => (
            Some(vec![(0.0, 0.0), (0.25, 0.262), (0.5, 0.505), (0.75, 0.755), (1.0, 1.0)]),
            1.02,
            false,
        ),
        "landscape" => (
            Some(vec![(0.0, 0.0), (0.25, 0.23), (0.5, 0.51), (0.75, 0.775), (1.0, 1.0)]),
            1.15,
            false,
        ),
        "bw" => (None, 1.0, true),
        _ => (None, 1.0, false),
    }
}

/// Apply `params` to an image, returning a new edited RGB buffer. Pixels are
/// processed in parallel across all cores.
pub fn apply_edits(img: &image::DynamicImage, params: &EditParams) -> RgbImage {
    let mut rgb = img.to_rgb8();
    let n = Norm::from(params);
    let lut = if params.curve_is_identity() && profile_look(&params.profile).0.is_none() {
        None
    } else {
        Some(channel_curve_luts(params))
    };
    let hsl = if params.hsl_is_identity() {
        None
    } else {
        Some(hsl_lut(params))
    };
    let cal = calibration_matrix(params);
    if n.is_identity() && lut.is_none() && hsl.is_none() && cal.is_none() {
        return rgb; // nothing to do — return the decoded original untouched
    }

    rgb.par_chunks_mut(3).for_each(|px| {
        let (r, g, b) = process(
            px[0] as f32 / 255.0,
            px[1] as f32 / 255.0,
            px[2] as f32 / 255.0,
            &n,
            lut.as_ref(),
            hsl.as_ref(),
            cal.as_ref(),
        );
        px[0] = (r * 255.0).round().clamp(0.0, 255.0) as u8;
        px[1] = (g * 255.0).round().clamp(0.0, 255.0) as u8;
        px[2] = (b * 255.0).round().clamp(0.0, 255.0) as u8;
    });

    rgb
}

/// Bake a point tone curve into a 256-entry LUT using Fritsch–Carlson
/// monotone cubic interpolation (no overshoot — the standard for photo
/// curves). MUST match `evalCurve` in src/features/develop/curve.ts.
pub fn curve_lut(points: &[(f32, f32)]) -> [f32; 256] {
    let mut lut = [0f32; 256];
    let n = points.len();
    if n < 2 {
        for (i, v) in lut.iter_mut().enumerate() {
            *v = i as f32 / 255.0;
        }
        return lut;
    }

    // Interval slopes.
    let mut d = vec![0f32; n - 1];
    for i in 0..n - 1 {
        let dx = (points[i + 1].0 - points[i].0).max(1e-6);
        d[i] = (points[i + 1].1 - points[i].1) / dx;
    }
    // Tangents (Fritsch–Carlson).
    let mut m = vec![0f32; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        m[i] = if d[i - 1] * d[i] <= 0.0 {
            0.0
        } else {
            (d[i - 1] + d[i]) * 0.5
        };
    }
    for i in 0..n - 1 {
        if d[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let a = m[i] / d[i];
            let b = m[i + 1] / d[i];
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }
    }

    for (i, v) in lut.iter_mut().enumerate() {
        let x = i as f32 / 255.0;
        *v = if x <= points[0].0 {
            points[0].1
        } else if x >= points[n - 1].0 {
            points[n - 1].1
        } else {
            // Find the interval and evaluate the cubic Hermite.
            let mut k = 0;
            while k < n - 2 && x > points[k + 1].0 {
                k += 1;
            }
            let h = (points[k + 1].0 - points[k].0).max(1e-6);
            let t = (x - points[k].0) / h;
            let t2 = t * t;
            let t3 = t2 * t;
            let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
            let h10 = t3 - 2.0 * t2 + t;
            let h01 = -2.0 * t3 + 3.0 * t2;
            let h11 = t3 - t2;
            h00 * points[k].1 + h10 * h * m[k] + h01 * points[k + 1].1 + h11 * h * m[k + 1]
        }
        .clamp(0.0, 1.0);
    }
    lut
}

/// Local adjustment masks: per-pixel weight from each mask's geometry (in
/// straightened-frame coords, derived from the crop), then the mask's scaled
/// adjustments. MUST match the masking block in the WebGL shader.
pub fn apply_masks(img: &mut RgbImage, p: &EditParams) {
    apply_masks_with(img, p, &[]);
}

/// Load the weight-map PNGs referenced by the first 4 masks ("raster" kind)
/// from `masks_dir`. Missing/broken files degrade to a no-op mask.
pub fn load_mask_rasters(
    p: &EditParams,
    masks_dir: &std::path::Path,
) -> Vec<Option<image::GrayImage>> {
    p.masks
        .iter()
        .take(4)
        .map(|m| {
            if m.kind != "raster" || m.raster_id.is_empty() {
                return None;
            }
            image::open(masks_dir.join(format!("{}.png", m.raster_id)))
                .ok()
                .map(|i| i.to_luma8())
        })
        .collect()
}

/// Like `apply_masks`, with pre-loaded raster weight maps (index-aligned with
/// the first 4 masks; None for non-raster kinds).
pub fn apply_masks_with(
    img: &mut RgbImage,
    p: &EditParams,
    rasters: &[Option<image::GrayImage>],
) {
    if p.masks.is_empty() {
        return;
    }
    let masks: Vec<&crate::db::models::Mask> = p.masks.iter().take(4).collect();
    let (w, h) = (img.width() as f32, img.height() as f32);

    img.enumerate_rows_mut().par_bridge().for_each(|(y, row)| {
        let v = (y as f32 + 0.5) / h;
        for (x, _, px) in row {
            let u = (x as f32 + 0.5) / w;
            // Output (cropped) uv -> straightened-frame uv.
            let fx = p.crop_x + u * p.crop_w;
            let fy = p.crop_y + v * p.crop_h;

            let mut c = [
                px.0[0] as f32 / 255.0,
                px.0[1] as f32 / 255.0,
                px.0[2] as f32 / 255.0,
            ];

            for (i, m) in masks.iter().enumerate() {
                let raster = rasters.get(i).and_then(|o| o.as_ref());
                let mut wgt = mask_weight(m, fx, fy, raster);
                if wgt > 0.001 {
                    wgt *= range_weight(m, c[0], c[1], c[2]);
                }
                if wgt <= 0.001 {
                    continue;
                }
                c = apply_local(c, m, wgt);
            }

            for i in 0..3 {
                px.0[i] = (c[i] * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    });
}

/// Bilinear sample of a grayscale weight map at normalized top-down coords.
/// GL texel-center convention (uv·size − 0.5) so exports match the shader.
fn raster_sample(map: &image::GrayImage, fx: f32, fy: f32) -> f32 {
    let (w, h) = (map.width() as f32, map.height() as f32);
    let x = (fx.clamp(0.0, 1.0) * w - 0.5).clamp(0.0, w - 1.0);
    let y = (fy.clamp(0.0, 1.0) * h - 0.5).clamp(0.0, h - 1.0);
    let (x0, y0) = (x.floor() as u32, y.floor() as u32);
    let (x1, y1) = ((x0 + 1).min(map.width() - 1), (y0 + 1).min(map.height() - 1));
    let (tx, ty) = (x - x0 as f32, y - y0 as f32);
    let at = |xx: u32, yy: u32| map.get_pixel(xx, yy).0[0] as f32 / 255.0;
    let top = at(x0, y0) * (1.0 - tx) + at(x1, y0) * tx;
    let bot = at(x0, y1) * (1.0 - tx) + at(x1, y1) * tx;
    top * (1.0 - ty) + bot * ty
}

/// Mask weight at a frame-space point. Matched with the shader.
fn mask_weight(
    m: &crate::db::models::Mask,
    fx: f32,
    fy: f32,
    raster: Option<&image::GrayImage>,
) -> f32 {
    let w = if m.kind == "global" {
        // Whole frame; shaping comes entirely from the per-pixel range
        // refinement (full-res, halo-free luminosity/color masks).
        1.0
    } else if m.kind == "raster" {
        // Weight map painted/generated in frame space (top-down).
        raster.map(|r| raster_sample(r, fx, fy)).unwrap_or(0.0)
    } else if m.kind == "brush" {
        // Distance to the stroke polyline; falloff over radius by feather.
        if m.points.is_empty() {
            0.0
        } else {
            let mut dist = f32::MAX;
            if m.points.len() == 1 {
                let (px, py) = m.points[0];
                dist = ((fx - px).powi(2) + (fy - py).powi(2)).sqrt();
            } else {
                for seg in m.points.windows(2) {
                    let (ax, ay) = seg[0];
                    let (bx, by) = seg[1];
                    let abx = bx - ax;
                    let aby = by - ay;
                    let len2 = (abx * abx + aby * aby).max(1e-8);
                    let t = (((fx - ax) * abx + (fy - ay) * aby) / len2).clamp(0.0, 1.0);
                    let dx = fx - (ax + t * abx);
                    let dy = fy - (ay + t * aby);
                    dist = dist.min((dx * dx + dy * dy).sqrt());
                }
            }
            let r = m.x1.max(0.005); // x1 = stroke radius for brushes
            1.0 - smoothstep(r * (1.0 - m.feather.clamp(0.0, 0.99)), r, dist)
        }
    } else if m.kind == "linear" {
        // Full effect at (x0,y0), fading to none at (x1,y1). Feather widens/
        // narrows the transition band around the midpoint; 0.5 spans the
        // whole gradient (the historical look). MUST match the shader.
        let dx = m.x1 - m.x0;
        let dy = m.y1 - m.y0;
        let len2 = (dx * dx + dy * dy).max(1e-6);
        let t = ((fx - m.x0) * dx + (fy - m.y0) * dy) / len2;
        let f = m.feather.clamp(0.01, 1.0);
        1.0 - smoothstep(0.5 - f, 0.5 + f, t)
    } else {
        // Radial: inside the (optionally rotated) ellipse, soft edge by feather.
        let rot = m.rotation.to_radians();
        let (c, s) = (rot.cos(), rot.sin());
        let dx = fx - m.x0;
        let dy = fy - m.y0;
        let rx = dx * c + dy * s; // rotate the sample into ellipse space
        let ry = -dx * s + dy * c;
        let nx = rx / m.x1.max(1e-3);
        let ny = ry / m.y1.max(1e-3);
        let d = (nx * nx + ny * ny).sqrt();
        1.0 - smoothstep(1.0 - m.feather.clamp(0.0, 0.99), 1.0, d)
    };
    if m.invert { 1.0 - w } else { w }
}

/// Range refinement: restrict a mask to a luminance band or a hue
/// neighbourhood of the *current* pixel color. Matched with the shader.
fn range_weight(m: &crate::db::models::Mask, r: f32, g: f32, b: f32) -> f32 {
    match m.range_type.as_str() {
        "luminance" => {
            let l = luma(r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0));
            let soft = m.range_soft.max(0.001);
            smoothstep(m.range_lo - soft, m.range_lo, l)
                * (1.0 - smoothstep(m.range_hi, m.range_hi + soft, l))
        }
        "color" => {
            let (h, s, _v) = rgb2hsv(r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0));
            let target = m.range_hue / 360.0;
            let mut hd = (h - target).abs();
            if hd > 0.5 {
                hd = 1.0 - hd;
            }
            let tol = m.range_tol.max(0.01);
            // Inside half-tolerance fully on, fading to off at full tolerance;
            // gated by saturation so neutrals never match a hue.
            (1.0 - smoothstep(tol * 0.25, tol * 0.5, hd)) * smoothstep(0.05, 0.2, s)
        }
        _ => 1.0,
    }
}

/// Apply one mask's adjustments scaled by weight. Simplified twin of the
/// global pipeline's WB/exposure/contrast/saturation, matched with the shader.
fn apply_local(c: [f32; 3], m: &crate::db::models::Mask, w: f32) -> [f32; 3] {
    let temp = m.temperature / 100.0 * w;
    let tint = m.tint / 100.0 * w;
    let gain = 2f32.powf(m.exposure * w);

    // WB + exposure in linear light.
    let mut r = c[0].max(0.0).powf(2.2) * (1.0 + 0.22 * temp - 0.06 * tint) * gain;
    let mut g = c[1].max(0.0).powf(2.2) * (1.0 + 0.12 * tint) * gain;
    let mut b = c[2].max(0.0).powf(2.2) * (1.0 - 0.22 * temp - 0.06 * tint) * gain;
    let inv = 1.0 / 2.2;
    r = r.max(0.0).powf(inv);
    g = g.max(0.0).powf(inv);
    b = b.max(0.0).powf(inv);

    // Contrast + saturation in display gamma.
    let k = 1.0 + m.contrast / 100.0 * w;
    r = (r - 0.5) * k + 0.5;
    g = (g - 0.5) * k + 0.5;
    b = (b - 0.5) * k + 0.5;
    let l = luma(r, g, b);
    let s = 1.0 + m.saturation / 100.0 * w;
    [
        (l + (r - l) * s).clamp(0.0, 1.0),
        (l + (g - l) * s).clamp(0.0, 1.0),
        (l + (b - l) * s).clamp(0.0, 1.0),
    ]
}

/// Detail: edge-preserving noise reduction. Luminance uses a 5×5 bilateral
/// (range-weighted on luma); color smooths chroma with a 5×5 average. The
/// shader previews a lighter 4-tap approximation — export is reference.
pub fn apply_noise_reduction(img: &RgbImage, p: &EditParams) -> RgbImage {
    let lum_amt = (p.noise_luminance / 100.0).clamp(0.0, 1.0);
    let col_amt = (p.noise_color / 100.0).clamp(0.0, 1.0);
    if lum_amt == 0.0 && col_amt == 0.0 {
        return img.clone();
    }

    let (w, h) = img.dimensions();
    let mut out = img.clone();
    out.enumerate_rows_mut().par_bridge().for_each(|(y, row)| {
        for (x, _, px) in row {
            let center = img.get_pixel(x, y);
            let (cy, ccb, ccr) = to_ycc(center);

            let mut ysum = 0.0;
            let mut ywsum = 0.0;
            let mut cbsum = 0.0;
            let mut crsum = 0.0;
            let mut n = 0.0;
            const SIGMA: f32 = 0.08; // bilateral range sigma (luma 0..1)

            for dy in -2i64..=2 {
                for dx in -2i64..=2 {
                    let sx = (x as i64 + dx).clamp(0, w as i64 - 1) as u32;
                    let sy = (y as i64 + dy).clamp(0, h as i64 - 1) as u32;
                    let (sy_l, s_cb, s_cr) = to_ycc(img.get_pixel(sx, sy));
                    let d = sy_l - cy;
                    let wgt = (-d * d / (2.0 * SIGMA * SIGMA)).exp();
                    ysum += sy_l * wgt;
                    ywsum += wgt;
                    cbsum += s_cb;
                    crsum += s_cr;
                    n += 1.0;
                }
            }

            let y_f = cy + (ysum / ywsum - cy) * lum_amt;
            let cb_f = ccb + (cbsum / n - ccb) * col_amt;
            let cr_f = ccr + (crsum / n - ccr) * col_amt;
            *px = from_ycc(y_f, cb_f, cr_f);
        }
    });
    out
}

#[inline]
fn to_ycc(p: &image::Rgb<u8>) -> (f32, f32, f32) {
    let r = p.0[0] as f32 / 255.0;
    let g = p.0[1] as f32 / 255.0;
    let b = p.0[2] as f32 / 255.0;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    (y, b - y, r - y)
}

#[inline]
fn from_ycc(y: f32, cb: f32, cr: f32) -> image::Rgb<u8> {
    let r = y + cr;
    let b = y + cb;
    let g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
    image::Rgb([
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    ])
}

/// Detail: unsharp-mask sharpening over a 3×3 box blur, on the final colors.
/// (The shader approximates this with a cross kernel on the *input* sample —
/// visually close for moderate amounts; export is the reference quality.)
pub fn apply_detail(img: &RgbImage, p: &EditParams) -> RgbImage {
    let amt = p.sharpen_amount / 100.0;
    let tex = p.texture / 100.0;
    if amt == 0.0 && tex == 0.0 {
        return img.clone();
    }
    let (w, h) = img.dimensions();
    let mut out = img.clone();
    out.enumerate_rows_mut().par_bridge().for_each(|(y, row)| {
        for (x, _, px) in row {
            let mut acc = [0f32; 3];
            let mut acc5 = [0f32; 3];
            for dy in -2i64..=2 {
                for dx in -2i64..=2 {
                    let sx = (x as i64 + dx).clamp(0, w as i64 - 1) as u32;
                    let sy = (y as i64 + dy).clamp(0, h as i64 - 1) as u32;
                    let s = img.get_pixel(sx, sy);
                    let inner = dx.abs() <= 1 && dy.abs() <= 1;
                    for c in 0..3 {
                        acc5[c] += s.0[c] as f32;
                        if inner {
                            acc[c] += s.0[c] as f32;
                        }
                    }
                }
            }
            let orig = img.get_pixel(x, y);

            // Texture: enhance (or smooth) the mid-frequency band — the
            // difference between the 3×3 and 5×5 neighbourhood means.
            let tex_term = |c: usize| -> f32 {
                if tex == 0.0 {
                    0.0
                } else {
                    tex * 1.5 * (acc[c] / 9.0 - acc5[c] / 25.0)
                }
            };

            // Edge masking (the classic Masking slider): weight the unsharp by edge
            // strength so flat areas (skies, skin) stay clean. Matched with
            // the shader's cross-kernel version.
            let m = (p.sharpen_masking / 100.0).clamp(0.0, 1.0);
            let edge_w = if m > 0.0 {
                let lum_o = (orig.0[0] as f32 * 0.2126
                    + orig.0[1] as f32 * 0.7152
                    + orig.0[2] as f32 * 0.0722)
                    / 255.0;
                let lum_b =
                    (acc[0] * 0.2126 + acc[1] * 0.7152 + acc[2] * 0.0722) / (9.0 * 255.0);
                smoothstep(0.015 * m, 0.06 * m, (lum_o - lum_b).abs())
            } else {
                1.0
            };

            for c in 0..3 {
                let blur = acc[c] / 9.0;
                let v = orig.0[c] as f32
                    + amt * 1.2 * edge_w * (orig.0[c] as f32 - blur)
                    + tex_term(c);
                px.0[c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    });
    out
}

/// Post-crop effects: vignette + grain. Runs as a separate coordinate-aware
/// pass after `apply_edits` (the per-pixel pass has no x/y). The math is
/// matched with the end of the WebGL shader; grain uses the same hash formula
/// but is stochastic texture — preview/export match visually, not bit-exactly.
pub fn apply_effects(img: &mut RgbImage, p: &EditParams) {
    let amt = p.vignette_amount / 100.0;
    let mid = p.vignette_midpoint / 100.0;
    let grain = p.grain_amount / 100.0;
    if amt == 0.0 && grain == 0.0 {
        return;
    }

    let (w, h) = (img.width() as f32, img.height() as f32);
    img.enumerate_rows_mut().par_bridge().for_each(|(y, row)| {
        let v = (y as f32 + 0.5) / h;
        for (x, _, px) in row {
            let u = (x as f32 + 0.5) / w;

            // Vignette: elliptical falloff, corner distance normalized to 1.
            let dx = (u - 0.5) * 2.0;
            let dy = (v - 0.5) * 2.0;
            let d = (dx * dx + dy * dy).sqrt() / std::f32::consts::SQRT_2;
            let f = 1.0 + amt * smoothstep(mid, 1.0, d);

            // Grain: deterministic per-uv hash (same formula as the shader).
            let n = ((u * 12.9898 + v * 78.233).sin() * 43758.5453).fract().abs();
            let g = (n - 0.5) * grain * 0.15;

            for c in 0..3 {
                let val = px.0[c] as f32 / 255.0 * f + g;
                px.0[c] = (val * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    });
}

/// HSL / Color Mixer band centers in degrees: Red, Orange, Yellow, Green,
/// Aqua, Blue, Purple, Magenta. Pixels between two centers blend their
/// adjustments linearly (wrapping Magenta→Red).
/// MUST match HSL_CENTERS in src/features/develop/hsl.ts.
const HSL_CENTERS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];

/// Bake the 8-band mixer into a 360-entry hue LUT of
/// (hue shift in degrees, saturation multiplier, luminance multiplier).
/// Slider mapping: hue ±100 → ±30°, sat ±100 → ×0..2, lum ±100 → ×0.5..1.5.
pub fn hsl_lut(p: &EditParams) -> [(f32, f32, f32); 360] {
    let mut lut = [(0.0f32, 1.0f32, 1.0f32); 360];
    for (deg, entry) in lut.iter_mut().enumerate() {
        let h = deg as f32;
        // Find the surrounding pair of band centers (with wrap).
        let mut k = 7; // default: the Magenta→Red wrap segment
        for i in 0..7 {
            if h >= HSL_CENTERS[i] && h < HSL_CENTERS[i + 1] {
                k = i;
                break;
            }
        }
        let c0 = HSL_CENTERS[k];
        let c1 = if k == 7 { 360.0 } else { HSL_CENTERS[k + 1] };
        let i1 = (k + 1) % 8;
        let t = ((h - c0) / (c1 - c0)).clamp(0.0, 1.0);

        let hue = (1.0 - t) * p.hsl_hue[k] + t * p.hsl_hue[i1];
        let sat = (1.0 - t) * p.hsl_sat[k] + t * p.hsl_sat[i1];
        let lum = (1.0 - t) * p.hsl_lum[k] + t * p.hsl_lum[i1];

        *entry = (
            hue / 100.0 * 30.0,
            1.0 + sat / 100.0,
            1.0 + 0.5 * lum / 100.0,
        );
    }
    lut
}

#[inline]
fn rgb2hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let h = if d <= 0.0 {
        0.0
    } else if max == r {
        (((g - b) / d).rem_euclid(6.0)) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    let s = if max <= 0.0 { 0.0 } else { d / max };
    (h, s, max)
}

#[inline]
fn hsv2rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    let h6 = h.rem_euclid(1.0) * 6.0;
    let i = h6.floor() as i32 % 6;
    let f = h6 - h6.floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match i {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    }
}

/// Build the calibration matrix: each column is the RGB a pure camera primary
/// maps to after its hue rotation (±45°) and saturation scale, luma-normalized
/// so calibration shifts color, not brightness. Applied in LINEAR light before
/// white balance. MUST match calibrationMatrix in src/features/develop/calibration.ts.
pub fn calibration_matrix(p: &EditParams) -> Option<[[f32; 3]; 3]> {
    if p.calibration_is_identity() {
        return None;
    }
    let col = |base_hue: f32, hue: f32, sat: f32| -> [f32; 3] {
        let h = (base_hue + hue / 100.0 * 45.0).rem_euclid(360.0) / 360.0;
        let s = (1.0 + sat / 100.0).clamp(0.0, 1.0);
        let (r, g, b) = hsv2rgb(h, s, 1.0);
        let l = luma(r, g, b).max(1e-4);
        // Normalize so the primary keeps its original luminance contribution.
        let base = match base_hue as i32 {
            0 => luma(1.0, 0.0, 0.0),
            120 => luma(0.0, 1.0, 0.0),
            _ => luma(0.0, 0.0, 1.0),
        };
        let k = base / l;
        [r * k, g * k, b * k]
    };
    Some([
        col(0.0, p.cal_red_hue, p.cal_red_sat),
        col(120.0, p.cal_green_hue, p.cal_green_sat),
        col(240.0, p.cal_blue_hue, p.cal_blue_sat),
    ])
}

/// The parametric curve's control points: region sliders nudge anchors at
/// fixed positions (the classic Shadows/Darks/Lights/Highlights). ±100 → ±0.12.
/// MUST match parametricPoints in curve.ts.
fn parametric_points(p: &EditParams) -> Vec<(f32, f32)> {
    let off = |v: f32| v / 100.0 * 0.12;
    vec![
        (0.0, 0.0),
        (0.125, (0.125 + off(p.curve_shadows)).clamp(0.0, 1.0)),
        (0.375, (0.375 + off(p.curve_darks)).clamp(0.0, 1.0)),
        (0.625, (0.625 + off(p.curve_lights)).clamp(0.0, 1.0)),
        (0.875, (0.875 + off(p.curve_highlights)).clamp(0.0, 1.0)),
        (1.0, 1.0),
    ]
}

/// Compose profile + parametric + per-channel + master curves into three LUTs:
/// out_c = master(channel_c(parametric(profile(x)))). The profile base curve
/// sits at the very bottom — user curves shape the profiled rendering.
/// MUST match bakeCurveLuts in curve.ts.
pub fn channel_curve_luts(p: &EditParams) -> [[f32; 256]; 3] {
    let prof = profile_look(&p.profile).0.map(|pts| curve_lut(&pts));
    let para = curve_lut(&parametric_points(p));
    let master = curve_lut(&p.tone_curve);
    let chans = [
        curve_lut(&p.tone_curve_r),
        curve_lut(&p.tone_curve_g),
        curve_lut(&p.tone_curve_b),
    ];
    let mut out = [[0f32; 256]; 3];
    for c in 0..3 {
        for (i, slot) in out[c].iter_mut().enumerate() {
            let x = match &prof {
                Some(l) => l[i],
                None => i as f32 / 255.0,
            };
            *slot = lut_sample(&master, lut_sample(&chans[c], lut_sample(&para, x)));
        }
    }
    out
}

/// Sample the LUT with linear interpolation between bins.
#[inline]
fn lut_sample(lut: &[f32; 256], v: f32) -> f32 {
    let f = v.clamp(0.0, 1.0) * 255.0;
    let i = f.floor() as usize;
    let t = f - i as f32;
    if i >= 255 {
        lut[255]
    } else {
        lut[i] * (1.0 - t) + lut[i + 1] * t
    }
}

/// Largest uniform scale `s` such that an axis-aligned rect of the original
/// aspect (s·W × s·H) fits inside the W×H frame rotated by `theta` radians.
/// This is the auto-zoom that keeps straightening free of empty corners.
/// MUST match `straightenScale` in the WebGL renderer.
pub fn straighten_scale(w: f32, h: f32, theta: f32) -> f32 {
    let t = theta.abs();
    let (c, s) = (t.cos(), t.sin());
    (w / (w * c + h * s)).min(h / (w * s + h * c))
}

/// Apply the geometric edits (straighten rotation + auto-zoom + crop) with
/// bilinear sampling. Coordinates use the same y-up convention as the WebGL
/// shader so the preview and the export rotate in the same direction.
pub fn apply_geometry(img: &RgbImage, p: &EditParams) -> RgbImage {
    let ca_r = p.ca_red / 100.0 * 0.005;
    let ca_b = p.ca_blue / 100.0 * 0.005;
    let ca_on = ca_r != 0.0 || ca_b != 0.0;
    let kd = p.distortion / 100.0 * 0.15;
    let lens_on = p.lens_a != 0.0 || p.lens_b != 0.0 || p.lens_c != 0.0;
    if p.geometry_is_identity() && !ca_on && kd == 0.0 && !lens_on && p.spots.is_empty() {
        return img.clone();
    }

    let (w, h) = (img.width() as f32, img.height() as f32);
    let out_w = ((w * p.crop_w).round() as u32).max(1);
    let out_h = ((h * p.crop_h).round() as u32).max(1);

    let theta = p.angle.to_radians();
    let zoom = 1.0 / straighten_scale(w, h, theta);
    let (cos_t, sin_t) = (theta.cos(), theta.sin());

    let mut out = RgbImage::new(out_w, out_h);
    out.enumerate_rows_mut()
        .par_bridge()
        .for_each(|(oy, row)| {
            // Frame coords (top-down, normalized) -> source pixel coords.
            // The same mapping serves the base sample AND spot redirections.
            let kv = p.persp_v / 100.0 * 0.35;
            let kh = p.persp_h / 100.0 * 0.35;
            let map_frame = |mut fx: f32, mut fy: f32| -> (f32, f32) {
                if kv != 0.0 || kh != 0.0 {
                    let xc = fx - 0.5;
                    let yc = fy - 0.5;
                    let d = (1.0 - kv * yc - kh * xc).max(0.1);
                    fx = xc / d + 0.5;
                    fy = yc / d + 0.5;
                }
                let dx = (fx - 0.5) * w * zoom;
                let dy = (0.5 - fy) * h * zoom;
                let mut sx = dx * cos_t - dy * sin_t + w * 0.5;
                let mut sy = h * 0.5 - (dx * sin_t + dy * cos_t);
                if lens_on {
                    // Lens-profile correction (lensfun ptlens cubic):
                    // Rd = Ru·(a·Ru³ + b·Ru² + c·Ru + d), d = 1−a−b−c,
                    // r normalized to min(w,h)/2 (PT/hugin convention).
                    // MUST match geoMap in the shader.
                    let ddx = sx - w * 0.5;
                    let ddy = sy - h * 0.5;
                    let norm = 0.5 * w.min(h);
                    let r = (ddx * ddx + ddy * ddy).sqrt() / norm;
                    let d = 1.0 - p.lens_a - p.lens_b - p.lens_c;
                    let f = p.lens_a * r * r * r + p.lens_b * r * r + p.lens_c * r + d;
                    sx = w * 0.5 + ddx * f;
                    sy = h * 0.5 + ddy * f;
                }
                if kd != 0.0 {
                    // Manual distortion: radial r² remap about the lens axis
                    // in source space (r normalized by the half-diagonal).
                    // MUST match geoMap in the shader.
                    let ddx = sx - w * 0.5;
                    let ddy = sy - h * 0.5;
                    let r2 = (ddx * ddx + ddy * ddy) / (0.25 * (w * w + h * h));
                    let f = 1.0 + kd * r2;
                    return (w * 0.5 + ddx * f, h * 0.5 + ddy * f);
                }
                (sx, sy)
            };
            let sample_frame = |fx: f32, fy: f32| -> image::Rgb<u8> {
                let (sx, sy) = map_frame(fx, fy);
                bilinear(img, sx - 0.5, sy - 0.5)
            };
            // Cheap low-frequency probe around a frame position (heal blend).
            let blur_frame = |fx: f32, fy: f32| -> [f32; 3] {
                let e = 0.004;
                let mut acc = [0f32; 3];
                for (ox2, oy2) in [(e, 0.0), (-e, 0.0), (0.0, e), (0.0, -e)] {
                    let s = sample_frame(fx + ox2, fy + oy2);
                    for c in 0..3 {
                        acc[c] += s.0[c] as f32;
                    }
                }
                [acc[0] / 4.0, acc[1] / 4.0, acc[2] / 4.0]
            };

            for (ox, _, px) in row {
                // Output pixel -> normalized straightened-frame coords.
                let fx = p.crop_x + ((ox as f32 + 0.5) / out_w as f32) * p.crop_w;
                let fy = p.crop_y + ((oy as f32 + 0.5) / out_h as f32) * p.crop_h;
                let (sx, sy) = map_frame(fx, fy);

                if ca_on {
                    // Lateral CA: sample R/B at radially scaled source coords
                    // about the lens axis (image center). Matches the shader.
                    let scale_at = |k: f32| -> (f32, f32) {
                        (
                            w * 0.5 + (sx - w * 0.5) * (1.0 + k),
                            h * 0.5 + (sy - h * 0.5) * (1.0 + k),
                        )
                    };
                    let (rx, ry) = scale_at(ca_r);
                    let (bx, by) = scale_at(ca_b);
                    let g = bilinear(img, sx - 0.5, sy - 0.5);
                    let r = bilinear(img, rx - 0.5, ry - 0.5);
                    let b = bilinear(img, bx - 0.5, by - 0.5);
                    *px = image::Rgb([r.0[0], g.0[1], b.0[2]]);
                } else {
                    *px = bilinear(img, sx - 0.5, sy - 0.5);
                }

                // Heal/clone spots: redirect the sample inside each spot's
                // destination circle to its source offset (feathered). Heal
                // additionally transfers the destination's low frequency.
                for spot in p.spots.iter().take(8) {
                    let dd = ((fx - spot.x).powi(2) + (fy - spot.y).powi(2)).sqrt();
                    let r = spot.radius.max(0.003);
                    // Feather widens the blend band from the edge inward.
                    let edge0 = r * (1.0 - spot.feather.clamp(0.0, 0.95));
                    let wgt = 1.0 - smoothstep(edge0, r, dd);
                    if wgt <= 0.003 {
                        continue;
                    }
                    let off_x = spot.src_x - spot.x;
                    let off_y = spot.src_y - spot.y;
                    let clone = sample_frame(fx + off_x, fy + off_y);
                    let mut repl = [
                        clone.0[0] as f32,
                        clone.0[1] as f32,
                        clone.0[2] as f32,
                    ];
                    if spot.heal {
                        let db = blur_frame(fx, fy);
                        let sb = blur_frame(fx + off_x, fy + off_y);
                        for c in 0..3 {
                            repl[c] = (repl[c] + db[c] - sb[c]).clamp(0.0, 255.0);
                        }
                    }
                    for c in 0..3 {
                        px.0[c] = (px.0[c] as f32 * (1.0 - wgt) + repl[c] * wgt)
                            .round()
                            .clamp(0.0, 255.0) as u8;
                    }
                }
            }
        });
    out
}

#[inline]
fn bilinear(img: &RgbImage, x: f32, y: f32) -> image::Rgb<u8> {
    let (w, h) = (img.width() as i64, img.height() as i64);
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;

    let clamp = |xi: i64, yi: i64| -> &image::Rgb<u8> {
        let cx = xi.clamp(0, w - 1) as u32;
        let cy = yi.clamp(0, h - 1) as u32;
        img.get_pixel(cx, cy)
    };

    let (p00, p10, p01, p11) = (
        clamp(x0, y0),
        clamp(x0 + 1, y0),
        clamp(x0, y0 + 1),
        clamp(x0 + 1, y0 + 1),
    );

    let mut o = [0u8; 3];
    for c in 0..3 {
        let top = p00.0[c] as f32 * (1.0 - tx) + p10.0[c] as f32 * tx;
        let bot = p01.0[c] as f32 * (1.0 - tx) + p11.0[c] as f32 * tx;
        o[c] = (top * (1.0 - ty) + bot * ty).round().clamp(0.0, 255.0) as u8;
    }
    image::Rgb(o)
}

#[inline]
fn luma(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

#[inline]
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Process one pixel (channels in 0..1). Mirrors the GLSL `main()`.
#[inline]
fn process(
    r: f32,
    g: f32,
    b: f32,
    n: &Norm,
    lut: Option<&[[f32; 256]; 3]>,
    hsl: Option<&[(f32, f32, f32); 360]>,
    cal: Option<&[[f32; 3]; 3]>,
) -> (f32, f32, f32) {
    // --- Calibration (primaries remap, linear light, before everything) ---
    let (mut lr, mut lg, mut lb) = (r.powf(2.2), g.powf(2.2), b.powf(2.2));
    if let Some(m) = cal {
        let (ir, ig, ib) = (lr, lg, lb);
        lr = m[0][0] * ir + m[1][0] * ig + m[2][0] * ib;
        lg = m[0][1] * ir + m[1][1] * ig + m[2][1] * ib;
        lb = m[0][2] * ir + m[1][2] * ig + m[2][2] * ib;
    }

    // --- White balance + exposure in linear light ---
    let mut rl = lr * (1.0 + 0.22 * n.temp - 0.06 * n.tint);
    let mut gl = lg * (1.0 + 0.12 * n.tint);
    let mut bl = lb * (1.0 - 0.22 * n.temp - 0.06 * n.tint);
    let gain = 2f32.powf(n.exposure);
    rl *= gain;
    gl *= gain;
    bl *= gain;

    let inv = 1.0 / 2.2;
    let mut cr = rl.max(0.0).powf(inv);
    let mut cg = gl.max(0.0).powf(inv);
    let mut cb = bl.max(0.0).powf(inv);

    // --- Tone regions (display gamma) ---
    // Applied MULTIPLICATIVELY via a luma ratio: scaling all channels by
    // new_luma/old_luma preserves the channel ratios (≈hue+saturation), so
    // pulling Highlights down keeps a warm sky warm instead of washing it
    // grey (the additive version flattened color — classic-editor recovery is
    // hue-preserving). Matches the shader.
    let l = luma(cr, cg, cb);
    let shadow_mask = 1.0 - smoothstep(0.0, 0.5, l);
    let high_mask = smoothstep(0.5, 1.0, l);
    let d_shadow = n.shadows * 0.40 * shadow_mask;
    let d_high = n.highlights * 0.40 * high_mask;
    let d_black = n.blacks * 0.18 * (1.0 - smoothstep(0.0, 0.45, l));
    let d_white = n.whites * 0.18 * smoothstep(0.55, 1.0, l);
    let region = d_shadow + d_high + d_black + d_white;
    if region != 0.0 && l > 1e-4 {
        let g = ((l + region).max(0.0) / l).min(8.0);
        cr *= g;
        cg *= g;
        cb *= g;
    }

    // --- Contrast around mid grey ---
    cr = (cr - 0.5) * (1.0 + n.contrast) + 0.5;
    cg = (cg - 0.5) * (1.0 + n.contrast) + 0.5;
    cb = (cb - 0.5) * (1.0 + n.contrast) + 0.5;

    // --- Dehaze (veil removal approximation: subtract atmospheric white,
    //     restretch levels, mild saturation lift). Matches shader. ---
    if n.dehaze != 0.0 {
        let veil = n.dehaze * 0.12;
        let denom = (1.0 - veil).max(0.05);
        let k = 1.0 + 0.25 * n.dehaze; // slope steepening
        cr = ((cr - veil) / denom - 0.5) * k + 0.5;
        cg = ((cg - veil) / denom - 0.5) * k + 0.5;
        cb = ((cb - veil) / denom - 0.5) * k + 0.5;
        let dl = luma(cr, cg, cb);
        let sboost = 1.0 + 0.12 * n.dehaze;
        cr = dl + (cr - dl) * sboost;
        cg = dl + (cg - dl) * sboost;
        cb = dl + (cb - dl) * sboost;
    }

    // --- Point tone curves (after contrast, before color — matches shader).
    //     Per-channel curves are pre-composed with the master. ---
    if let Some(l) = lut {
        cr = lut_sample(&l[0], cr);
        cg = lut_sample(&l[1], cg);
        cb = lut_sample(&l[2], cb);
    }

    // --- B&W treatment: collapse to luma before the color stages (which then
    //     naturally no-op on grey). Split-toning via grading still applies. ---
    if n.bw {
        let g = luma(cr, cg, cb);
        cr = g;
        cg = g;
        cb = g;
    }

    // --- Saturation (user slider × profile base multiplier) ---
    let lg = luma(cr, cg, cb);
    let s_total = (1.0 + n.saturation) * n.sat_mul;
    cr = lg + (cr - lg) * s_total;
    cg = lg + (cg - lg) * s_total;
    cb = lg + (cb - lg) * s_total;

    // --- Vibrance (weighted toward low-saturation pixels) ---
    let sat = cr.max(cg).max(cb) - cr.min(cg).min(cb);
    let vib = 1.0 + n.vibrance * (1.0 - sat);
    cr = lg + (cr - lg) * vib;
    cg = lg + (cg - lg) * vib;
    cb = lg + (cb - lg) * vib;

    // --- HSL / Color Mixer (after vibrance, before clarity — matches shader).
    //     Weighted by pixel saturation so neutrals never pick up a cast. ---
    if let Some(map) = hsl {
        let (h, s, v) = rgb2hsv(cr.clamp(0.0, 1.0), cg.clamp(0.0, 1.0), cb.clamp(0.0, 1.0));
        let idx = ((h * 360.0) as usize).min(359);
        let (shift, satm, lumm) = map[idx];
        let w = smoothstep(0.0, 0.15, s);
        let nh = (h + shift * w / 360.0).rem_euclid(1.0);
        let ns = (s * (1.0 + (satm - 1.0) * w)).clamp(0.0, 1.0);
        let nv = (v * (1.0 + (lumm - 1.0) * w)).clamp(0.0, 1.0);
        let (rr, gg, bb) = hsv2rgb(nh, ns, nv);
        cr = rr;
        cg = gg;
        cb = bb;
    }

    // --- Color grading (3-way split tone, after mixer / before clarity).
    //     Zone weights from current luma; balance shifts the pivot. Tints are
    //     additive casts (strength 0.3), zone luminance additive (0.25) —
    //     constants matched with the shader. No-op when sats/lums are zero. ---
    if !n.grade_is_identity() {
        let l2 = luma(cr, cg, cb).clamp(0.0, 1.0);
        let pivot = (0.5 + 0.25 * n.grade_balance).clamp(0.05, 0.95);
        let wh = smoothstep(pivot, 1.0, l2);
        let ws = 1.0 - smoothstep(0.0, pivot, l2);
        let wm = (1.0 - ws - wh).max(0.0);

        let mut lum_add = 0.0;
        for (zone, w) in [(&n.grade_s, ws), (&n.grade_m, wm), (&n.grade_h, wh)] {
            let (tr, tg, tb) = hsv2rgb(zone.0, 1.0, 1.0);
            let k = w * zone.1 * 0.3;
            cr += k * (tr - 0.5);
            cg += k * (tg - 0.5);
            cb += k * (tb - 0.5);
            lum_add += w * zone.2 * 0.25;
        }
        cr += lum_add;
        cg += lum_add;
        cb += lum_add;
    }

    // --- Clarity: approximate midtone local-contrast ---
    let mid = 1.0 - (lg - 0.5).abs() * 2.0;
    let k = n.clarity * 0.30 * mid;
    cr += (cr - 0.5) * k;
    cg += (cg - 0.5) * k;
    cb += (cb - 0.5) * k;

    (cr.clamp(0.0, 1.0), cg.clamp(0.0, 1.0), cb.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    fn solid(v: u8) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([v, v, v])))
    }

    #[test]
    fn neutral_params_are_a_passthrough() {
        let img = solid(128);
        let out = apply_edits(&img, &EditParams::default());
        for p in out.pixels() {
            assert_eq!(p.0, [128, 128, 128]);
        }
    }

    #[test]
    fn geometry_identity_is_noop() {
        let img = solid(99).to_rgb8();
        let out = apply_geometry(&img, &EditParams::default());
        assert_eq!(out.dimensions(), img.dimensions());
        assert_eq!(out.get_pixel(0, 0), img.get_pixel(0, 0));
    }

    #[test]
    fn crop_halves_dimensions() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 80, Rgb([50, 50, 50]))).to_rgb8();
        let p = EditParams {
            crop_x: 0.25,
            crop_y: 0.25,
            crop_w: 0.5,
            crop_h: 0.5,
            ..Default::default()
        };
        let out = apply_geometry(&img, &p);
        assert_eq!(out.dimensions(), (50, 40));
    }

    #[test]
    fn straighten_scale_sane() {
        // No rotation -> no zoom.
        assert!((straighten_scale(100.0, 80.0, 0.0) - 1.0).abs() < 1e-6);
        // Any rotation -> strictly smaller than 1 (zooms in).
        let s = straighten_scale(100.0, 80.0, 5f32.to_radians());
        assert!(s < 1.0 && s > 0.8, "got {s}");
    }

    #[test]
    fn curve_identity_lut_is_linear() {
        let lut = curve_lut(&[(0.0, 0.0), (1.0, 1.0)]);
        for (i, v) in lut.iter().enumerate() {
            assert!((v - i as f32 / 255.0).abs() < 1e-4, "bin {i}: {v}");
        }
    }

    #[test]
    fn curve_midpoint_lifts_and_stays_monotonic() {
        let lut = curve_lut(&[(0.0, 0.0), (0.5, 0.75), (1.0, 1.0)]);
        // Midpoint hits its control value.
        assert!((lut[128] - 0.75).abs() < 0.01, "got {}", lut[128]);
        // Monotone cubic must not oscillate.
        for w in lut.windows(2) {
            assert!(w[1] >= w[0] - 1e-5);
        }
        // Endpoints anchored.
        assert!(lut[0] < 0.01 && lut[255] > 0.99);
    }

    #[test]
    fn lens_profile_cubic_remaps_borders_not_center() {
        // Vertical stripes; a barrel-correction cubic (negative b, like the
        // FE 24-70 @24mm) must displace samples near the border while the
        // center column stays put.
        let mut img = RgbImage::new(200, 100);
        for (x, _y, p) in img.enumerate_pixels_mut() {
            let v = if (x / 10) % 2 == 0 { 30 } else { 220 };
            *p = Rgb([v, v, v]);
        }
        let mut p = EditParams::default();
        p.lens_b = -0.09;
        let out = apply_geometry(&img, &p);
        assert_eq!(out.dimensions(), (200, 100));
        // Center pixel: r≈0 → factor≈d=1.09 — wait, d=1−a−b−c shifts even
        // the center scale. Check RELATIVE: border displacement differs from
        // center displacement (non-uniform remap = real distortion work).
        let center_same = out.get_pixel(100, 50).0[0] == img.get_pixel(100, 50).0[0];
        let mut border_diff = 0;
        for x in 0..30 {
            if out.get_pixel(x, 50).0[0] != img.get_pixel(x, 50).0[0] {
                border_diff += 1;
            }
        }
        assert!(
            border_diff > 5 || !center_same,
            "profile cubic should remap geometry (border diffs: {border_diff})"
        );
        // Identity coefficients = byte-identical passthrough.
        let out2 = apply_geometry(&img, &EditParams::default());
        assert_eq!(out2.get_pixel(5, 50).0, img.get_pixel(5, 50).0);
    }

    #[test]
    fn highlight_recovery_preserves_color_ratios() {
        // A warm bright pixel pulled down by Highlights must stay warm:
        // multiplicative luma scaling preserves channel ratios, where the old
        // additive version washed it toward grey.
        let img = image::DynamicImage::ImageRgb8(RgbImage::from_pixel(
            4,
            4,
            Rgb([230, 180, 120]),
        ));
        let mut p = EditParams::default();
        p.highlights = -100.0;
        let out = apply_edits(&img, &p);
        let [r, g, b] = out.get_pixel(2, 2).0;
        assert!(r < 230, "highlights should darken: {r}");
        let before = 230.0 / 120.0;
        let after = r as f32 / b.max(1) as f32;
        assert!(
            (after - before).abs() / before < 0.06,
            "warm ratio must survive recovery: before {before:.2}, after {after:.2} ({r},{g},{b})"
        );
    }

    #[test]
    fn raster_mask_weights_only_where_map_is_white() {
        // Weight map: left half white, right half black. A +2EV raster mask
        // must brighten the left and leave the right untouched.
        let mut map = image::GrayImage::new(64, 64);
        for (x, _y, p) in map.enumerate_pixels_mut() {
            p.0[0] = if x < 32 { 255 } else { 0 };
        }
        let mut img = RgbImage::from_pixel(64, 64, Rgb([60, 60, 60]));

        let mut p = EditParams::default();
        let mut m = crate::db::models::Mask::default();
        m.kind = "raster".into();
        m.raster_id = "test".into();
        m.exposure = 2.0;
        p.masks = vec![m];

        apply_masks_with(&mut img, &p, &[Some(map)]);
        assert!(
            img.get_pixel(8, 32).0[0] > 100,
            "left should brighten: {}",
            img.get_pixel(8, 32).0[0]
        );
        assert_eq!(img.get_pixel(56, 32).0[0], 60, "right must be untouched");
        // Missing raster degrades to a no-op, not a crash or full-frame hit.
        let mut img2 = RgbImage::from_pixel(8, 8, Rgb([60, 60, 60]));
        apply_masks_with(&mut img2, &p, &[None]);
        assert_eq!(img2.get_pixel(4, 4).0[0], 60);
    }

    #[test]
    fn unknown_profile_is_passthrough() {
        // "" / unknown names must render byte-identically to no profile —
        // existing catalogs keep their look.
        let img = image::DynamicImage::ImageRgb8(RgbImage::from_pixel(
            8,
            8,
            Rgb([180, 120, 60]),
        ));
        let mut p = EditParams::default();
        p.profile = "does-not-exist".into();
        let out = apply_edits(&img, &p);
        assert_eq!(out.get_pixel(4, 4).0, [180, 120, 60]);
    }

    #[test]
    fn vivid_profile_boosts_saturation_and_contrast() {
        let img = image::DynamicImage::ImageRgb8(RgbImage::from_pixel(
            8,
            8,
            Rgb([180, 120, 60]),
        ));
        let mut p = EditParams::default();
        p.profile = "vivid".into();
        let out = apply_edits(&img, &p);
        let [r, g, b] = out.get_pixel(4, 4).0;
        let spread = |px: [u8; 3]| px.iter().max().unwrap() - px.iter().min().unwrap();
        assert!(
            spread([r, g, b]) > spread([180, 120, 60]),
            "vivid should widen channel spread: got {r},{g},{b}"
        );
        // The S-curve darkens below-mid tones: the blue channel (60 ≈ 0.24,
        // sitting under the curve's 0.25→0.225 anchor) must drop.
        assert!(b < 60, "shadow channel should darken, got {b}");
    }

    #[test]
    fn bw_profile_collapses_to_grey() {
        let img = image::DynamicImage::ImageRgb8(RgbImage::from_pixel(
            8,
            8,
            Rgb([180, 120, 60]),
        ));
        let mut p = EditParams::default();
        p.profile = "bw".into();
        let out = apply_edits(&img, &p);
        let [r, g, b] = out.get_pixel(4, 4).0;
        assert!(r == g && g == b, "bw profile should be grey: {r},{g},{b}");
    }

    #[test]
    fn clone_spot_covers_blemish_from_source() {
        // Grey field with a black "blemish" square at center; clean source to
        // the right. Cloning should cover the blemish with grey.
        let mut img = RgbImage::from_pixel(100, 100, Rgb([120, 120, 120]));
        for y in 47..53 {
            for x in 47..53 {
                img.put_pixel(x, y, Rgb([0, 0, 0]));
            }
        }
        let mut p = EditParams::default();
        p.spots = vec![crate::db::models::Spot {
            x: 0.5,
            y: 0.5,
            src_x: 0.75,
            src_y: 0.5,
            radius: 0.12,
            heal: false,
            feather: 0.4,
        }];
        let out = apply_geometry(&img, &p);
        assert!(
            out.get_pixel(50, 50).0[0] > 100,
            "blemish should be covered: {}",
            out.get_pixel(50, 50).0[0]
        );
        // Far corner untouched.
        assert_eq!(out.get_pixel(5, 5).0, [120, 120, 120]);
    }

    #[test]
    fn heal_spot_adapts_to_local_brightness() {
        // Destination area is darker than the source region; healing should
        // land closer to the destination's brightness than raw cloning.
        let mut img = RgbImage::from_pixel(100, 100, Rgb([80, 80, 80]));
        for y in 0..100 {
            for x in 60..100 {
                img.put_pixel(x, y, Rgb([200, 200, 200]));
            }
        }
        let spot = crate::db::models::Spot {
            x: 0.25,
            y: 0.5,
            src_x: 0.8,
            src_y: 0.5,
            radius: 0.1,
            heal: false,
            feather: 0.4,
        };
        let mut p_clone = EditParams::default();
        p_clone.spots = vec![spot.clone()];
        let mut p_heal = EditParams::default();
        p_heal.spots = vec![crate::db::models::Spot { heal: true, ..spot }];

        let cloned = apply_geometry(&img, &p_clone).get_pixel(25, 50).0[0] as i32;
        let healed = apply_geometry(&img, &p_heal).get_pixel(25, 50).0[0] as i32;
        assert!(cloned > 150, "raw clone pastes bright pixels: {cloned}");
        assert!(
            (healed - 80).abs() < (cloned - 80).abs(),
            "heal should sit closer to the destination tone: heal={healed} clone={cloned}"
        );
    }

    #[test]
    fn keystone_remaps_asymmetrically_by_row() {
        // Vertical bar in the middle; vertical keystone should bend the
        // sampling differently at the top vs the bottom.
        let mut img = RgbImage::from_pixel(100, 100, Rgb([0, 0, 0]));
        for y in 0..100 {
            for x in 40..60 {
                img.put_pixel(x, y, Rgb([255, 255, 255]));
            }
        }
        let mut p = EditParams::default();
        p.persp_v = 80.0;
        let out = apply_geometry(&img, &p);

        // Find the bright bar width at the top and bottom rows: a projective
        // remap scales rows differently, so the widths must differ.
        let bar_width = |row: u32| -> u32 {
            (0..100).filter(|&x| out.get_pixel(x, row).0[0] > 100).count() as u32
        };
        let top = bar_width(5);
        let bottom = bar_width(94);
        assert_ne!(top, bottom, "keystone must scale rows asymmetrically: {top} vs {bottom}");
    }

    #[test]
    fn ca_correction_moves_red_channel_only() {
        // Horizontal red gradient; flat green/blue.
        let mut img = RgbImage::new(100, 50);
        for y in 0..50 {
            for x in 0..100 {
                img.put_pixel(x, y, Rgb([(x * 255 / 99) as u8, 128, 128]));
            }
        }
        let mut p = EditParams::default();
        p.ca_red = 100.0;
        let out = apply_geometry(&img, &p);
        assert_eq!(out.dimensions(), (100, 50));
        // Green/blue must be byte-identical everywhere.
        let mut red_changed = false;
        for y in 0..50 {
            for x in 0..100 {
                let a = img.get_pixel(x, y).0;
                let b = out.get_pixel(x, y).0;
                assert_eq!(a[1], b[1], "green must not move");
                assert_eq!(a[2], b[2], "blue must not move");
                if a[0] != b[0] {
                    red_changed = true;
                }
            }
        }
        assert!(red_changed, "red channel should resample radially");
    }

    #[test]
    fn calibration_blue_hue_shift_spares_pure_red() {
        let red = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([200, 0, 0])));
        let blue = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([0, 0, 200])));
        let mut p = EditParams::default();
        p.cal_blue_hue = -100.0; // blue primary toward teal/cyan

        let r_out = apply_edits(&red, &p).get_pixel(0, 0).0;
        assert_eq!(r_out, [200, 0, 0], "pure red has no blue component — must be exact");

        let b_out = apply_edits(&blue, &p).get_pixel(0, 0).0;
        assert!(b_out[1] > 40, "blue should gain green (teal shift): {b_out:?}");
    }

    #[test]
    fn parametric_shadows_lift_darks_spare_highlights() {
        let mut p = EditParams::default();
        p.curve_shadows = 100.0;
        let luts = channel_curve_luts(&p);
        assert!(luts[0][32] > 32.0 / 255.0 + 0.05, "shadows should lift: {}", luts[0][32]);
        assert!((luts[0][240] - 240.0 / 255.0).abs() < 0.02, "highlights stay: {}", luts[0][240]);
    }

    #[test]
    fn red_channel_curve_only_lifts_red() {
        let img = solid(120);
        let mut p = EditParams::default();
        p.tone_curve_r = vec![(0.0, 0.0), (0.5, 0.75), (1.0, 1.0)];
        let out = apply_edits(&img, &p).get_pixel(0, 0).0;
        assert!(out[0] > 150, "red should lift, got {}", out[0]);
        assert_eq!(out[1], 120, "green untouched");
        assert_eq!(out[2], 120, "blue untouched");
    }

    #[test]
    fn channel_curve_composes_with_master() {
        // Channel lifts red; master darkens everything. Output must be
        // master(channel(x)) — i.e. red ends between the two extremes.
        let mut p = EditParams::default();
        p.tone_curve_r = vec![(0.0, 0.0), (0.5, 0.75), (1.0, 1.0)];
        p.tone_curve = vec![(0.0, 0.0), (0.5, 0.3), (1.0, 1.0)];
        let luts = channel_curve_luts(&p);
        let red_mid = luts[0][128];
        let green_mid = luts[1][128];
        assert!(red_mid > green_mid, "red lifted relative to green");
        assert!(green_mid < 0.4, "master darkening applies to green: {green_mid}");
    }

    #[test]
    fn tone_curve_brightens_in_apply_edits() {
        let img = solid(128);
        let mut p = EditParams::default();
        p.tone_curve = vec![(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)];
        let out = apply_edits(&img, &p);
        let v = out.get_pixel(0, 0).0[0];
        assert!(v > 160, "expected lift above 160, got {v}");
    }

    #[test]
    fn hsl_red_desaturation_greys_red_leaves_blue() {
        let red = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([200, 30, 30])));
        let blue = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([30, 30, 200])));

        let mut p = EditParams::default();
        p.hsl_sat[0] = -100.0; // Red band fully desaturated

        let red_out = apply_edits(&red, &p).get_pixel(0, 0).0;
        let spread = red_out[0].max(red_out[1]).max(red_out[2]) as i32
            - red_out[0].min(red_out[1]).min(red_out[2]) as i32;
        assert!(spread < 12, "red should be near-grey, got {red_out:?}");

        let blue_out = apply_edits(&blue, &p).get_pixel(0, 0).0;
        for (a, b) in blue_out.iter().zip([30u8, 30, 200]) {
            assert!((*a as i32 - b as i32).abs() < 4, "blue shifted: {blue_out:?}");
        }
    }

    #[test]
    fn hsl_hue_shift_moves_red_toward_orange() {
        let red = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([220, 20, 20])));
        let mut p = EditParams::default();
        p.hsl_hue[0] = 100.0; // Red hue pushed +30° (toward orange/yellow)
        let out = apply_edits(&red, &p).get_pixel(0, 0).0;
        // Green channel must rise substantially (orange = red + green).
        assert!(out[1] > 80, "expected orange shift, got {out:?}");
        assert!(out[0] > 180, "red channel should stay dominant: {out:?}");
    }

    #[test]
    fn grading_tints_highlights_not_shadows() {
        let bright = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([230, 230, 230])));
        let dark = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([25, 25, 25])));

        let mut p = EditParams::default();
        p.grade_high_hue = 30.0; // warm orange into highlights
        p.grade_high_sat = 100.0;

        let b = apply_edits(&bright, &p).get_pixel(0, 0).0;
        assert!(
            b[0] as i32 - b[2] as i32 > 10,
            "highlights should warm up (R>B): {b:?}"
        );

        let d = apply_edits(&dark, &p).get_pixel(0, 0).0;
        let drift = (d[0] as i32 - 25).abs() + (d[2] as i32 - 25).abs();
        assert!(drift <= 4, "shadows should stay neutral: {d:?}");
    }

    #[test]
    fn bw_treatment_produces_grey() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([180, 90, 40])));
        let mut p = EditParams::default();
        p.black_white = true;
        let out = apply_edits(&img, &p).get_pixel(0, 0).0;
        assert!(out[0] == out[1] && out[1] == out[2], "not grey: {out:?}");
    }

    #[test]
    fn vignette_darkens_corners_not_center() {
        let mut img = RgbImage::from_pixel(64, 64, Rgb([200, 200, 200]));
        let mut p = EditParams::default();
        p.vignette_amount = -100.0;
        apply_effects(&mut img, &p);
        let corner = img.get_pixel(0, 0).0[0];
        let center = img.get_pixel(32, 32).0[0];
        assert!(corner < 150, "corner should darken, got {corner}");
        assert!(center > 190, "center should stay bright, got {center}");
    }

    #[test]
    fn dehaze_stretches_hazy_contrast() {
        // Hazy pair: low-contrast values floating above black.
        let dark = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([90, 90, 90])));
        let light = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, Rgb([170, 170, 170])));
        let mut p = EditParams::default();
        p.dehaze = 60.0;
        let d = apply_edits(&dark, &p).get_pixel(0, 0).0[0] as i32;
        let l = apply_edits(&light, &p).get_pixel(0, 0).0[0] as i32;
        assert!(l - d > 90, "contrast should stretch: {d} vs {l}");
        assert!(d < 90, "shadows should deepen, got {d}");
    }

    #[test]
    fn sharpen_masking_protects_flat_noise() {
        // Subtle dither in a flat field (below the edge threshold) + a hard edge.
        let mut img = RgbImage::from_pixel(32, 32, Rgb([100, 100, 100]));
        for y in 0..32 {
            for x in 0..16 {
                if (x + y) % 2 == 0 {
                    img.put_pixel(x, y, Rgb([104, 104, 104]));
                }
            }
            for x in 24..32 {
                img.put_pixel(x, y, Rgb([220, 220, 220]));
            }
        }
        let mut p = EditParams::default();
        p.sharpen_amount = 100.0;
        p.sharpen_masking = 100.0;
        let out = apply_detail(&img, &p);
        // Flat dither must NOT be amplified…
        let flat = out.get_pixel(4, 4).0[0] as i32 - out.get_pixel(5, 4).0[0] as i32;
        assert!(flat.abs() <= 5, "flat noise should stay quiet, got {flat}");
        // …while the hard edge still sharpens (overshoot present).
        assert!(
            out.get_pixel(23, 16).0[0] < 100,
            "edge should still overshoot: {}",
            out.get_pixel(23, 16).0[0]
        );
    }

    #[test]
    fn sharpening_increases_edge_contrast() {
        // Vertical edge: left half 100, right half 180.
        let mut img = RgbImage::from_pixel(16, 16, Rgb([100, 100, 100]));
        for y in 0..16 {
            for x in 8..16 {
                img.put_pixel(x, y, Rgb([180, 180, 180]));
            }
        }
        let mut p = EditParams::default();
        p.sharpen_amount = 100.0;
        let out = apply_detail(&img, &p);
        // Dark side of the edge gets darker, bright side brighter.
        assert!(out.get_pixel(7, 8).0[0] < 100, "dark edge should overshoot down");
        assert!(out.get_pixel(8, 8).0[0] > 180, "bright edge should overshoot up");
        // Flat regions stay flat.
        assert_eq!(out.get_pixel(2, 8).0[0], 100);
        assert_eq!(out.get_pixel(14, 8).0[0], 180);
    }

    #[test]
    fn noise_reduction_flattens_noise_preserves_edges() {
        // Noisy flat field with a hard edge down the middle.
        let mut img = RgbImage::new(32, 32);
        for y in 0..32 {
            for x in 0..32 {
                let base: i32 = if x < 16 { 60 } else { 200 };
                let n: i32 = if (x + y) % 2 == 0 { 12 } else { -12 };
                let v = (base + n).clamp(0, 255) as u8;
                img.put_pixel(x, y, Rgb([v, v, v]));
            }
        }
        let mut p = EditParams::default();
        p.noise_luminance = 100.0;
        let out = apply_noise_reduction(&img, &p);

        // Noise variance in a flat region must drop.
        let spread = |im: &RgbImage| {
            let a = im.get_pixel(4, 4).0[0] as i32;
            let b = im.get_pixel(5, 4).0[0] as i32;
            (a - b).abs()
        };
        assert!(spread(&out) < spread(&img), "noise should flatten");
        // The edge must survive (bilateral, not blur).
        let edge = out.get_pixel(16, 16).0[0] as i32 - out.get_pixel(15, 16).0[0] as i32;
        assert!(edge > 100, "edge should be preserved, got {edge}");
    }

    #[test]
    fn radial_mask_brightens_center_not_corner() {
        let img = RgbImage::from_pixel(64, 64, Rgb([100, 100, 100]));
        let mut p = EditParams::default();
        let mut m = crate::db::models::Mask::default(); // centered radial
        m.exposure = 1.5;
        p.masks = vec![m];

        let mut out = img.clone();
        apply_masks(&mut out, &p);
        assert!(
            out.get_pixel(32, 32).0[0] > 130,
            "center should brighten: {}",
            out.get_pixel(32, 32).0[0]
        );
        assert_eq!(out.get_pixel(1, 1).0[0], 100, "corner must be untouched");
    }

    #[test]
    fn luminance_range_mask_targets_bright_band_only() {
        // Left half dark, right half bright; full-frame radial mask with a
        // highlights-only luminance range. Only the bright half may change.
        let mut img = RgbImage::from_pixel(64, 64, Rgb([40, 40, 40]));
        for y in 0..64 {
            for x in 32..64 {
                img.put_pixel(x, y, Rgb([210, 210, 210]));
            }
        }
        let mut p = EditParams::default();
        let m = crate::db::models::Mask {
            x1: 2.0, // radii huge -> geometry covers the whole frame
            y1: 2.0,
            feather: 0.0,
            exposure: -1.0,
            range_type: "luminance".into(),
            range_lo: 0.6,
            range_hi: 1.0,
            ..Default::default()
        };
        p.masks = vec![m];

        let mut out = img.clone();
        apply_masks(&mut out, &p);
        assert_eq!(out.get_pixel(8, 32).0[0], 40, "dark side must be untouched");
        assert!(
            out.get_pixel(56, 32).0[0] < 180,
            "bright side should darken, got {}",
            out.get_pixel(56, 32).0[0]
        );
    }

    #[test]
    fn color_range_mask_matches_hue_only() {
        // Red and blue halves; mask targets red hue.
        let mut img = RgbImage::from_pixel(64, 64, Rgb([200, 40, 40]));
        for y in 0..64 {
            for x in 32..64 {
                img.put_pixel(x, y, Rgb([40, 40, 200]));
            }
        }
        let mut p = EditParams::default();
        let m = crate::db::models::Mask {
            x1: 2.0,
            y1: 2.0,
            feather: 0.0,
            saturation: -100.0,
            range_type: "color".into(),
            range_hue: 0.0, // red
            range_tol: 0.3,
            ..Default::default()
        };
        p.masks = vec![m];

        let mut out = img.clone();
        apply_masks(&mut out, &p);
        let red = out.get_pixel(8, 32).0;
        let blue = out.get_pixel(56, 32).0;
        let spread = |px: [u8; 3]| px.iter().max().unwrap() - px.iter().min().unwrap();
        assert!(spread(red) < 60, "red region should desaturate: {red:?}");
        assert!(spread(blue) > 120, "blue region must keep its color: {blue:?}");
    }

    #[test]
    fn brush_mask_brightens_along_stroke_only() {
        let img = RgbImage::from_pixel(100, 100, Rgb([100, 100, 100]));
        let mut p = EditParams::default();
        let m = crate::db::models::Mask {
            kind: "brush".into(),
            points: vec![(0.2, 0.5), (0.4, 0.5), (0.6, 0.5)],
            x1: 0.06, // stroke radius
            feather: 0.5,
            exposure: 1.5,
            ..Default::default()
        };
        p.masks = vec![m];
        let mut out = img.clone();
        apply_masks(&mut out, &p);
        assert!(
            out.get_pixel(40, 50).0[0] > 130,
            "on-stroke should brighten: {}",
            out.get_pixel(40, 50).0[0]
        );
        assert_eq!(out.get_pixel(40, 10).0[0], 100, "far from stroke untouched");
        assert_eq!(out.get_pixel(90, 50).0[0], 100, "beyond stroke end untouched");
    }

    #[test]
    fn linear_mask_fades_across_gradient() {
        let img = RgbImage::from_pixel(64, 64, Rgb([100, 100, 100]));
        let mut p = EditParams::default();
        let m = crate::db::models::Mask {
            kind: "linear".into(),
            x0: 0.0,
            y0: 0.0,
            x1: 0.0,
            y1: 1.0, // top fully affected, fading to none at the bottom
            exposure: 1.0,
            ..Default::default()
        };
        p.masks = vec![m];

        let mut out = img.clone();
        apply_masks(&mut out, &p);
        let top = out.get_pixel(32, 1).0[0];
        let bottom = out.get_pixel(32, 62).0[0];
        assert!(top > 125, "top should brighten, got {top}");
        assert_eq!(bottom, 100, "bottom must be untouched");
    }

    #[test]
    fn positive_exposure_brightens() {
        let img = solid(128);
        let mut p = EditParams::default();
        p.exposure = 1.0; // +1 EV doubles linear light
        let out = apply_edits(&img, &p);
        // mid-grey 128 -> ~176 after a one-stop push.
        let v = out.get_pixel(0, 0).0[0];
        assert!(v > 150 && v < 200, "expected ~176, got {v}");
    }
}
