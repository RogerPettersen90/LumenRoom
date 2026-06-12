use crate::db::models::EditParams;
use crate::db::{queries, AppState};
use crate::error::{AppError, Result};
use std::path::PathBuf;

/// Write a non-destructive XMP sidecar next to the original, so other editors
/// (darktable, the classic editor, RawTherapee) can read the edits. We emit:
///   * `crs:` camera-raw-settings fields for interop — an approximate match,
///     since our adjustment curves are our own.
///   * `lumenroom:` private fields holding the exact params JSON, so LumenRoom
///     could re-import its own sidecar losslessly.
///
/// The sidecar is `<original-basename>.xmp` (the industry sidecar convention). The
/// original file itself is never modified.
#[tauri::command]
pub async fn export_sidecar(
    image_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    write_sidecar_now(&state.db, &image_id)
}

/// Write the sidecar immediately, from any thread that holds a pool handle.
pub fn write_sidecar_now(pool: &crate::db::DbPool, image_id: &str) -> Result<String> {
    let conn = pool.get().map_err(AppError::Pool)?;
    let (src_path, rating) = queries::get_sidecar_source(&conn, image_id)?;
    let params = queries::get_edit_params(&conn, image_id)?;
    let iptc = queries::get_iptc(&conn, image_id).unwrap_or_default();
    drop(conn);

    let xmp = build_xmp_full(&params, rating, &iptc);
    let dest = PathBuf::from(&src_path).with_extension("xmp");
    std::fs::write(&dest, xmp).map_err(AppError::Io)?;
    Ok(dest.display().to_string())
}

/// Debounced auto-sync: schedule a sidecar write ~1.5s after the *last* edit
/// to an image. Each call bumps that image's generation; the delayed worker
/// only writes if its generation is still current when it wakes, so rapid
/// slider commits coalesce into one disk write.
pub fn schedule_sidecar_write(state: &AppState, image_id: &str) {
    let my_gen = {
        let mut map = state.xmp_gen.lock().expect("xmp_gen poisoned");
        let g = map.entry(image_id.to_string()).or_insert(0);
        *g += 1;
        *g
    };

    let pool = state.db.clone();
    let gens = state.xmp_gen.clone();
    let id = image_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let current = gens.lock().ok().and_then(|m| m.get(&id).copied());
        if current == Some(my_gen) {
            if let Err(e) = write_sidecar_now(&pool, &id) {
                eprintln!("auto-xmp write failed for {id}: {e}");
            }
        }
    });
}

/// Build the XMP with IPTC (Dublin Core attribute shorthand — readable by
/// exiftool/darktable; arrays-as-attributes is accepted RDF shorthand).
fn build_xmp_full(p: &EditParams, rating: i32, iptc: &queries::Iptc) -> String {
    let mut xmp = build_xmp(p, rating);
    let mut dc = String::new();
    if let Some(v) = iptc.title.as_deref().filter(|s| !s.is_empty()) {
        dc.push_str(&format!("\n    dc:title=\"{}\"", xml_escape_attr(v)));
    }
    if let Some(v) = iptc.caption.as_deref().filter(|s| !s.is_empty()) {
        dc.push_str(&format!("\n    dc:description=\"{}\"", xml_escape_attr(v)));
    }
    if let Some(v) = iptc.copyright.as_deref().filter(|s| !s.is_empty()) {
        dc.push_str(&format!("\n    dc:rights=\"{}\"", xml_escape_attr(v)));
    }
    if let Some(v) = iptc.creator.as_deref().filter(|s| !s.is_empty()) {
        dc.push_str(&format!("\n    dc:creator=\"{}\"", xml_escape_attr(v)));
    }
    if !dc.is_empty() {
        xmp = xmp.replace(
            "xmlns:lumenroom=",
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n    xmlns:lumenroom=",
        );
        xmp = xmp.replace("\n    crs:Version=", &format!("{dc}\n    crs:Version="));
    }
    xmp
}

/// Build the XMP/RDF document for the given edit state.
fn build_xmp(p: &EditParams, rating: i32) -> String {
    // Our slider ranges line up closely with the common crs: ranges: most are -100..100, and
    // exposure is in EV stops. Temperature/Tint are *incremental* offsets (not
    // absolute Kelvin), so they map to crs:Incremental* fields.
    let exposure = format!("{:+.2}", p.exposure);
    let i = |v: f32| (v.round() as i64).to_string();

    let rating_attr = if rating > 0 {
        format!("\n    xmp:Rating=\"{rating}\"")
    } else {
        String::new()
    };

    // Exact, lossless params for round-tripping back into LumenRoom.
    let params_json = serde_json::to_string(p).unwrap_or_else(|_| "{}".into());

    let crop_attrs = if p.geometry_is_identity() {
        String::new()
    } else {
        format!(
            "\n    crs:HasCrop=\"True\"\n    crs:CropLeft=\"{:.5}\"\n    crs:CropTop=\"{:.5}\"\n    crs:CropRight=\"{:.5}\"\n    crs:CropBottom=\"{:.5}\"\n    crs:CropAngle=\"{:.4}\"",
            p.crop_x,
            p.crop_y,
            p.crop_x + p.crop_w,
            p.crop_y + p.crop_h,
            p.angle
        )
    };

    format!(
        r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="LumenRoom 0.1">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:lumenroom="http://lumenroom.org/ns/1.0/"
    xmp:CreatorTool="LumenRoom 0.1"{rating_attr}
    crs:Version="15.0"
    crs:ProcessVersion="11.0"
    crs:HasSettings="True"
    crs:WhiteBalance="Custom"
    crs:Exposure2012="{exposure}"
    crs:Contrast2012="{contrast}"
    crs:Highlights2012="{highlights}"
    crs:Shadows2012="{shadows}"
    crs:Whites2012="{whites}"
    crs:Blacks2012="{blacks}"
    crs:IncrementalTemperature="{temp}"
    crs:IncrementalTint="{tint}"
    crs:Saturation="{saturation}"
    crs:Vibrance="{vibrance}"
    crs:Clarity2012="{clarity}"{crop_attrs}
    lumenroom:Params="{params_esc}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#,
        rating_attr = rating_attr,
        exposure = exposure,
        contrast = i(p.contrast),
        highlights = i(p.highlights),
        shadows = i(p.shadows),
        whites = i(p.whites),
        blacks = i(p.blacks),
        temp = i(p.temperature),
        tint = i(p.tint),
        saturation = i(p.saturation),
        vibrance = i(p.vibrance),
        clarity = i(p.clarity),
        crop_attrs = crop_attrs,
        params_esc = xml_escape_attr(&params_json),
    )
}

/// Parse the lossless `lumenroom:Params` JSON back out of a sidecar we wrote.
/// Returns None when the attribute is absent or unparseable.
pub fn parse_xmp_params(xmp: &str) -> Option<EditParams> {
    let key = "lumenroom:Params=\"";
    let start = xmp.find(key)? + key.len();
    let end = xmp[start..].find('"')? + start;
    let json = xml_unescape_attr(&xmp[start..end]);
    serde_json::from_str(&json).ok()
}

/// Read and parse `<original-basename>.xmp` next to an original file.
pub fn read_sidecar_for(original: &std::path::Path) -> Option<EditParams> {
    let path = original.with_extension("xmp");
    let xmp = std::fs::read_to_string(path).ok()?;
    parse_xmp_params(&xmp)
}

/// Re-import saved edits from the sidecar into the catalog (manual trigger).
#[tauri::command]
pub fn import_sidecar(
    image_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<EditParams> {
    let conn = state.conn()?;
    let (src_path, _) = queries::get_export_source(&conn, &image_id)?;
    let params = read_sidecar_for(std::path::Path::new(&src_path))
        .ok_or_else(|| AppError::Msg("no readable .xmp sidecar next to the original".into()))?;
    queries::save_edit_params(&conn, &image_id, &params, "Imported from XMP")?;
    Ok(params)
}

fn xml_unescape_attr(s: &str) -> String {
    // &amp; last, so "&amp;quot;" doesn't double-decode.
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Escape a string for use inside an XML attribute value.
fn xml_escape_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xmp_roundtrip_restores_exact_params() {
        let mut p = EditParams::default();
        p.exposure = 0.85;
        p.contrast = -15.0;
        p.tone_curve = vec![(0.0, 0.05), (0.4, 0.55), (1.0, 1.0)];
        p.hsl_sat[2] = 40.0;
        p.grade_high_hue = 42.0;
        p.grade_high_sat = 25.0;
        p.crop_w = 0.8;
        p.angle = -2.5;
        p.black_white = true;
        p.vignette_amount = -30.0;

        let xmp = build_xmp(&p, 3);
        let back = parse_xmp_params(&xmp).expect("params should parse back");
        assert_eq!(back, p, "sidecar roundtrip must be lossless");
    }

    #[test]
    fn xmp_contains_mapped_fields_and_is_escaped() {
        let mut p = EditParams::default();
        p.exposure = 0.35;
        p.contrast = 20.0;
        p.highlights = -30.0;
        p.vibrance = 15.0;

        let xmp = build_xmp(&p, 5);
        std::fs::write(std::env::temp_dir().join("lumenroom_sample.xmp"), &xmp).ok();

        assert!(xmp.contains("crs:Exposure2012=\"+0.35\""));
        assert!(xmp.contains("crs:Contrast2012=\"20\""));
        assert!(xmp.contains("crs:Highlights2012=\"-30\""));
        assert!(xmp.contains("xmp:Rating=\"5\""));
        // The embedded JSON must be attribute-escaped (no raw quotes).
        assert!(xmp.contains("lumenroom:Params=\""));
        assert!(xmp.contains("&quot;exposure&quot;"));
        // No rating attribute when unrated.
        assert!(!build_xmp(&EditParams::default(), 0).contains("xmp:Rating"));
    }
}
