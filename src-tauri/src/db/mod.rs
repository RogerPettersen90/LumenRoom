pub mod models;
pub mod queries;

use crate::error::{AppError, Result};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::{Path, PathBuf};

pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Shared application state injected into every command via `tauri::State`.
/// Cloning the pool is cheap (it is internally reference-counted), so workers
/// can each pull their own connection without serializing on a global mutex.
pub struct AppState {
    pub db: DbPool,
    pub cache_dir: PathBuf,
    /// Debounce generations for the automatic XMP sidecar writer:
    /// image id -> latest edit generation. A delayed task only writes the
    /// sidecar if its generation is still current when it wakes.
    pub xmp_gen: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, u64>>>,
    /// Live application preferences (persisted via prefs.rs).
    pub prefs: std::sync::Mutex<crate::prefs::Prefs>,
}

impl AppState {
    pub fn conn(&self) -> Result<DbConn> {
        self.db.get().map_err(AppError::Pool)
    }
}

/// Catalogs created before virtual copies had `path TEXT NOT NULL UNIQUE`.
/// SQLite can't drop a column constraint, so rebuild the table once. Ids are
/// preserved, so FK references stay intact (FKs are off during the rebuild).
fn drop_path_unique_if_present(conn: &DbConn) -> Result<()> {
    let ddl: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='images'",
        [],
        |r| r.get(0),
    )?;
    if !ddl.to_uppercase().contains("UNIQUE") {
        return Ok(()); // already migrated (id is PRIMARY KEY, not UNIQUE-keyword)
    }

    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         BEGIN;
         CREATE TABLE images_new (
            id TEXT PRIMARY KEY, path TEXT NOT NULL, filename TEXT NOT NULL,
            file_size INTEGER NOT NULL, mtime INTEGER NOT NULL,
            width INTEGER, height INTEGER, format TEXT,
            camera_make TEXT, camera_model TEXT, lens TEXT, iso INTEGER,
            aperture REAL, shutter TEXT, focal_length REAL, captured_at INTEGER,
            orientation INTEGER DEFAULT 1, thumb_key TEXT,
            rating INTEGER DEFAULT 0, flag INTEGER DEFAULT 0, color_label TEXT,
            imported_at INTEGER NOT NULL,
            iptc_title TEXT, iptc_caption TEXT, iptc_copyright TEXT,
            iptc_creator TEXT, copy_of TEXT
         );
         INSERT INTO images_new SELECT
            id, path, filename, file_size, mtime, width, height, format,
            camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
            captured_at, orientation, thumb_key, rating, flag, color_label,
            imported_at, iptc_title, iptc_caption, iptc_copyright, iptc_creator,
            copy_of
         FROM images;
         DROP TABLE images;
         ALTER TABLE images_new RENAME TO images;
         CREATE INDEX IF NOT EXISTS idx_images_captured ON images(captured_at);
         CREATE INDEX IF NOT EXISTS idx_images_rating   ON images(rating);
         CREATE INDEX IF NOT EXISTS idx_images_imported ON images(imported_at);
         COMMIT;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}

pub(crate) fn add_column_if_missing(
    conn: &DbConn,
    table: &str,
    column: &str,
    ddl_type: &str,
) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .flatten()
        .any(|c| c == column);
    if !exists {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"),
            [],
        )?;
    }
    Ok(())
}

/// Open (or create) the catalog database and run embedded migrations.
pub fn init_pool(db_path: &Path) -> Result<DbPool> {
    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        // busy_timeout: a half-dead previous instance must delay us, not
        // make the catalog silently appear empty / wedge writes.
        c.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )
    });

    let pool = Pool::builder()
        .max_size(8)
        .build(manager)
        .map_err(AppError::Pool)?;

    let conn = pool.get().map_err(AppError::Pool)?;
    conn.execute_batch(include_str!("../../migrations/0001_init.sql"))?;
    conn.execute_batch(include_str!("../../migrations/0002_presets.sql"))?;
    conn.execute_batch(include_str!("../../migrations/0003_organize.sql"))?;
    conn.execute_batch(include_str!("../../migrations/0004_smart.sql"))?;

    // 0005: editable IPTC fields (ALTER ADD COLUMN must be guarded by hand —
    // SQLite has no IF NOT EXISTS for columns).
    for col in ["iptc_title", "iptc_caption", "iptc_copyright", "iptc_creator"] {
        add_column_if_missing(&conn, "images", col, "TEXT")?;
    }

    // 0006: virtual copies (a second develop state of the same file).
    add_column_if_missing(&conn, "images", "copy_of", "TEXT")?;
    drop_path_unique_if_present(&conn)?;

    // 0007: stacking — stack_id groups rows, stack_pos orders them (0 = top,
    // the photo shown when the stack is collapsed).
    add_column_if_missing(&conn, "images", "stack_id", "TEXT")?;
    add_column_if_missing(&conn, "images", "stack_pos", "INTEGER NOT NULL DEFAULT 0")?;

    // 0008: hierarchical keywords ("Travel > Norway").
    add_column_if_missing(&conn, "keywords", "parent_id", "INTEGER")?;

    // Fold the WAL back into the main file at startup: after unclean exits
    // most of the catalog can otherwise live only in the -wal sidecar.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    // 0009: publish-to-folder — per-collection destination + export options,
    // and a ledger of what's been published (params hash detects re-edits).
    add_column_if_missing(&conn, "collections", "publish_dir", "TEXT")?;
    add_column_if_missing(&conn, "collections", "publish_opts", "TEXT")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS published (
             collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
             image_id      TEXT NOT NULL,
             params_hash   TEXT NOT NULL,
             file          TEXT NOT NULL,
             PRIMARY KEY (collection_id, image_id)
         );",
    )?;

    Ok(pool)
}
