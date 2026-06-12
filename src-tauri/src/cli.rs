// Headless CLI (Linux-first uniqueness, ROADMAP v3 Phase E): run the real
// import + export engines scriptably, no window required. Shares the catalog,
// prefs, and render pipeline with the GUI — an edit made in the app exports
// identically from a cron job.
//
//   lumenroom import <dir> [--recursive]
//   lumenroom export --dest <dir> [--all | --picks | --collection <name> | <files…>]
//                    [--preset <name>] [--format jpeg|png|tiff] [--quality N]
//                    [--long-edge N] [--full-raw]

use crate::catalog::export::ExportOptions;
use crate::db::DbPool;
use crate::error::{AppError, Result};
use std::path::PathBuf;

/// Entry point called before the GUI boots. Returns true when a CLI
/// subcommand was handled (the caller exits instead of opening a window).
pub fn try_run_cli() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("import") => run(cmd_import(&args[1..])),
        Some("export") => run(cmd_export(&args[1..])),
        Some("--help") | Some("-h") | Some("help") => {
            print_help();
            0
        }
        _ => return false, // no subcommand — launch the GUI
    };
    std::process::exit(code);
}

fn run(r: Result<()>) -> i32 {
    match r {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    }
}

fn print_help() {
    println!(
        "LumenRoom — headless catalog operations

USAGE:
  lumenroom import <dir> [--recursive]
      Import photos into the catalog (same pipeline as the GUI).

  lumenroom export --dest <dir> [TARGET] [OPTIONS]
      Render catalogued photos with their saved edits.

  TARGET (one of):
      --all                 every photo in the catalog
      --picks               flagged picks only (default)
      --collection <name>   members of a collection
      <files…>              specific original file paths

  OPTIONS:
      --preset <name>       a saved export preset (from the Export dialog)
      --format jpeg|png|tiff   (default jpeg)
      --quality <50-100>       (default 90)
      --long-edge <px>         downscale to fit
      --full-raw               force full RAW demosaic for this run"
    );
}

/// Open the catalog exactly like the GUI does (prefs may relocate it).
fn open_catalog() -> Result<(DbPool, PathBuf, crate::prefs::Prefs)> {
    let dirs = directories::ProjectDirs::from("org", "LumenRoom", "LumenRoom")
        .ok_or_else(|| AppError::Msg("could not resolve a home directory".into()))?;
    let prefs = crate::prefs::load_prefs();
    let data_dir = prefs
        .catalog_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs.data_dir().to_path_buf());
    let cache_dir = dirs.cache_dir().join("thumbnails");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&cache_dir)?;
    let pool = crate::db::init_pool(&data_dir.join("catalog.sqlite"))?;
    Ok((pool, cache_dir, prefs))
}

fn cmd_import(args: &[String]) -> Result<()> {
    let recursive = args.iter().any(|a| a == "--recursive");
    let dir = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .ok_or_else(|| AppError::Msg("import: missing <dir>".into()))?;
    let root = PathBuf::from(dir);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {dir}")));
    }

    let (pool, cache_dir, prefs) = open_catalog()?;

    let mut files: Vec<PathBuf> = walkdir::WalkDir::new(&root)
        .max_depth(if recursive { usize::MAX } else { 1 })
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(crate::imaging::is_supported)
                .unwrap_or(false)
        })
        .collect();
    files.sort();

    let total = files.len();
    let mut ok = 0usize;
    for (i, path) in files.iter().enumerate() {
        match crate::catalog::scan::process_one(path, &cache_dir, &prefs.preview_build, &pool) {
            Ok(meta) => {
                ok += 1;
                println!("[{}/{}] {}", i + 1, total, meta.filename);
            }
            Err(e) => eprintln!("[{}/{}] FAILED {}: {e}", i + 1, total, path.display()),
        }
    }
    println!("imported {ok}/{total}");
    Ok(())
}

fn cmd_export(args: &[String]) -> Result<()> {
    // ── flag parsing (tiny, by hand — the surface is small and stable) ──
    let mut dest: Option<String> = None;
    let mut preset: Option<String> = None;
    let mut collection: Option<String> = None;
    let mut format: Option<String> = None;
    let mut quality: Option<u8> = None;
    let mut long_edge: Option<u32> = None;
    let mut all = false;
    let mut picks = false;
    let mut full_raw = false;
    let mut paths: Vec<String> = Vec::new();

    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = |name: &str| -> Result<String> {
            it.next()
                .cloned()
                .ok_or_else(|| AppError::Msg(format!("{name} needs a value")))
        };
        match a.as_str() {
            "--dest" => dest = Some(val("--dest")?),
            "--preset" => preset = Some(val("--preset")?),
            "--collection" => collection = Some(val("--collection")?),
            "--format" => format = Some(val("--format")?),
            "--quality" => quality = Some(val("--quality")?.parse().map_err(bad_num)?),
            "--long-edge" => long_edge = Some(val("--long-edge")?.parse().map_err(bad_num)?),
            "--all" => all = true,
            "--picks" => picks = true,
            "--full-raw" => full_raw = true,
            other if other.starts_with("--") => {
                return Err(AppError::Msg(format!("unknown flag: {other}")))
            }
            file => paths.push(file.to_string()),
        }
    }
    let dest = PathBuf::from(dest.ok_or_else(|| AppError::Msg("export: --dest is required".into()))?);
    std::fs::create_dir_all(&dest)?;

    let (pool, cache_dir, prefs) = open_catalog()?;
    let masks_dir = cache_dir.join("masks");
    let conn = pool.get().map_err(AppError::Pool)?;

    // ── options: preset (saved in prefs by the Export dialog) under flags ──
    let mut opts: ExportOptions = match &preset {
        Some(name) => {
            let entry = prefs
                .export_presets
                .iter()
                .find(|p| p.name == *name)
                .ok_or_else(|| AppError::Msg(format!("no export preset named \"{name}\"")))?;
            serde_json::from_str(&entry.options)
                .map_err(|e| AppError::Msg(format!("preset \"{name}\" is unreadable: {e}")))?
        }
        None => ExportOptions::default(),
    };
    if let Some(f) = format {
        opts.format = f;
    }
    if let Some(q) = quality {
        opts.quality = q.clamp(50, 100);
    }
    if let Some(px) = long_edge {
        opts.resize_mode = "long".into();
        opts.resize_value = Some(px);
    }
    let raw_full = full_raw || prefs.raw_decode == "full";

    // ── target ids ──
    let ids: Vec<String> = if let Some(name) = collection {
        let mut stmt = conn.prepare(
            "SELECT ci.image_id FROM collection_images ci
             JOIN collections c ON c.id = ci.collection_id WHERE c.name = ?1",
        )?;
        let ids: Vec<String> = stmt
            .query_map([&name], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        if ids.is_empty() {
            return Err(AppError::Msg(format!("collection \"{name}\" is empty or unknown")));
        }
        ids
    } else if !paths.is_empty() {
        let mut ids = Vec::new();
        for p in &paths {
            let abs = std::fs::canonicalize(p)
                .map(|c| c.display().to_string())
                .unwrap_or_else(|_| p.clone());
            let id: Option<String> = rusqlite::OptionalExtension::optional(conn.query_row(
                "SELECT id FROM images WHERE path = ?1",
                [&abs],
                |r| r.get(0),
            ))?;
            match id {
                Some(id) => ids.push(id),
                None => eprintln!("not in catalog (skipped): {p}"),
            }
        }
        ids
    } else if all {
        let mut stmt = conn.prepare("SELECT id FROM images")?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        ids
    } else {
        // Default: picks — the "export my keepers" one-liner.
        if !picks {
            eprintln!("no target given — exporting flagged picks (use --all for everything)");
        }
        let mut stmt = conn.prepare("SELECT id FROM images WHERE flag = 1")?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        ids
    };
    if ids.is_empty() {
        return Err(AppError::Msg("nothing to export".into()));
    }

    let ext = match opts.format.as_str() {
        "png" => "png",
        "tiff" => "tif",
        _ => "jpg",
    };

    let total = ids.len();
    for (i, id) in ids.iter().enumerate() {
        let filename: String =
            conn.query_row("SELECT filename FROM images WHERE id = ?1", [id], |r| r.get(0))?;
        let stem = std::path::Path::new(&filename)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| id.clone());
        // De-dupe stems (virtual copies / same name from two folders).
        let mut out = dest.join(format!("{stem}.{ext}"));
        let mut n = 2;
        while out.exists() {
            out = dest.join(format!("{stem}-{n}.{ext}"));
            n += 1;
        }
        match crate::catalog::export::render_with_options(
            id,
            out.clone(),
            &opts,
            raw_full,
            pool.clone(),
            &masks_dir,
        ) {
            Ok(written) => println!("[{}/{}] {written}", i + 1, total),
            Err(e) => eprintln!("[{}/{}] FAILED {stem}: {e}", i + 1, total),
        }
    }
    Ok(())
}

fn bad_num<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Msg(format!("invalid number: {e}"))
}
