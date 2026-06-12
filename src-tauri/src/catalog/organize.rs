use crate::db::models::{Collection, Keyword};
use crate::db::{queries, AppState};
use crate::error::Result;
use rusqlite::OptionalExtension;

// ── Collections ──

#[tauri::command]
pub fn create_collection(name: String, state: tauri::State<'_, AppState>) -> Result<Collection> {
    let conn = state.conn()?;
    queries::create_collection(&conn, name.trim())
}

#[tauri::command]
pub fn list_collections(state: tauri::State<'_, AppState>) -> Result<Vec<Collection>> {
    let conn = state.conn()?;
    queries::list_collections(&conn)
}

#[tauri::command]
pub fn delete_collection(id: i64, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::delete_collection(&conn, id)
}

#[tauri::command]
pub fn add_to_collection(
    id: i64,
    image_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::add_to_collection(&conn, id, &image_ids)
}

#[tauri::command]
pub fn remove_from_collection(
    id: i64,
    image_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::remove_from_collection(&conn, id, &image_ids)
}

#[tauri::command]
pub fn collection_members(id: i64, state: tauri::State<'_, AppState>) -> Result<Vec<String>> {
    let conn = state.conn()?;
    queries::collection_members(&conn, id)
}

// ── Smart collections (rules stored as JSON, evaluated client-side) ──

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollection {
    pub id: i64,
    pub name: String,
    pub rules: String, // opaque JSON for the frontend
}

#[tauri::command]
pub fn save_smart_collection(
    name: String,
    rules: String,
    state: tauri::State<'_, AppState>,
) -> Result<SmartCollection> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO smart_collections (name, rules, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET rules = excluded.rules",
        rusqlite::params![name.trim(), rules, now],
    )?;
    let row = conn.query_row(
        "SELECT id, name, rules FROM smart_collections WHERE name = ?1",
        rusqlite::params![name.trim()],
        |r| {
            Ok(SmartCollection {
                id: r.get(0)?,
                name: r.get(1)?,
                rules: r.get(2)?,
            })
        },
    )?;
    Ok(row)
}

#[tauri::command]
pub fn list_smart_collections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SmartCollection>> {
    let conn = state.conn()?;
    let mut stmt =
        conn.prepare("SELECT id, name, rules FROM smart_collections ORDER BY name ASC")?;
    let rows = stmt.query_map([], |r| {
        Ok(SmartCollection {
            id: r.get(0)?,
            name: r.get(1)?,
            rules: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command]
pub fn delete_smart_collection(id: i64, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM smart_collections WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

// ── Keywords ──

#[tauri::command]
pub fn add_keyword(
    image_ids: Vec<String>,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Keyword> {
    let conn = state.conn()?;
    let trimmed = name.trim().to_lowercase();
    let mut last = None;
    for id in &image_ids {
        last = Some(queries::add_keyword(&conn, id, &trimmed)?);
    }
    last.ok_or_else(|| crate::error::AppError::Msg("no images given".into()))
}

#[tauri::command]
pub fn remove_keyword(
    image_id: String,
    keyword_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    queries::remove_keyword(&conn, &image_id, keyword_id)
}

#[tauri::command]
pub fn image_keywords(image_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<Keyword>> {
    let conn = state.conn()?;
    queries::image_keywords(&conn, &image_id)
}

#[tauri::command]
pub fn list_keywords(state: tauri::State<'_, AppState>) -> Result<Vec<Keyword>> {
    let conn = state.conn()?;
    queries::list_keywords(&conn)
}

#[tauri::command]
pub fn keyword_members(id: i64, state: tauri::State<'_, AppState>) -> Result<Vec<String>> {
    let conn = state.conn()?;
    queries::keyword_members(&conn, id)
}

// ── Stacking ──

#[tauri::command]
pub fn stack_images(image_ids: Vec<String>, state: tauri::State<'_, AppState>) -> Result<String> {
    let conn = state.conn()?;
    queries::stack_images(&conn, &image_ids)
}

#[tauri::command]
pub fn unstack(stack_id: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::unstack(&conn, &stack_id)
}

#[tauri::command]
pub fn set_stack_top(image_id: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::set_stack_top(&conn, &image_id)
}

// ── Publish-to-folder ──

/// Configure a collection's publish destination + export options (JSON of
/// ExportOptions).
#[tauri::command]
pub fn set_publish_config(
    id: i64,
    dir: String,
    options: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE collections SET publish_dir = ?1, publish_opts = ?2 WHERE id = ?3",
        rusqlite::params![dir, options, id],
    )?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishReport {
    pub exported: usize,
    pub removed: usize,
    pub skipped: usize,
}

/// Publish a collection to its folder: export new/re-edited members, delete
/// files for photos that left the collection. Re-edit detection is a hash of
/// the saved EditParams JSON kept in the `published` ledger.
#[tauri::command]
pub async fn publish_collection(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<PublishReport> {
    let pool = state.db.clone();
    let masks_dir = state.cache_dir.join("masks");
    let raw_full = state.prefs.lock().expect("prefs poisoned").raw_decode == "full";

    tauri::async_runtime::spawn_blocking(move || -> Result<PublishReport> {
        let conn = pool.get().map_err(crate::error::AppError::Pool)?;
        let (dir, opts_json): (Option<String>, Option<String>) = conn.query_row(
            "SELECT publish_dir, publish_opts FROM collections WHERE id = ?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let Some(dir) = dir else {
            return Err(crate::error::AppError::Msg("collection has no publish folder".into()));
        };
        let opts: crate::catalog::export::ExportOptions = opts_json
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        std::fs::create_dir_all(&dir).map_err(crate::error::AppError::Io)?;

        let members = queries::collection_members(&conn, id)?;
        let ext = match opts.format.as_str() {
            "png" => "png",
            "tiff" => "tif",
            _ => "jpg",
        };

        let mut exported = 0usize;
        let mut skipped = 0usize;
        for image_id in &members {
            let params = queries::get_edit_params(&conn, image_id)?;
            let hash = blake3::hash(serde_json::to_string(&params)?.as_bytes())
                .to_hex()
                .to_string();
            let filename: String = conn.query_row(
                "SELECT filename FROM images WHERE id = ?1",
                rusqlite::params![image_id],
                |r| r.get(0),
            )?;
            let stem = std::path::Path::new(&filename)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| image_id.clone());
            let dest = std::path::Path::new(&dir).join(format!("{stem}.{ext}"));

            let prev: Option<String> = conn
                .query_row(
                    "SELECT params_hash FROM published
                     WHERE collection_id = ?1 AND image_id = ?2",
                    rusqlite::params![id, image_id],
                    |r| r.get(0),
                )
                .optional()?;
            if prev.as_deref() == Some(hash.as_str()) && dest.exists() {
                skipped += 1;
                continue;
            }

            crate::catalog::export::render_with_options(
                image_id,
                dest.clone(),
                &opts,
                raw_full,
                pool.clone(),
                &masks_dir,
            )?;
            conn.execute(
                "INSERT INTO published (collection_id, image_id, params_hash, file)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(collection_id, image_id) DO UPDATE
                 SET params_hash = excluded.params_hash, file = excluded.file",
                rusqlite::params![id, image_id, hash, dest.display().to_string()],
            )?;
            exported += 1;
        }

        // Retract photos that left the collection.
        let mut stmt = conn.prepare(
            "SELECT image_id, file FROM published WHERE collection_id = ?1",
        )?;
        let ledger: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        let member_set: std::collections::HashSet<&String> = members.iter().collect();
        let mut removed = 0usize;
        for (image_id, file) in ledger {
            if !member_set.contains(&image_id) {
                let _ = std::fs::remove_file(&file); // best effort
                conn.execute(
                    "DELETE FROM published WHERE collection_id = ?1 AND image_id = ?2",
                    rusqlite::params![id, image_id],
                )?;
                removed += 1;
            }
        }

        Ok(PublishReport { exported, removed, skipped })
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(format!("publish task panicked: {e}")))?
}
