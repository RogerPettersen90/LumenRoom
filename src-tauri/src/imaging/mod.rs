pub mod ai;
pub mod lensdb;
pub mod metadata;
pub mod pipeline;
pub mod raw;
pub mod thumbnail;

use image::DynamicImage;

/// File extensions LumenRoom recognises as importable images.
pub const SUPPORTED_EXTS: &[&str] = &[
    // standard raster
    "jpg", "jpeg", "png", "tif", "tiff", "webp", //
    // RAW (decoded lazily; thumbnails fall back to full decode for now)
    "cr2", "cr3", "nef", "arw", "raf", "rw2", "dng", "orf",
];

/// RAW formats we don't yet demosaic. Kept separate so the Library can badge
/// them and the Develop module knows to lazily invoke the (future) RAW path.
pub const RAW_EXTS: &[&str] = &["cr2", "cr3", "nef", "arw", "raf", "rw2", "dng", "orf"];

pub fn is_supported(ext: &str) -> bool {
    SUPPORTED_EXTS.contains(&ext.to_lowercase().as_str())
}

pub fn is_raw(ext: &str) -> bool {
    RAW_EXTS.contains(&ext.to_lowercase().as_str())
}

/// Bake an EXIF orientation tag (1..8) into the pixels so downstream consumers
/// (thumbnails, export) get an upright image. `rotate90` is clockwise.
pub fn apply_orientation(img: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img, // 1 (or unknown) = already upright
    }
}
