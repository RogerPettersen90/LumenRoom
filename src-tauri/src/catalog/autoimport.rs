use crate::db::AppState;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Holds the live folder watcher (the classic Auto Import). Restarted whenever the
/// preferences change.
#[derive(Default)]
pub struct AutoImportState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    in_flight: std::sync::Arc<Mutex<HashSet<PathBuf>>>,
}

/// (Re)start the watcher according to current preferences.
pub fn restart(app: &AppHandle) {
    let state = app.state::<AppState>();
    let (enabled, dir) = {
        let p = state.prefs.lock().expect("prefs poisoned");
        (p.auto_import_enabled, p.auto_import_dir.clone())
    };

    let auto = app.state::<AutoImportState>();
    // Drop any existing watcher first.
    *auto.watcher.lock().expect("watcher poisoned") = None;

    let Some(dir) = dir.filter(|_| enabled) else {
        return;
    };
    let watch_path = PathBuf::from(&dir);
    if !watch_path.is_dir() {
        eprintln!("auto-import: not a directory: {dir}");
        return;
    }

    let handle = app.clone();
    let in_flight = auto.in_flight.clone();
    let result = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(
            event.kind,
            notify::EventKind::Create(_) | notify::EventKind::Modify(_)
        ) {
            return;
        }
        for path in event.paths {
            let supported = path
                .extension()
                .and_then(|e| e.to_str())
                .map(crate::imaging::is_supported)
                .unwrap_or(false);
            if !supported {
                continue;
            }
            // One import per file at a time (Create + Modify storms).
            {
                let mut set = in_flight.lock().expect("in_flight poisoned");
                if !set.insert(path.clone()) {
                    continue;
                }
            }
            let h = handle.clone();
            let set = in_flight.clone();
            std::thread::spawn(move || {
                import_when_stable(&h, &path);
                set.lock().expect("in_flight poisoned").remove(&path);
            });
        }
    });

    match result {
        Ok(mut w) => {
            if let Err(e) = w.watch(&watch_path, RecursiveMode::NonRecursive) {
                eprintln!("auto-import: watch failed: {e}");
                return;
            }
            *auto.watcher.lock().expect("watcher poisoned") = Some(w);
        }
        Err(e) => eprintln!("auto-import: watcher init failed: {e}"),
    }
}

/// Wait until the file stops growing (camera/copy still writing), then run it
/// through the normal import pipeline and notify the frontend.
fn import_when_stable(app: &AppHandle, path: &Path) {
    let mut last = 0u64;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(700));
        let Ok(meta) = std::fs::metadata(path) else { return };
        let size = meta.len();
        if size > 0 && size == last {
            break;
        }
        last = size;
    }

    let state = app.state::<AppState>();
    let pool = state.db.clone();
    let cache = state.cache_dir.clone();
    let preview_build = state.prefs.lock().expect("prefs poisoned").preview_build.clone();

    match crate::catalog::scan::process_one(path, &cache, &preview_build, &pool) {
        Ok(meta) => {
            let _ = app.emit("auto-import", &meta);
        }
        Err(e) => eprintln!("auto-import failed for {}: {e}", path.display()),
    }
}
