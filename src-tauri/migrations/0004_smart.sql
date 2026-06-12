-- Smart collections: rule-based virtual albums (rules evaluated client-side).

CREATE TABLE IF NOT EXISTS smart_collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    rules      TEXT NOT NULL,            -- JSON SmartRules
    created_at INTEGER NOT NULL
);
