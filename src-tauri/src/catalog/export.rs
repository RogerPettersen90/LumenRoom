use crate::db::models::EditParams;
use crate::db::{queries, AppState, DbPool};
use crate::error::{AppError, Result};
use crate::imaging::{apply_orientation, is_raw, pipeline, raw};
use image::ImageEncoder;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Compact v2 ICC profiles (CC0 — saucecontrol/Compact-ICC-Profiles).
/// Embedded in every JPEG (APP2) and PNG (iCCP) export so color-managed
/// viewers don't guess. The pipeline works in sRGB; AdobeRGB exports convert
/// at encode time. TIFF: the `image` crate's encoder has no ICC support.
const SRGB_ICC: &[u8] = include_bytes!("../../icc/sRGB-v2-micro.icc");
const ADOBE_ICC: &[u8] = include_bytes!("../../icc/AdobeCompat-v2.icc");

fn icc_for(color_space: &str) -> &'static [u8] {
    if color_space == "adobergb" { ADOBE_ICC } else { SRGB_ICC }
}

/// Convert sRGB pixels to AdobeRGB(1998)-compatible encoding: linearize sRGB,
/// apply the (shared-D65) linear sRGB→AdobeRGB matrix, re-encode with the
/// AdobeRGB ~2.2 gamma. Wider-gamut greens/cyans stop clipping in print work.
fn convert_to_adobergb(img: &mut image::RgbImage) {
    use rayon::prelude::*;
    const M: [[f32; 3]; 3] = [
        [0.71512, 0.28488, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.04116, 0.95884],
    ];
    const G: f32 = 1.0 / 2.19921875; // AdobeRGB encoding gamma (563/256)
    img.par_chunks_mut(3).for_each(|px| {
        let lin: Vec<f32> = px
            .iter()
            .map(|&v| {
                let s = v as f32 / 255.0;
                if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) }
            })
            .collect();
        for (i, row) in M.iter().enumerate() {
            let v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2];
            px[i] = (v.max(0.0).powf(G) * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    });
}

/// Export options for the full export dialog.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    pub format: String, // "jpeg" | "png" | "tiff" | "original" (file copy)
    /// Output color space: "srgb" (default) or "adobergb".
    pub color_space: String,
    pub quality: u8,
    /// Resize constraint: "long" | "short" edge in px, or "megapixels" (value
    /// = MP × 100, e.g. 1200 = 12.00 MP). Downscale only.
    pub resize_mode: String,
    pub resize_value: Option<u32>,
    /// JPEG only: search quality downward until the file fits (KB).
    pub max_file_kb: Option<u32>,
    /// Mild output sharpening after resize (the classic "screen / standard").
    pub output_sharpen: bool,
    pub watermark_text: Option<String>,
    pub watermark_anchor: String, // "br" | "bl" | "tr" | "tl" | "center"
}

impl Default for ExportOptions {
    fn default() -> Self {
        ExportOptions {
            format: "jpeg".into(),
            color_space: "srgb".into(),
            quality: 90,
            resize_mode: "long".into(),
            resize_value: None,
            max_file_kb: None,
            output_sharpen: false,
            watermark_text: None,
            watermark_anchor: "br".into(),
        }
    }
}

/// Render an image at full resolution with its saved edits and write it to
/// `dest`. The output format is inferred from the destination extension
/// (jpg/jpeg, png, tif/tiff). Returns the path written.
///
/// Non-destructive: the original is only read; edits come from the catalog.
#[tauri::command]
pub async fn export_image(
    image_id: String,
    dest: String,
    quality: Option<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let pool = state.db.clone();
    let masks_dir = state.cache_dir.join("masks");
    let raw_full = state.prefs.lock().expect("prefs poisoned").raw_decode == "full";

    let written = tauri::async_runtime::spawn_blocking(move || {
        render_to_file(
            &image_id,
            PathBuf::from(dest),
            quality.unwrap_or(90),
            raw_full,
            pool,
            &masks_dir,
        )
    })
    .await
    .map_err(|e| AppError::Msg(format!("export task panicked: {e}")))??;

    Ok(written)
}

/// Full-options export (the Export dialog's engine).
#[tauri::command]
pub async fn export_image_with(
    image_id: String,
    dest: String,
    options: ExportOptions,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let pool = state.db.clone();
    let masks_dir = state.cache_dir.join("masks");
    let raw_full = state.prefs.lock().expect("prefs poisoned").raw_decode == "full";
    let written = tauri::async_runtime::spawn_blocking(move || {
        render_with_options(&image_id, PathBuf::from(dest), &options, raw_full, pool, &masks_dir)
    })
    .await
    .map_err(|e| AppError::Msg(format!("export task panicked: {e}")))??;
    Ok(written)
}

pub(crate) fn render_with_options(
    image_id: &str,
    dest: PathBuf,
    opts: &ExportOptions,
    raw_full: bool,
    pool: DbPool,
    masks_dir: &Path,
) -> Result<String> {
    let conn = pool.get().map_err(AppError::Pool)?;
    let (src_path, orientation) = queries::get_export_source(&conn, image_id)?;
    let params = queries::get_edit_params(&conn, image_id)?;
    drop(conn);

    let src = PathBuf::from(&src_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    // "Original": a verbatim file copy (a DNG stays a DNG) — the classic Original
    // format. Edits don't bake in; the XMP sidecar carries them.
    if opts.format == "original" {
        let out = dest.with_extension(&ext);
        std::fs::copy(&src, &out)?;
        return Ok(out.display().to_string());
    }

    let decoded = if is_raw(&ext) {
        raw::decode_raw_best(&src, raw_full)?
    } else {
        image::open(&src)?
    };

    let upright = apply_orientation(decoded, orientation);
    let geo = pipeline::apply_geometry(&upright.to_rgb8(), &params);
    let mut edited = pipeline::apply_edits(&image::DynamicImage::ImageRgb8(geo), &params);
    let rasters = pipeline::load_mask_rasters(&params, masks_dir);
    pipeline::apply_masks_with(&mut edited, &params, &rasters);
    let denoised = pipeline::apply_noise_reduction(&edited, &params);
    let mut img = pipeline::apply_detail(&denoised, &params);
    pipeline::apply_effects(&mut img, &params);

    // Resize (downscale only — never upscale).
    if let Some(v) = opts.resize_value.filter(|v| *v > 0) {
        let (w, h) = img.dimensions();
        let scale = match opts.resize_mode.as_str() {
            "short" if w.min(h) > v => v as f32 / w.min(h) as f32,
            "megapixels" => {
                let target_px = v as f32 / 100.0 * 1_000_000.0;
                let cur = (w * h) as f32;
                if cur > target_px { (target_px / cur).sqrt() } else { 1.0 }
            }
            "long" if w.max(h) > v => v as f32 / w.max(h) as f32,
            _ => 1.0,
        };
        if scale < 1.0 {
            let dyn_img = image::DynamicImage::ImageRgb8(img);
            img = dyn_img
                .resize(
                    ((w as f32 * scale) as u32).max(1),
                    ((h as f32 * scale) as u32).max(1),
                    image::imageops::FilterType::Lanczos3,
                )
                .to_rgb8();
        }
    }

    // Output sharpening (after resize, the classic "Sharpen For: Screen").
    if opts.output_sharpen {
        let sharpen = EditParams {
            sharpen_amount: 35.0,
            ..Default::default()
        };
        img = pipeline::apply_detail(&img, &sharpen);
    }

    if let Some(text) = opts.watermark_text.as_deref().filter(|t| !t.trim().is_empty()) {
        draw_watermark(&mut img, text, &opts.watermark_anchor);
    }

    // Color space: pipeline output is sRGB; AdobeRGB converts at the end and
    // the matching ICC profile is embedded either way.
    let icc = icc_for(&opts.color_space);
    if opts.color_space == "adobergb" {
        convert_to_adobergb(&mut img);
    }

    match opts.format.as_str() {
        "png" => {
            let bytes = encode_png_with_profile(&img, icc)?;
            std::fs::write(&dest, bytes)?;
        }
        "tiff" => img.save_with_format(&dest, image::ImageFormat::Tiff)?,
        _ => {
            let bytes =
                encode_jpeg_capped_icc(&img, opts.quality.clamp(50, 100), opts.max_file_kb, icc)?;
            std::fs::write(&dest, bytes)?;
        }
    }
    Ok(dest.display().to_string())
}

/// Encode JPEG at the requested quality; when a size cap is set, search the
/// quality downward (to 40) until the file fits, keeping the best attempt.
fn encode_jpeg_capped(
    img: &image::RgbImage,
    quality: u8,
    max_kb: Option<u32>,
) -> Result<Vec<u8>> {
    encode_jpeg_capped_icc(img, quality, max_kb, SRGB_ICC)
}

fn encode_jpeg_capped_icc(
    img: &image::RgbImage,
    quality: u8,
    max_kb: Option<u32>,
    icc: &[u8],
) -> Result<Vec<u8>> {
    let encode = |q: u8| -> Result<Vec<u8>> {
        let mut out = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q);
        let _ = enc.set_icc_profile(icc.to_vec()); // profile tag; failure non-fatal
        enc.encode_image(img)?;
        Ok(out)
    };

    let Some(cap_kb) = max_kb.filter(|k| *k > 0) else {
        return encode(quality);
    };
    let cap = cap_kb as usize * 1024;

    let mut q = quality;
    let mut best = encode(q)?;
    while best.len() > cap && q > 40 {
        q = q.saturating_sub(10).max(40);
        best = encode(q)?;
    }
    Ok(best)
}

/// Rasterize a semi-transparent text watermark at the chosen anchor.
fn draw_watermark(img: &mut image::RgbImage, text: &str, anchor: &str) {
    use ab_glyph::{Font, FontRef, PxScale, ScaleFont};

    let font = match FontRef::try_from_slice(include_bytes!("../../fonts/DejaVuSans.ttf")) {
        Ok(f) => f,
        Err(_) => return,
    };
    let (w, h) = img.dimensions();
    // Scale with the image: ~2.5% of the long edge, min 14px.
    let px = (w.max(h) as f32 * 0.025).max(14.0);
    let scale = PxScale::from(px);
    let scaled = font.as_scaled(scale);

    // Measure.
    let mut text_w = 0.0f32;
    for c in text.chars() {
        text_w += scaled.h_advance(scaled.scaled_glyph(c).id);
    }
    let text_h = scaled.ascent() - scaled.descent();
    let margin = px * 0.8;

    let (ox, oy) = match anchor {
        "tl" => (margin, margin),
        "tr" => (w as f32 - text_w - margin, margin),
        "bl" => (margin, h as f32 - text_h - margin),
        "center" => ((w as f32 - text_w) / 2.0, (h as f32 - text_h) / 2.0),
        _ => (w as f32 - text_w - margin, h as f32 - text_h - margin), // br
    };

    let mut pen_x = ox;
    for c in text.chars() {
        let glyph_id = scaled.font().glyph_id(c);
        let advance = scaled.h_advance(glyph_id);
        let glyph = glyph_id.with_scale_and_position(scale, ab_glyph::point(pen_x, oy + scaled.ascent()));
        if let Some(outlined) = scaled.font().outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, cov| {
                let x = bounds.min.x as i64 + gx as i64;
                let y = bounds.min.y as i64 + gy as i64;
                if x >= 0 && y >= 0 && (x as u32) < w && (y as u32) < h {
                    let p = img.get_pixel_mut(x as u32, y as u32);
                    let a = cov * 0.75; // 75% white, blended
                    for ch in 0..3 {
                        p.0[ch] = (p.0[ch] as f32 * (1.0 - a) + 255.0 * a) as u8;
                    }
                }
            });
        }
        pen_x += advance;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jpeg_size_cap_reduces_quality_until_fit() {
        // Noisy image (hard to compress) so the cap actually bites.
        let mut img = image::RgbImage::new(400, 300);
        for (i, px) in img.pixels_mut().enumerate() {
            let n = ((i * 2654435761) % 255) as u8;
            *px = image::Rgb([n, n.wrapping_add(85), n.wrapping_add(170)]);
        }
        let unbounded = encode_jpeg_capped(&img, 95, None).unwrap();
        let capped = encode_jpeg_capped(&img, 95, Some(30)).unwrap();
        assert!(capped.len() < unbounded.len(), "cap should shrink the file");
        // Best-effort: at quality 40 floor the file may still exceed tiny caps,
        // but it must be dramatically smaller than the unbounded encode.
        assert!(capped.len() < unbounded.len() / 2);
    }

    /// Byte-substring search (memmem) for marker checks.
    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn adobergb_conversion_hits_the_classic_red_value() {
        // Pure sRGB red lands at ~219 in AdobeRGB (the textbook check).
        let mut img = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]));
        convert_to_adobergb(&mut img);
        let [r, g, b] = img.get_pixel(0, 0).0;
        assert!((r as i32 - 219).abs() <= 2, "expected ~219, got {r}");
        assert!(g < 5 && b < 5, "green/blue should stay ~0: {g},{b}");
        // Greys are invariant between the two spaces (shared white point).
        let mut grey = image::RgbImage::from_pixel(1, 1, image::Rgb([128, 128, 128]));
        convert_to_adobergb(&mut grey);
        let p = grey.get_pixel(0, 0).0;
        assert!((p[0] as i32 - 128).abs() <= 2 && p[0] == p[1] && p[1] == p[2], "{p:?}");
    }

    #[test]
    fn jpeg_export_embeds_srgb_icc_profile() {
        let img = image::RgbImage::from_pixel(32, 32, image::Rgb([120, 90, 60]));
        let bytes = encode_jpeg_capped(&img, 90, None).unwrap();
        // ICC payloads live in APP2 segments tagged "ICC_PROFILE\0".
        assert!(contains(&bytes, b"ICC_PROFILE\0"), "missing APP2 ICC marker");
        // The compact profile self-identifies; spot-check a chunk of it landed.
        assert!(contains(&bytes, &SRGB_ICC[16..32]), "profile bytes not embedded");
    }

    #[test]
    fn png_export_embeds_srgb_icc_profile() {
        let img = image::RgbImage::from_pixel(32, 32, image::Rgb([120, 90, 60]));
        let bytes = encode_png_with_profile(&img, SRGB_ICC).unwrap();
        assert!(contains(&bytes, b"iCCP"), "missing iCCP chunk");
    }

    #[test]
    fn watermark_marks_bottom_right_only() {
        let mut img = image::RgbImage::from_pixel(400, 300, image::Rgb([20, 20, 20]));
        draw_watermark(&mut img, "© LumenRoom", "br");

        // Some pixels in the bottom-right quadrant must have brightened…
        let mut touched = 0;
        for y in 220..300 {
            for x in 250..400 {
                if img.get_pixel(x, y).0[0] > 60 {
                    touched += 1;
                }
            }
        }
        assert!(touched > 50, "watermark should render, touched {touched}");
        // …while the top-left stays pristine.
        assert_eq!(img.get_pixel(10, 10).0[0], 20);
    }
}

fn render_to_file(
    image_id: &str,
    dest: PathBuf,
    quality: u8,
    raw_full: bool,
    pool: DbPool,
    masks_dir: &Path,
) -> Result<String> {
    let conn = pool.get().map_err(AppError::Pool)?;
    let (src_path, orientation) = queries::get_export_source(&conn, image_id)?;
    let params = queries::get_edit_params(&conn, image_id)?;
    drop(conn);

    let src = PathBuf::from(&src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let decoded = if is_raw(&ext) {
        raw::decode_raw_best(&src, raw_full)?
    } else {
        image::open(&src)?
    };

    let upright = apply_orientation(decoded, orientation);
    // Geometry first (straighten + crop reduce the pixel count), then the
    // per-pixel develop pass.
    let geo = pipeline::apply_geometry(&upright.to_rgb8(), &params);
    let mut edited = pipeline::apply_edits(&image::DynamicImage::ImageRgb8(geo), &params);
    let rasters = pipeline::load_mask_rasters(&params, masks_dir);
    pipeline::apply_masks_with(&mut edited, &params, &rasters);
    let denoised = pipeline::apply_noise_reduction(&edited, &params);
    let mut sharpened = pipeline::apply_detail(&denoised, &params);
    pipeline::apply_effects(&mut sharpened, &params);

    write_encoded(&sharpened, &dest, quality)?;
    Ok(dest.display().to_string())
}

/// Encode + write based on the destination extension.
fn write_encoded(img: &image::RgbImage, dest: &Path, quality: u8) -> Result<()> {
    let ext = dest
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => {
            let file = std::fs::File::create(dest)?;
            let mut w = std::io::BufWriter::new(file);
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, quality);
            let _ = enc.set_icc_profile(SRGB_ICC.to_vec());
            enc.encode_image(img)?;
        }
        "png" => {
            let bytes = encode_png_with_profile(img, SRGB_ICC)?;
            std::fs::write(dest, bytes)?;
        }
        // tiff (and any other supported format) infers from extension; no ICC.
        _ => img.save(dest)?,
    }
    Ok(())
}

/// PNG with the given profile in an iCCP chunk.
fn encode_png_with_profile(img: &image::RgbImage, icc: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut enc = image::codecs::png::PngEncoder::new(&mut out);
    let _ = enc.set_icc_profile(icc.to_vec());
    enc.write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgb8,
    )?;
    Ok(out)
}
