use exif::{Exif, In, Tag, Value};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Subset of EXIF we denormalise into the catalog for fast grid filtering.
#[derive(Debug, Default, Clone)]
pub struct ExifData {
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<u32>,
    pub aperture: Option<f32>,
    pub shutter: Option<String>,
    pub focal_length: Option<f32>,
    pub captured_at: Option<i64>,
    pub orientation: u16,
}

/// Best-effort EXIF extraction. Returns `None` only when there is no EXIF
/// block at all; individual missing fields degrade gracefully to `None`.
pub fn extract(path: &Path) -> Option<ExifData> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut reader)
        .ok()?;

    Some(ExifData {
        camera_model: string_field(&exif, Tag::Model),
        lens: string_field(&exif, Tag::LensModel),
        iso: string_field(&exif, Tag::PhotographicSensitivity).and_then(|s| s.parse().ok()),
        aperture: rational_field(&exif, Tag::FNumber),
        shutter: string_field(&exif, Tag::ExposureTime),
        focal_length: rational_field(&exif, Tag::FocalLength),
        captured_at: string_field(&exif, Tag::DateTimeOriginal).and_then(|s| parse_exif_dt(&s)),
        orientation: exif
            .get_field(Tag::Orientation, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .map(|v| v as u16)
            .unwrap_or(1),
    })
}

fn string_field(exif: &Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let s = field.display_value().to_string();
    let trimmed = s.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Read the first rational of a field as f32 (e.g. FNumber 28/10 -> 2.8).
fn rational_field(exif: &Exif, tag: Tag) -> Option<f32> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(v) => v.first().map(|r| r.to_f64() as f32),
        Value::SRational(v) => v.first().map(|r| r.to_f64() as f32),
        _ => None,
    }
}

/// Parse an EXIF capture time into a unix timestamp.
///
/// The raw EXIF value is "YYYY:MM:DD HH:MM:SS", but kamadak-exif's
/// `display_value()` renders DateTime fields with dashes ("YYYY-MM-DD ..."),
/// so we accept both, plus the ISO `T` separator seen in XMP. Times are
/// zoneless; we treat them as UTC, which is fine for catalog sorting.
fn parse_exif_dt(s: &str) -> Option<i64> {
    let s = s.trim().trim_matches('"').trim_matches('\0').trim();
    const FORMATS: &[&str] = &[
        "%Y-%m-%d %H:%M:%S",
        "%Y:%m:%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
    ];
    FORMATS.iter().find_map(|fmt| {
        chrono::NaiveDateTime::parse_from_str(s, fmt)
            .ok()
            .map(|dt| dt.and_utc().timestamp())
    })
}
