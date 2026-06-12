use crate::error::{AppError, Result};
use image::{DynamicImage, ImageReader};
use std::io::Cursor;
use std::path::Path;

/// Extract a RAW file's embedded full-size JPEG preview.
///
/// Rather than demosaicing the sensor data (slow, and overkill for a Library
/// thumbnail), we exploit the fact that essentially every camera writes a
/// ready-made JPEG preview into the RAW container:
///   * TIFF-based RAW (CR2, NEF, ARW, DNG, ORF, RW2, RAF) store it in an IFD.
///   * CR3 (ISO-BMFF) stores it in a `PRVW` box.
/// In every case it is a complete JPEG stream. We locate all embedded JPEGs and
/// return the one with the largest pixel area (skipping the small EXIF
/// thumbnail that previews are often nested alongside).
///
/// This is format-agnostic and needs no RAW-decoding dependency. The full
/// demosaic pipeline (`rawler`/`libraw`) is only needed later for actual RAW
/// development, not for catalog thumbnails.
pub fn decode_embedded_preview(path: &Path) -> Result<DynamicImage> {
    let bytes = std::fs::read(path)?;

    // A JPEG SOI is `FF D8`, immediately followed by another marker (`FF ..`).
    // Requiring the trailing `FF` rejects false positives in entropy-coded data
    // (where literal `FF` is always byte-stuffed as `FF 00`).
    let mut best: Option<(usize, u64)> = None; // (offset, pixel area)
    let mut i = 0;
    while i + 3 < bytes.len() {
        if bytes[i] == 0xFF && bytes[i + 1] == 0xD8 && bytes[i + 2] == 0xFF {
            // Cheaply read just the header to get dimensions; don't decode yet.
            if let Ok((w, h)) = dimensions_at(&bytes[i..]) {
                let area = w as u64 * h as u64;
                if best.map_or(true, |(_, b)| area > b) {
                    best = Some((i, area));
                }
            }
            i += 2;
        } else {
            i += 1;
        }
    }

    let (offset, _) = best.ok_or_else(|| {
        AppError::Msg("no embedded JPEG preview found in RAW file".into())
    })?;

    // Fully decode only the winning preview. The JPEG decoder stops at EOI and
    // ignores any trailing RAW payload.
    let img = ImageReader::new(Cursor::new(&bytes[offset..]))
        .with_guessed_format()?
        .decode()?;
    Ok(img)
}

/// Full RAW demosaic via rawler — the slow, full-quality path (lifts the
/// embedded-preview resolution ceiling to the sensor's native pixels).
/// Used for 1:1 previews and export when the "full" RAW decode pref is on.
///
/// Fuji X-Trans sensors take a dedicated path: rawler's demosaic is
/// Bayer-only (its xtrans module is an empty stub) and produces a heavy
/// green cast on the 6×6 pattern, so we demosaic those ourselves.
pub fn decode_full_raw(path: &Path) -> Result<DynamicImage> {
    let raw = rawler::decode_file(path)
        .map_err(|e| AppError::Msg(format!("raw decode: {e}")))?;

    if let rawler::rawimage::RawPhotometricInterpretation::Cfa(config) = &raw.photometric {
        if config.cfa.width > 2 {
            return decode_xtrans(&raw, config);
        }
    }

    let dev = rawler::imgop::develop::RawDevelop::default();
    let developed = dev
        .develop_intermediate(&raw)
        .map_err(|e| AppError::Msg(format!("raw develop: {e}")))?;
    // rawler links its own (older) `image` crate — bridge via raw RGB bytes.
    let theirs = developed
        .to_dynamic_image()
        .ok_or_else(|| AppError::Msg("raw develop produced no image".into()))?;
    let rgb = theirs.to_rgb8();
    let (w, h) = rgb.dimensions();
    let ours = image::RgbImage::from_raw(w, h, rgb.into_raw())
        .ok_or_else(|| AppError::Msg("raw develop buffer mismatch".into()))?;
    Ok(DynamicImage::ImageRgb8(apply_base_look(ours)))
}

/// X-Trans (and any non-Bayer RGB CFA) demosaic: channel-correct weighted
/// interpolation over the true CFA pattern, then the same color pipeline
/// rawler applies to Bayer files (WB → cam→sRGB matrix → clip → gamma),
/// rebuilt from rawler's public helpers.
fn decode_xtrans(
    raw: &rawler::RawImage,
    config: &rawler::rawimage::CFAConfig,
) -> Result<DynamicImage> {
    use rawler::imgop::develop::{Intermediate, ProcessingStep, RawDevelop};
    use rawler::imgop::matrix::{multiply, normalize, pseudo_inverse};
    use rawler::imgop::raw::clip_euclidean_norm_avg;
    use rawler::imgop::xyz::SRGB_TO_XYZ_D65;
    use rayon::prelude::*;

    // 1. Black/white-level corrected mono plane (full sensor grid).
    let dev = RawDevelop {
        steps: vec![ProcessingStep::Rescale],
    };
    let plane = match dev
        .develop_intermediate(raw)
        .map_err(|e| AppError::Msg(format!("xtrans rescale: {e}")))?
    {
        Intermediate::Monochrome(p) => p,
        _ => return Err(AppError::Msg("xtrans: expected mono plane".into())),
    };
    let (pw, ph) = (plane.width, plane.height);

    // Active sensor area (masked borders excluded); CFA indexing stays in
    // absolute sensor coordinates.
    let area = raw.active_area.unwrap_or(rawler::imgop::Rect {
        p: rawler::imgop::Point { x: 0, y: 0 },
        d: rawler::imgop::Dim2 { w: pw, h: ph },
    });
    let (ax, ay, aw, ah) = (area.p.x, area.p.y, area.d.w.min(pw - area.p.x), area.d.h.min(ph - area.p.y));

    // 2. Demosaic: each output channel = the CFA sample itself, or an
    // inverse-distance-weighted average of same-color neighbors within
    // radius 2 (a 5×5 window always covers all three colors in X-Trans).
    let cfa = &config.cfa;
    let data = &plane.data;
    let mut rgb = vec![[0f32; 3]; aw * ah];
    rgb.par_chunks_mut(aw).enumerate().for_each(|(ry, row)| {
        let y = ay + ry;
        for (rx, out) in row.iter_mut().enumerate() {
            let x = ax + rx;
            let center_c = cfa.color_at(y, x).min(2);
            let mut acc = [0f32; 3];
            let mut wsum = [0f32; 3];
            for dy in -2i32..=2 {
                let yy = y as i32 + dy;
                if yy < 0 || yy >= ph as i32 {
                    continue;
                }
                for dx in -2i32..=2 {
                    let xx = x as i32 + dx;
                    if xx < 0 || xx >= pw as i32 {
                        continue;
                    }
                    let c = cfa.color_at(yy as usize, xx as usize).min(2);
                    let w = 1.0 / (1.0 + (dx * dx + dy * dy) as f32);
                    acc[c] += w * data[yy as usize * pw + xx as usize];
                    wsum[c] += w;
                }
            }
            for c in 0..3 {
                out[c] = if c == center_c {
                    data[y * pw + x]
                } else if wsum[c] > 0.0 {
                    acc[c] / wsum[c]
                } else {
                    0.0
                };
            }
        }
    });

    // 3. Color: WB coefficients + cam→sRGB matrix (rawler's exact math).
    let wb = if raw.wb_coeffs[0].is_nan() {
        [1.0, 1.0, 1.0, 1.0]
    } else {
        raw.wb_coeffs
    };
    let cm = raw
        .color_matrix
        .iter()
        .find(|(ill, _)| format!("{ill:?}") == "D65")
        .map(|(_, m)| m.clone())
        .or_else(|| raw.color_matrix.values().next().cloned())
        .ok_or_else(|| AppError::Msg("xtrans: no color matrix".into()))?;
    let mut xyz2cam = [[0f32; 3]; 4];
    for i in 0..(cm.len() / 3).min(4) {
        for j in 0..3 {
            xyz2cam[i][j] = cm[i * 3 + j];
        }
    }
    let rgb2cam = normalize(multiply(&xyz2cam, &SRGB_TO_XYZ_D65));
    let cam2rgb = pseudo_inverse(rgb2cam);

    // 4. Default crop (the official frame), relative to the active area.
    let crop = raw.crop_area.unwrap_or(area);
    let cx = crop.p.x.saturating_sub(ax);
    let cy = crop.p.y.saturating_sub(ay);
    let cw = crop.d.w.min(aw - cx.min(aw));
    let ch = crop.d.h.min(ah - cy.min(ah));

    let mut img = image::RgbImage::new(cw as u32, ch as u32);
    img.enumerate_rows_mut().par_bridge().for_each(|(oy, row)| {
        for (ox, _, px) in row {
            let p = rgb[(cy + oy as usize) * aw + cx + ox as usize];
            let r = p[0] * wb[0];
            let g = p[1] * wb[1];
            let b = p[2] * wb[2];
            let srgb = clip_euclidean_norm_avg(&[
                cam2rgb[0][0] * r + cam2rgb[0][1] * g + cam2rgb[0][2] * b,
                cam2rgb[1][0] * r + cam2rgb[1][1] * g + cam2rgb[1][2] * b,
                cam2rgb[2][0] * r + cam2rgb[2][1] * g + cam2rgb[2][2] * b,
            ]);
            for c in 0..3 {
                let v = rawler::imgop::srgb::srgb_apply_gamma(srgb[c]);
                px.0[c] = (v * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    });

    Ok(DynamicImage::ImageRgb8(apply_base_look(img)))
}

/// rawler's develop is colorimetrically neutral — darker and much flatter
/// than the camera-rendered embedded JPEGs the rest of the app shows
/// (measured on the reference A7IV DNG: median 77 vs 123, luma SD 44 vs 59).
/// Bake a camera-style base rendering: ADAPTIVE exposure in linear light
/// (push the median toward the camera-typical midpoint, guarded so only the
/// top ~0.5% may clip), then an S-curve + saturation lift.
fn apply_base_look(mut img: image::RgbImage) -> image::RgbImage {
    use rayon::prelude::*;

    // Sample linear luma percentiles (every 101st pixel is plenty).
    let mut lumas: Vec<f32> = img
        .pixels()
        .step_by(101)
        .map(|p| {
            let lin = |v: u8| (v as f32 / 255.0).powf(2.2);
            0.2126 * lin(p.0[0]) + 0.7152 * lin(p.0[1]) + 0.0722 * lin(p.0[2])
        })
        .collect();
    if lumas.is_empty() {
        return img;
    }
    lumas.sort_by(|a, b| a.partial_cmp(b).expect("luma NaN"));
    let pct = |q: f32| lumas[((q * (lumas.len() - 1) as f32) as usize).min(lumas.len() - 1)];
    let (p05, p50, p995) = (pct(0.05), pct(0.5), pct(0.995));

    // Auto exposure as a POWER curve (lin^k), not a gain: it lifts the
    // median to the camera-typical midpoint while mapping 1.0→1.0, so
    // highlights can never clip and no guard is needed (a multiplicative
    // gain had to be capped on bright scenes and left X-Trans files dark).
    const TARGET_MID: f32 = 0.20;
    let _ = p995; // kept by the sampler; unused since the power curve can't clip
    let k = if p50 > 1e-5 && p50 < TARGET_MID {
        (TARGET_MID.ln() / p50.ln()).clamp(0.45, 1.0)
    } else {
        1.0
    };
    // Adaptive black point: the power lift flattens shadows, so re-anchor
    // them — subtract-stretch most of the (lifted) 5th percentile back out,
    // restoring camera-like shadow depth without crushing detail.
    let black = (p05.max(0.0).powf(k) * 0.75).clamp(0.0, 0.04);

    // Compose exposure + S-curve into one display-space LUT.
    let curve = crate::imaging::pipeline::curve_lut(&[
        (0.0, 0.0),
        (0.25, 0.22),
        (0.5, 0.53),
        (0.75, 0.81),
        (1.0, 1.0),
    ]);
    let mut lut = [0f32; 256];
    for (i, slot) in lut.iter_mut().enumerate() {
        let lifted = (i as f32 / 255.0).powf(2.2).powf(k);
        let lin = ((lifted - black) / (1.0 - black)).max(0.0);
        let disp = lin.min(1.0).powf(1.0 / 2.2);
        let f = disp * 255.0;
        let lo = (f.floor() as usize).min(255);
        let t = f - lo as f32;
        *slot = if lo >= 255 { curve[255] } else { curve[lo] * (1.0 - t) + curve[lo + 1] * t };
    }

    const SAT: f32 = 1.18;
    img.par_chunks_mut(3).for_each(|px| {
        let mut c = [0f32; 3];
        for i in 0..3 {
            let f = px[i] as f32;
            let lo = (f.floor() as usize).min(255);
            let t = f - lo as f32;
            c[i] = if lo >= 255 { lut[255] } else { lut[lo] * (1.0 - t) + lut[lo + 1] * t };
        }
        let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        for i in 0..3 {
            let v = l + (c[i] - l) * SAT;
            px[i] = (v * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    });
    img
}

/// Decode a RAW at the requested quality: full demosaic when asked (falling
/// back to the embedded preview on failure), embedded preview otherwise.
pub fn decode_raw_best(path: &Path, full: bool) -> Result<DynamicImage> {
    if full {
        decode_full_raw(path).or_else(|_| decode_embedded_preview(path))
    } else {
        decode_embedded_preview(path)
    }
}

/// Read image dimensions from a JPEG header without decoding pixel data.
fn dimensions_at(slice: &[u8]) -> Result<(u32, u32)> {
    let dims = ImageReader::new(Cursor::new(slice))
        .with_guessed_format()?
        .into_dimensions()?;
    Ok(dims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbImage};

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, image::Rgb([120, 90, 60])));
        let mut buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut buf)
            .encode_image(&img)
            .unwrap();
        buf
    }

    /// A RAW file is a container with a small EXIF thumbnail JPEG *and* a large
    /// preview JPEG. We must return the largest one, ignoring surrounding bytes.
    #[test]
    fn picks_largest_embedded_jpeg() {
        let small = jpeg(80, 60);
        let large = jpeg(320, 240);

        // padding | small jpeg | padding | large jpeg | padding
        let mut blob = vec![0u8; 64];
        blob.extend_from_slice(&small);
        blob.extend(std::iter::repeat(0u8).take(32));
        blob.extend_from_slice(&large);
        blob.extend(std::iter::repeat(0u8).take(16));

        let path = std::env::temp_dir().join("lumenroom_raw_test.bin");
        std::fs::write(&path, &blob).unwrap();

        let img = decode_embedded_preview(&path).unwrap();
        assert_eq!((img.width(), img.height()), (320, 240));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn errors_when_no_jpeg_present() {
        let path = std::env::temp_dir().join("lumenroom_raw_empty.bin");
        std::fs::write(&path, vec![0u8; 256]).unwrap();
        assert!(decode_embedded_preview(&path).is_err());
        std::fs::remove_file(&path).ok();
    }

    /// Exercises the full RAW path against a real file. Ignored by default; run
    /// explicitly with the path in $LUMEN_TEST_RAW:
    ///   LUMEN_TEST_RAW=/path/to.dng cargo test --lib real_raw -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_raw_file_end_to_end() {
        let Ok(path) = std::env::var("LUMEN_TEST_RAW") else {
            eprintln!("LUMEN_TEST_RAW not set — skipping");
            return;
        };
        let path = std::path::PathBuf::from(path);

        // 1. Embedded preview extraction.
        let preview = decode_embedded_preview(&path).expect("preview extraction failed");
        eprintln!("embedded preview: {}x{}", preview.width(), preview.height());
        assert!(preview.width() >= 1024, "preview unexpectedly small");

        // 2. EXIF metadata.
        let exif = crate::imaging::metadata::extract(&path);
        eprintln!("exif: {exif:?}");
        assert!(
            exif.as_ref().and_then(|e| e.captured_at).is_some(),
            "captured_at should parse from this file"
        );

        // 3. Thumbnail bake (uses the orientation from EXIF).
        let orientation = exif.as_ref().map(|e| e.orientation).unwrap_or(1);
        let thumb = crate::imaging::thumbnail::make_thumbnail(&path, orientation)
            .expect("thumbnail bake failed");
        let out = std::env::temp_dir().join("lumenroom_real_raw_thumb.jpg");
        std::fs::write(&out, &thumb).unwrap();
        eprintln!("wrote thumbnail ({} bytes) -> {}", thumb.len(), out.display());

        // 4. FULL DEMOSAIC: must decode at >= the embedded preview's
        //    resolution. (Equality is legitimate — e.g. the A7IV test shot is
        //    APS-C crop mode, where 4608x3072 IS native sensor output.)
        let full = decode_full_raw(&path).expect("full demosaic failed");
        eprintln!("full demosaic: {}x{}", full.width(), full.height());
        assert!(
            (full.width() as u64) * (full.height() as u64)
                >= (preview.width() as u64) * (preview.height() as u64),
            "demosaic must not under-resolve the embedded preview"
        );

        // 5. Full develop preview proxy (2048px).
        let proxy = crate::imaging::thumbnail::bake(
            &path,
            orientation,
            crate::imaging::thumbnail::PREVIEW_LONG_EDGE,
            88,
        )
        .expect("preview proxy bake failed");
        let pout = std::env::temp_dir().join("lumenroom_real_raw_preview.jpg");
        std::fs::write(&pout, &proxy).unwrap();
        eprintln!("wrote 2048px proxy ({} bytes) -> {}", proxy.len(), pout.display());
    }
}

#[cfg(test)]
mod flatness_probe {
    use super::*;

    fn stats(img: &image::RgbImage, label: &str) {
        let n = (img.width() * img.height()) as f64;
        let mut mean = [0f64; 3];
        let mut lumas: Vec<f32> = Vec::with_capacity(n as usize);
        for p in img.pixels() {
            for c in 0..3 {
                mean[c] += p.0[c] as f64;
            }
            lumas.push(0.2126 * p.0[0] as f32 + 0.7152 * p.0[1] as f32 + 0.0722 * p.0[2] as f32);
        }
        for m in &mut mean {
            *m /= n;
        }
        lumas.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let pct = |q: f64| lumas[(q * (lumas.len() - 1) as f64) as usize];
        let sd: f64 = (lumas.iter().map(|&l| {
            let d = l as f64 - (mean[0]*0.2126 + mean[1]*0.7152 + mean[2]*0.0722);
            d * d
        }).sum::<f64>() / n).sqrt();
        println!(
            "{label}: meanRGB=({:.0},{:.0},{:.0}) lumaSD={:.1} p5={:.0} p50={:.0} p95={:.0}",
            mean[0], mean[1], mean[2], sd, pct(0.05), pct(0.5), pct(0.95)
        );
    }

    #[test]
    #[ignore]
    fn compare_embedded_vs_demosaic() {
        let env_path = std::env::var("LUMEN_TEST_RAW")
            .unwrap_or_else(|_| "../sample_raw/sample.dng".into());
        let p = std::path::Path::new(&env_path);
        let emb = decode_embedded_preview(p).unwrap().to_rgb8();
        let emb = image::imageops::resize(&emb, 800, 533, image::imageops::FilterType::Triangle);
        stats(&emb, "embedded (camera look)");
        let full = decode_full_raw(p).unwrap().to_rgb8();
        let full = image::imageops::resize(&full, 800, 533, image::imageops::FilterType::Triangle);
        stats(&full, "demosaic + base look  ");
        emb.save("/tmp/cmp_embedded.jpg").unwrap();
        full.save("/tmp/cmp_demosaic.jpg").unwrap();
    }
}
