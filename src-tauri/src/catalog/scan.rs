use crate::db::{models::ImageMeta, queries, AppState, DbPool};
use crate::error::Result;
use crate::imaging::{is_raw, is_supported, metadata, thumbnail};
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;
use tauri::ipc::Channel;
use walkdir::WalkDir;

/// Progressive scan events streamed to the frontend so the grid fills in live
/// instead of freezing until the whole directory is processed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ScanEvent {
    Started { total: usize },
    Imported { image: ImageMeta },
    Failed { path: String, error: String },
    Progress { done: usize, total: usize },
    Finished { imported: usize, failed: usize },
}

/// Scan a directory for images: extract metadata, bake thumbnails into the
/// content-addressed cache, and upsert catalog rows — all in parallel across
/// every core. Returns the number of successfully imported images.
#[tauri::command]
pub async fn scan_directory(
    dir: String,
    recursive: bool,
    mode: String,          // "add" | "copy" | "move"
    dest: Option<String>,  // required for copy/move
    state: tauri::State<'_, AppState>,
    on_event: Channel<ScanEvent>,
) -> Result<usize> {
    // Extract the owned bits we need; `State` can't cross into the blocking pool.
    let pool = state.db.clone();
    let cache_dir = state.cache_dir.clone();
    let preview_build = state.prefs.lock().expect("prefs poisoned").preview_build.clone();

    // The heavy lifting is CPU-bound and synchronous (rayon). Push it off the
    // async executor so we never block Tauri's runtime threads.
    let imported = tauri::async_runtime::spawn_blocking(move || {
        run_scan(
            PathBuf::from(dir),
            recursive,
            mode,
            dest.map(PathBuf::from),
            pool,
            cache_dir,
            preview_build,
            on_event,
        )
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(format!("scan task panicked: {e}")))??;

    Ok(imported)
}

#[allow(clippy::too_many_arguments)]
fn run_scan(
    root: PathBuf,
    recursive: bool,
    mode: String,
    dest: Option<PathBuf>,
    pool: DbPool,
    cache_dir: PathBuf,
    preview_build: String,
    on_event: Channel<ScanEvent>,
) -> Result<usize> {
    // 1. Cheap single-threaded walk to discover candidate files.
    let max_depth = if recursive { usize::MAX } else { 1 };
    let mut files: Vec<PathBuf> = WalkDir::new(&root)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(is_supported)
                .unwrap_or(false)
        })
        .collect();

    // 1b. Copy / Move modes: transfer files into the destination (preserving
    //     the relative structure), then index the NEW locations. Sidecars
    //     travel with their photos. Failures skip the file (reported below).
    if (mode == "copy" || mode == "move") && dest.is_some() {
        let dest_root = dest.unwrap();
        let mut transferred = Vec::with_capacity(files.len());
        for src in files {
            let rel = src.strip_prefix(&root).unwrap_or(&src);
            let target = dest_root.join(rel);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let ok = if mode == "move" {
                // rename first (fast, same fs); fall back to copy + remove.
                std::fs::rename(&src, &target).is_ok()
                    || (std::fs::copy(&src, &target).is_ok()
                        && std::fs::remove_file(&src).is_ok())
            } else {
                std::fs::copy(&src, &target).is_ok()
            };
            if ok {
                // Bring the .xmp sidecar along if one sits next to the file.
                let side = src.with_extension("xmp");
                if side.exists() {
                    let tside = target.with_extension("xmp");
                    if mode == "move" {
                        let _ = std::fs::rename(&side, &tside)
                            .or_else(|_| std::fs::copy(&side, &tside).map(|_| ()));
                    } else {
                        let _ = std::fs::copy(&side, &tside);
                    }
                }
                transferred.push(target);
            } else {
                let _ = on_event.send(ScanEvent::Failed {
                    path: src.display().to_string(),
                    error: format!("{mode} failed"),
                });
            }
        }
        files = transferred;
    }

    let total = files.len();
    let _ = on_event.send(ScanEvent::Started { total });

    let done = AtomicUsize::new(0);
    let imported = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);

    // 2. Process in parallel. Each worker pulls its own pooled connection.
    files.par_iter().for_each(|path| {
        match process_one(path, &cache_dir, &preview_build, &pool) {
            Ok(meta) => {
                imported.fetch_add(1, Ordering::Relaxed);
                let _ = on_event.send(ScanEvent::Imported { image: meta });
            }
            Err(e) => {
                failed.fetch_add(1, Ordering::Relaxed);
                let _ = on_event.send(ScanEvent::Failed {
                    path: path.display().to_string(),
                    error: e.to_string(),
                });
            }
        }
        let d = done.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = on_event.send(ScanEvent::Progress { done: d, total });
    });

    let imported = imported.into_inner();
    let failed = failed.into_inner();
    let _ = on_event.send(ScanEvent::Finished { imported, failed });
    Ok(imported)
}

/// Decode metadata, bake the thumbnail, and persist one image.
pub(crate) fn process_one(
    path: &Path,
    cache_dir: &Path,
    preview_build: &str,
    pool: &DbPool,
) -> Result<ImageMeta> {
    let fs_meta = std::fs::metadata(path)?;
    let size = fs_meta.len();
    let mtime = fs_meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Stable, content-addressed id so the same file never re-imports twice.
    let id = blake3::hash(format!("{}:{}:{}", path.display(), mtime, size).as_bytes())
        .to_hex()
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Read EXIF first so the thumbnail can be baked in the correct orientation.
    let exif = metadata::extract(path).unwrap_or_default();

    // Bake thumbnail into cache as <cache>/<id>.jpg (served via lumen://thumb).
    // If a RAW file has no extractable embedded preview, import it with
    // metadata only (thumb_ready = false) rather than failing the whole scan.
    let thumb_ready = match thumbnail::make_thumbnail(path, exif.orientation) {
        Ok(bytes) => {
            std::fs::write(cache_dir.join(format!("{id}.jpg")), &bytes)?;
            true
        }
        Err(_) if is_raw(&ext) => false,
        Err(e) => return Err(e),
    };

    // Optional eager preview building (the classic Standard / 1:1 import options).
    // "minimal" leaves both tiers to lazy generation on first view.
    if thumb_ready && preview_build != "minimal" {
        if let Ok(bytes) =
            thumbnail::bake(path, exif.orientation, thumbnail::PREVIEW_LONG_EDGE, 88)
        {
            let _ = std::fs::write(cache_dir.join(format!("{id}_preview.jpg")), &bytes);
        }
        if preview_build == "full" {
            if let Ok(bytes) = thumbnail::bake(path, exif.orientation, u32::MAX, 90) {
                let _ = std::fs::write(cache_dir.join(format!("{id}_full.jpg")), &bytes);
            }
        }
    }

    let mut meta = ImageMeta {
        id,
        path: path.display().to_string(),
        filename: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        width: None,
        height: None,
        format: ext,
        camera_model: exif.camera_model,
        lens: exif.lens,
        iso: exif.iso,
        aperture: exif.aperture,
        shutter: exif.shutter,
        focal_length: exif.focal_length,
        captured_at: exif.captured_at,
        orientation: exif.orientation,
        rating: 0,
        flag: 0,
        color_label: None,
        copy_of: None,
        stack_id: None,
        stack_pos: 0,
        thumb_ready,
    };

    let conn = pool.get().map_err(crate::error::AppError::Pool)?;
    queries::upsert_image(&conn, &meta, size, mtime)?;

    // Re-scans upsert over existing rows; read the preserved culling state back
    // so the streamed event doesn't show zeroed ratings/flags for known images.
    if let Ok((rating, flag, label)) = queries::get_cull_state(&conn, &meta.id) {
        meta.rating = rating;
        meta.flag = flag;
        meta.color_label = label;
    }

    // Auto-import a .xmp sidecar sitting next to the original — but never
    // clobber edits that already live in the catalog.
    if !queries::has_edit_params(&conn, &meta.id).unwrap_or(true) {
        if let Some(params) = crate::catalog::sidecar::read_sidecar_for(path) {
            let _ = queries::save_edit_params(&conn, &meta.id, &params, "Imported from XMP");
        }
    }

    Ok(meta)
}
