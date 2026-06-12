-- Collections (virtual albums) and keywords (tags).

CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_images (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    image_id      TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, image_id)
);

CREATE TABLE IF NOT EXISTS keywords (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS image_keywords (
    image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (image_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_ik_keyword ON image_keywords(keyword_id);
