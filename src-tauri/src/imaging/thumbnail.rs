use crate::error::Result;
use crate::imaging::{apply_orientation, is_raw, raw};
use image::{imageops::FilterType, DynamicImage, GenericImageView};
use std::path::Path;

/// Long edge of a Library grid thumbnail, in pixels.
pub const THUMB_LONG_EDGE: u32 = 512;
/// Long edge of the Develop preview proxy. Big enough to edit against, small
/// enough to stay a responsive GPU texture and cheap read-back.
pub const PREVIEW_LONG_EDGE: u32 = 2048;

/// Decode an image, orient it upright, downscale to `long_edge`, and return
/// JPEG bytes ready to cache.
///
/// Strategy:
///   * Standard formats -> full decode (already cheap), then downscale.
///   * RAW formats      -> extract the camera's embedded full-size JPEG preview
///     (milliseconds, no demosaic), then downscale.
pub fn bake(path: &Path, orientation: u16, long_edge: u32, quality: u8) -> Result<Vec<u8>> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let img = if is_raw(&ext) {
        raw::decode_embedded_preview(path)?
    } else {
        image::open(path)?
    };

    let upright = apply_orientation(img, orientation);
    let scaled = downscale_long_edge(&upright, long_edge);
    encode_jpeg(&scaled, quality)
}

/// Bake a Library grid thumbnail (512px long edge).
pub fn make_thumbnail(path: &Path, orientation: u16) -> Result<Vec<u8>> {
    bake(path, orientation, THUMB_LONG_EDGE, 82)
}

/// Resize so the longest edge equals `long_edge`, preserving aspect ratio.
/// `image::thumbnail` uses a fast box/triangle filter; we swap to Lanczos when
/// quality matters. (A SIMD resizer like `fast_image_resize` is the planned
/// optimisation once the pipeline is profiled.)
fn downscale_long_edge(img: &DynamicImage, long_edge: u32) -> DynamicImage {
    let (w, h) = img.dimensions();
    if w.max(h) <= long_edge {
        return img.clone();
    }
    let scale = long_edge as f32 / w.max(h) as f32;
    let nw = (w as f32 * scale).round().max(1.0) as u32;
    let nh = (h as f32 * scale).round().max(1.0) as u32;
    img.resize(nw, nh, FilterType::Triangle)
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    encoder.encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)?;
    Ok(out)
}
