pub mod autoimport;
pub mod export;
pub mod organize;
pub mod presets;
pub mod scan;
pub mod sidecar;

use crate::db::models::{EditParams, HistoryStep, ImageMeta};
use crate::db::{queries, AppState};
use crate::error::Result;

/// Return every catalogued image (newest captures first) for the Library grid.
#[tauri::command]
pub fn list_images(state: tauri::State<'_, AppState>) -> Result<Vec<ImageMeta>> {
    let conn = state.conn()?;
    queries::list_images(&conn)
}

/// Load saved develop settings for an image (neutral default if unedited).
#[tauri::command]
pub fn get_edit_params(image_id: String, state: tauri::State<'_, AppState>) -> Result<EditParams> {
    let conn = state.conn()?;
    queries::get_edit_params(&conn, &image_id)
}

/// Persist develop settings and append a history step. Non-destructive: the
/// original file is never touched. Also schedules the debounced automatic
/// XMP sidecar write, so edits sync to disk without manual saving.
#[tauri::command]
pub fn save_edit_params(
    image_id: String,
    params: EditParams,
    label: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::save_edit_params(&conn, &image_id, &params, &label)?;
    drop(conn);
    if state.prefs.lock().expect("prefs poisoned").auto_xmp {
        sidecar::schedule_sidecar_write(&state, &image_id);
    }
    Ok(())
}

/// Full history log for the Develop history panel.
#[tauri::command]
pub fn get_history(image_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<HistoryStep>> {
    let conn = state.conn()?;
    queries::get_history(&conn, &image_id)
}

/// Pre-bake develop proxies for the photos around the selection so stepping
/// through a shoot never shows a loading delay (fire-and-forget).
#[tauri::command]
pub fn prefetch_previews(image_ids: Vec<String>, state: tauri::State<'_, AppState>) -> Result<()> {
    let pool = state.db.clone();
    let cache = state.cache_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for id in image_ids {
            let file = cache.join(format!("{id}_preview.jpg"));
            if file.exists() {
                continue;
            }
            let Ok(conn) = pool.get() else { continue };
            let Ok((path, orientation)) = queries::get_export_source(&conn, &id) else {
                continue;
            };
            drop(conn);
            if let Ok(bytes) = crate::imaging::thumbnail::bake(
                std::path::Path::new(&path),
                orientation,
                crate::imaging::thumbnail::PREVIEW_LONG_EDGE,
                88,
            ) {
                let _ = std::fs::write(&file, bytes);
            }
        }
    });
    Ok(())
}

/// Create a virtual copy: independent develop state over the same file. The
/// copy shares the original's cached previews (we duplicate the small cache
/// files so the lumen:// routes resolve by the new id).
#[tauri::command]
pub fn create_virtual_copy(
    image_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let conn = state.conn()?;
    let new_id = queries::create_virtual_copy(&conn, &image_id)?;
    drop(conn);

    for suffix in ["", "_preview", "_full", "_fullraw"] {
        let src = state.cache_dir.join(format!("{image_id}{suffix}.jpg"));
        if src.exists() {
            let _ = std::fs::copy(&src, state.cache_dir.join(format!("{new_id}{suffix}.jpg")));
        }
    }
    Ok(new_id)
}

/// Remove a photo (or virtual copy) from the catalog. Files on disk are
/// never touched.
#[tauri::command]
pub fn remove_from_catalog(image_id: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::remove_from_catalog(&conn, &image_id)
}

/// Editable IPTC metadata (title/caption/copyright/creator).
#[tauri::command]
pub fn get_iptc(image_id: String, state: tauri::State<'_, AppState>) -> Result<queries::Iptc> {
    let conn = state.conn()?;
    queries::get_iptc(&conn, &image_id)
}

#[tauri::command]
pub fn set_iptc(
    image_id: String,
    iptc: queries::Iptc,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::set_iptc(&conn, &image_id, &iptc)?;
    drop(conn);
    // IPTC lives in the sidecar too — keep it in sync.
    if state.prefs.lock().expect("prefs poisoned").auto_xmp {
        sidecar::schedule_sidecar_write(&state, &image_id);
    }
    Ok(())
}

/// Set a star rating and/or pick/reject flag while culling.
#[tauri::command]
pub fn set_cull(
    image_id: String,
    rating: Option<i32>,
    flag: Option<i32>,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::set_cull(&conn, &image_id, rating, flag)?;
    drop(conn);
    // Ratings live in the sidecar too (xmp:Rating) — keep it in sync.
    if state.prefs.lock().expect("prefs poisoned").auto_xmp {
        sidecar::schedule_sidecar_write(&state, &image_id);
    }
    Ok(())
}

/// Reveal a file in the system file manager (Linux-first): try the
/// freedesktop FileManager1 D-Bus interface (selects the file), falling back
/// to opening the containing folder with xdg-open.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<()> {
    let uri = format!("file://{path}");
    let dbus_ok = std::process::Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.FileManager1",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
            &format!("array:string:{uri}"),
            "string:",
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !dbus_ok {
        let parent = std::path::Path::new(&path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("/"))
            .to_path_buf();
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(crate::error::AppError::Io)?;
    }
    Ok(())
}

/// Generate a luminosity-mask weight map (the raster mask kind's first
/// generator; AI segmentation plugs into the same slot later). Bakes a
/// grayscale PNG in frame space from the upright original's luma:
/// highlights / midtones / shadows bands. Returns the raster id.
#[tauri::command]
pub async fn generate_luminosity_mask(
    image_id: String,
    mode: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let pool = state.db.clone();
    let masks_dir = state.cache_dir.join("masks");

    tauri::async_runtime::spawn_blocking(move || -> Result<String> {
        let conn = pool.get().map_err(crate::error::AppError::Pool)?;
        let (path, orientation) = queries::get_export_source(&conn, &image_id)?;
        drop(conn);

        // 1024px proxy is plenty for a soft weight map (it's bilinear-sampled).
        let bytes =
            crate::imaging::thumbnail::bake(std::path::Path::new(&path), orientation, 1536, 90)?;
        let img = image::load_from_memory(&bytes)?.to_rgb8();

        let (w, h) = img.dimensions();
        let mut map = image::GrayImage::new(w, h);
        for (src, dst) in img.pixels().zip(map.pixels_mut()) {
            let l = (0.2126 * src.0[0] as f32 + 0.7152 * src.0[1] as f32
                + 0.0722 * src.0[2] as f32)
                / 255.0;
            let wgt = match mode.as_str() {
                "shadows" => 1.0 - smoothstep(0.1, 0.5, l),
                "midtones" => smoothstep(0.15, 0.4, l) * (1.0 - smoothstep(0.6, 0.85, l)),
                _ => smoothstep(0.5, 0.9, l), // highlights
            };
            dst.0[0] = (wgt * 255.0).round() as u8;
        }

        std::fs::create_dir_all(&masks_dir)?;
        let raster_id = format!(
            "{image_id}-lum-{}-{}",
            mode,
            chrono::Utc::now().timestamp_millis()
        );
        map.save(masks_dir.join(format!("{raster_id}.png")))?;
        Ok(raster_id)
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(format!("mask task panicked: {e}")))?
}

/// AI Select Subject (ROADMAP v3 Phase C): U²-Net-p saliency segmentation,
/// fully local (pure-Rust inference; the 4.6MB model downloads on first use).
/// Bakes the weight map into the raster-mask slot — same as luminosity masks,
/// only the generator differs. "Select Sky"-ish = add the mask and Invert.
#[tauri::command]
pub async fn generate_subject_mask(
    image_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let pool = state.db.clone();
    let cache_dir = state.cache_dir.clone();
    let masks_dir = state.cache_dir.join("masks");
    let models_dir = state.cache_dir.join("models");
    let raw_full = state.prefs.lock().expect("prefs poisoned").raw_decode == "full";

    tauri::async_runtime::spawn_blocking(move || -> Result<String> {
        let conn = pool.get().map_err(crate::error::AppError::Pool)?;
        let (path, orientation) = queries::get_export_source(&conn, &image_id)?;
        drop(conn);

        let model = crate::imaging::ai::ensure_model(&models_dir)?;

        // CRITICAL frame-space rule: derive the weight map from the SAME
        // pixels the renderer shows. The embedded JPEG and the full demosaic
        // can disagree by a few pixels of framing (DNG DefaultCropArea vs the
        // camera's JPEG crop) — enough to visibly shift an AI mask. Prefer
        // the cached 1:1 preview (exactly what's displayed at 1:1 and what
        // exports decode); fall back to the embedded bake, which then matches
        // the 2048px proxy instead.
        // Mode-suffixed 1:1 caches (matching the active pref) first.
        let candidates = if raw_full {
            [format!("{image_id}_fullraw.jpg"), format!("{image_id}_full.jpg")]
        } else {
            [format!("{image_id}_full.jpg"), format!("{image_id}_fullraw.jpg")]
        };
        let full_bytes = candidates
            .iter()
            .find_map(|name| std::fs::read(cache_dir.join(name)).ok());
        let img = match full_bytes.ok_or(()) {
            Ok(bytes) => image::load_from_memory(&bytes)?
                .resize(1536, 1536, image::imageops::FilterType::Triangle)
                .to_rgb8(),
            Err(_) => {
                let bytes = crate::imaging::thumbnail::bake(
                    std::path::Path::new(&path),
                    orientation,
                    1536,
                    90,
                )?;
                image::load_from_memory(&bytes)?.to_rgb8()
            }
        };
        let coarse = crate::imaging::ai::subject_mask(&img, &model)?;
        // Edge-aware refinement: snap the 320px model output onto real edges.
        let map = crate::imaging::ai::refine_mask(&coarse, &img);

        std::fs::create_dir_all(&masks_dir)?;
        let raster_id = format!(
            "{image_id}-subject-{}",
            chrono::Utc::now().timestamp_millis()
        );
        map.save(masks_dir.join(format!("{raster_id}.png")))?;
        Ok(raster_id)
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(format!("subject mask task panicked: {e}")))?
}

/// Persist a painted brush weight map (base64 PNG from the canvas painter)
/// into the masks cache; returns the raster id for a kind:"raster" mask.
/// One-shot small payload — the only pixels that ever cross the IPC bridge,
/// and only at "Apply".
#[tauri::command]
pub fn save_mask_raster(
    image_id: String,
    data: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    use base64::Engine;
    let b64 = data.split(',').next_back().unwrap_or(&data); // strip data: prefix
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| crate::error::AppError::Msg(format!("bad mask payload: {e}")))?;
    // Re-encode through a decode → guarantees a valid grayscale PNG on disk.
    let map = image::load_from_memory(&bytes)
        .map_err(|e| crate::error::AppError::Msg(format!("bad mask image: {e}")))?
        .to_luma8();

    let masks_dir = state.cache_dir.join("masks");
    std::fs::create_dir_all(&masks_dir)?;
    let raster_id = format!(
        "{image_id}-brush-{}",
        chrono::Utc::now().timestamp_millis()
    );
    map.save(masks_dir.join(format!("{raster_id}.png")))?;
    Ok(raster_id)
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Look up a lensfun correction profile for an EXIF lens string + focal
/// length. Pure lookup against the embedded database — applying the result
/// is the frontend's call (it writes lens_a/b/c + CA into EditParams).
#[tauri::command]
pub fn lookup_lens_profile(
    lens: String,
    focal: Option<f32>,
) -> Result<Option<crate::imaging::lensdb::LensProfile>> {
    Ok(crate::imaging::lensdb::lookup(&lens, focal))
}

/// Remove a folder (and everything under it) from the catalog. Files on disk
/// are never touched — this only forgets them, exactly like removing a
/// single photo. Cached previews for the removed photos are deleted.
#[tauri::command]
pub fn remove_folder_from_catalog(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize> {
    let conn = state.conn()?;
    let ids = queries::remove_folder_from_catalog(&conn, &path)?;
    drop(conn);
    for id in &ids {
        for suffix in ["", "_preview", "_full", "_fullraw"] {
            let _ = std::fs::remove_file(state.cache_dir.join(format!("{id}{suffix}.jpg")));
        }
    }
    Ok(ids.len())
}

/// Rename a folder on disk and rewrite all catalogued paths under it.
/// Guarded: the source must exist, the target must not, and the rename is a
/// same-parent rename (no traversal). Sidecars travel with the folder for free.
#[tauri::command]
pub fn rename_folder(
    path: String,
    new_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let old = std::path::PathBuf::from(&path);
    let name = new_name.trim();
    if name.is_empty() || name.contains('/') {
        return Err(crate::error::AppError::Msg("invalid folder name".into()));
    }
    let new = old
        .parent()
        .ok_or_else(|| crate::error::AppError::Msg("cannot rename root".into()))?
        .join(name);
    move_folder_impl(state.inner(), &old, &new)
}

/// Move a folder into a different parent directory (disk + catalog paths).
#[tauri::command]
pub fn move_folder(
    path: String,
    new_parent: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let old = std::path::PathBuf::from(&path);
    let parent = std::path::PathBuf::from(&new_parent);
    if parent.starts_with(&old) {
        return Err(crate::error::AppError::Msg(
            "cannot move a folder into itself".into(),
        ));
    }
    let name = old
        .file_name()
        .ok_or_else(|| crate::error::AppError::Msg("cannot move root".into()))?;
    move_folder_impl(state.inner(), &old, &parent.join(name))
}

fn move_folder_impl(
    state: &AppState,
    old: &std::path::Path,
    new: &std::path::Path,
) -> Result<String> {
    if !old.is_dir() {
        return Err(crate::error::AppError::Msg(format!(
            "not a folder: {}",
            old.display()
        )));
    }
    if new.exists() {
        return Err(crate::error::AppError::Msg(format!(
            "target already exists: {}",
            new.display()
        )));
    }

    // Disk first; only rewrite the catalog if the filesystem move succeeded.
    std::fs::rename(old, new).map_err(crate::error::AppError::Io)?;

    let old_prefix = format!("{}/", old.display());
    let new_prefix = format!("{}/", new.display());
    let conn = state.conn()?;
    conn.execute(
        // Prefix-safe rewrite: substr past the old prefix, not REPLACE (which
        // could rewrite same-named path fragments deeper in the tree).
        "UPDATE images SET path = ?1 || substr(path, length(?2) + 1)
         WHERE path LIKE ?2 || '%'",
        rusqlite::params![new_prefix, old_prefix],
    )?;
    Ok(new.display().to_string())
}

const LABELS: &[&str] = &["red", "yellow", "green", "blue", "purple"];

/// Set or clear a classic-style color label.
#[tauri::command]
pub fn set_label(
    image_id: String,
    label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    if let Some(l) = &label {
        if !LABELS.contains(&l.as_str()) {
            return Err(crate::error::AppError::Msg(format!("unknown label: {l}")));
        }
    }
    let conn = state.conn()?;
    queries::set_label(&conn, &image_id, label.as_deref())
}
