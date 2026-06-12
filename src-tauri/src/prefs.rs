use crate::db::AppState;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Application preferences, persisted as JSON in the XDG config dir.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Automatically write .xmp sidecars (debounced) after every edit.
    pub auto_xmp: bool,
    /// Import subfolders by default.
    pub import_recursive: bool,
    /// Catalog directory override (None = default XDG data dir).
    /// Applied on next launch.
    pub catalog_dir: Option<String>,
    /// JPEG quality for exports.
    pub export_quality: u8,
    /// Preview building at import: "minimal" (thumbs only, lazy rest),
    /// "standard" (also bake 2048px proxies), "full" (also bake 1:1 previews).
    pub preview_build: String,
    /// Auto-Import: watch this folder and import new photos automatically.
    pub auto_import_dir: Option<String>,
    pub auto_import_enabled: bool,
    /// RAW decode quality: "embedded" (camera preview, fast — default) or
    /// "full" (true demosaic at native sensor resolution, slow). Affects 1:1
    /// previews and exports; thumbnails always use the fast path.
    pub raw_decode: String,
    /// Keep this many rolling catalog backups (made at launch; 0 = off).
    pub catalog_backups: u32,
    /// Named export option sets (opaque JSON from the Export dialog).
    pub export_presets: Vec<ExportPresetEntry>,
    /// The last export's full settings (for "Export with Previous").
    pub last_export: Option<String>,
    /// Per-lens correction defaults keyed by the EXIF lens string
    /// (opaque JSON: { distortion, caRed, caBlue }).
    pub lens_defaults: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportPresetEntry {
    pub name: String,
    pub options: String, // JSON
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            auto_xmp: true,
            import_recursive: true,
            catalog_dir: None,
            export_quality: 90,
            preview_build: "minimal".into(),
            auto_import_dir: None,
            auto_import_enabled: false,
            raw_decode: "embedded".into(),
            catalog_backups: 5,
            export_presets: Vec::new(),
            last_export: None,
            lens_defaults: std::collections::HashMap::new(),
        }
    }
}

pub fn prefs_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("org", "LumenRoom", "LumenRoom")
        .map(|d| d.config_dir().join("prefs.json"))
}

pub fn load_prefs() -> Prefs {
    prefs_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store_prefs(p: &Prefs) -> Result<()> {
    let path = prefs_path().ok_or_else(|| AppError::Msg("no config dir".into()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(p)?)?;
    Ok(())
}

#[tauri::command]
pub fn get_prefs(state: tauri::State<'_, AppState>) -> Result<Prefs> {
    Ok(state.prefs.lock().expect("prefs poisoned").clone())
}

#[tauri::command]
pub fn set_prefs(
    prefs: Prefs,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    store_prefs(&prefs)?;
    *state.prefs.lock().expect("prefs poisoned") = prefs;
    // The Auto-Import watcher follows the preferences live.
    crate::catalog::autoimport::restart(&app);
    Ok(())
}

/// Catalog stats for the preferences dialog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInfo {
    pub db_path: String,
    pub db_bytes: u64,
    pub cache_bytes: u64,
    pub image_count: i64,
}

#[tauri::command]
pub fn catalog_info(state: tauri::State<'_, AppState>) -> Result<CatalogInfo> {
    let conn = state.conn()?;
    let image_count: i64 = conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))?;
    let db_path: String = conn.query_row("PRAGMA database_list", [], |r| r.get(2))?;
    drop(conn);

    let db_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let cache_bytes = dir_size(&state.cache_dir);

    Ok(CatalogInfo {
        db_path,
        db_bytes,
        cache_bytes,
        image_count,
    })
}

/// VACUUM + ANALYZE — the classic "Optimize Catalog".
#[tauri::command]
pub fn optimize_catalog(state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    conn.execute_batch("VACUUM; ANALYZE;")?;
    Ok(())
}

/// Delete all cached thumbnails/previews; they regenerate lazily. Returns
/// bytes freed.
#[tauri::command]
pub fn clear_thumbnail_cache(state: tauri::State<'_, AppState>) -> Result<u64> {
    let before = dir_size(&state.cache_dir);
    if let Ok(entries) = std::fs::read_dir(&state.cache_dir) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(before.saturating_sub(dir_size(&state.cache_dir)))
}

/// Rolling catalog backup, run at launch BEFORE the pool opens (the file is
/// guaranteed closed). Keeps the newest `keep` copies in `<data>/backups/`.
pub fn backup_catalog(db_path: &std::path::Path, keep: u32) {
    if keep == 0 || !db_path.exists() {
        return;
    }
    let Some(dir) = db_path.parent() else { return };
    let backups = dir.join("backups");
    if std::fs::create_dir_all(&backups).is_err() {
        return;
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let _ = std::fs::copy(db_path, backups.join(format!("catalog-{stamp}.sqlite")));

    // Prune the oldest beyond `keep` (names sort chronologically).
    if let Ok(entries) = std::fs::read_dir(&backups) {
        let mut names: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("catalog-"))
                    .unwrap_or(false)
            })
            .collect();
        names.sort();
        while names.len() > keep as usize {
            let oldest = names.remove(0);
            let _ = std::fs::remove_file(oldest);
        }
    }
}

fn dir_size(dir: &std::path::Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}
