PRAGMA journal_mode = WAL;       -- concurrent reads during writes
PRAGMA foreign_keys = ON;

-- Immutable record of an original file on disk. Originals are NEVER modified.
CREATE TABLE IF NOT EXISTS images (
    id            TEXT PRIMARY KEY,          -- blake3(path + mtime + size)
    path          TEXT NOT NULL,             -- absolute path to ORIGINAL (read-only;
                                             -- NOT unique: virtual copies share it)
    filename      TEXT NOT NULL,
    file_size     INTEGER NOT NULL,
    mtime         INTEGER NOT NULL,          -- unix secs, for re-scan staleness
    width         INTEGER,
    height        INTEGER,
    format        TEXT,                      -- "cr3", "jpeg", ...
    -- denormalized EXIF for fast grid sorting/filtering
    camera_make   TEXT,
    camera_model  TEXT,
    lens          TEXT,
    iso           INTEGER,
    aperture      REAL,
    shutter       TEXT,
    focal_length  REAL,
    captured_at   INTEGER,                   -- unix secs from EXIF
    orientation   INTEGER DEFAULT 1,
    thumb_key     TEXT,                      -- cache filename, NULL = not yet baked
    -- culling
    rating        INTEGER DEFAULT 0,         -- 0..5 stars
    flag          INTEGER DEFAULT 0,         -- -1 reject, 0 none, 1 pick
    color_label   TEXT,
    imported_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_captured ON images(captured_at);
CREATE INDEX IF NOT EXISTS idx_images_rating   ON images(rating);
CREATE INDEX IF NOT EXISTS idx_images_imported ON images(imported_at);

-- Current develop settings (1:1 with image). JSON keeps the schema stable as
-- we add adjustments without new migrations.
CREATE TABLE IF NOT EXISTS edit_params (
    image_id   TEXT PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
    params     TEXT NOT NULL,                -- JSON: EditParams
    updated_at INTEGER NOT NULL
);

-- Append-only history for undo/redo + the Develop history panel.
CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,             -- ordering within an image
    label      TEXT NOT NULL,                -- "Exposure +0.35"
    params     TEXT NOT NULL,                -- full EditParams snapshot
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_image ON history(image_id, seq);
