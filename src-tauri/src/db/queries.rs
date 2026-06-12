use crate::db::models::{Collection, EditParams, HistoryStep, ImageMeta, Keyword, Preset, Snapshot};
use crate::db::DbConn;
use crate::error::Result;
use rusqlite::{params, OptionalExtension};

/// Insert or refresh a catalog row. On conflict we only touch volatile fields
/// so existing edits / ratings survive a re-scan.
pub fn upsert_image(conn: &DbConn, m: &ImageMeta, file_size: u64, mtime: i64) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    let thumb_key = m.thumb_ready.then(|| format!("{}.jpg", m.id));
    conn.execute(
        "INSERT INTO images
            (id, path, filename, file_size, mtime, width, height, format,
             camera_model, lens, iso, aperture, shutter, focal_length,
             captured_at, orientation, thumb_key, imported_at)
         VALUES
            (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
             ?15, ?16, ?17, ?18)
         ON CONFLICT(id) DO UPDATE SET
            mtime     = excluded.mtime,
            thumb_key = excluded.thumb_key",
        params![
            m.id,
            m.path,
            m.filename,
            file_size as i64,
            mtime,
            m.width,
            m.height,
            m.format,
            m.camera_model,
            m.lens,
            m.iso,
            m.aperture,
            m.shutter,
            m.focal_length,
            m.captured_at,
            m.orientation,
            thumb_key,
            now,
        ],
    )?;
    Ok(())
}

/// List catalogued images, newest captures first.
pub fn list_images(conn: &DbConn) -> Result<Vec<ImageMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, width, height, COALESCE(format, ''), camera_model,
                lens, iso, aperture, shutter, focal_length, captured_at, orientation,
                rating, flag, color_label, thumb_key, copy_of, stack_id,
                COALESCE(stack_pos, 0)
         FROM images
         ORDER BY COALESCE(captured_at, imported_at) DESC",
    )?;

    let rows = stmt.query_map([], |r| {
        Ok(ImageMeta {
            id: r.get(0)?,
            path: r.get(1)?,
            filename: r.get(2)?,
            width: r.get(3)?,
            height: r.get(4)?,
            format: r.get(5)?,
            camera_model: r.get(6)?,
            lens: r.get(7)?,
            iso: r.get(8)?,
            aperture: r.get(9)?,
            shutter: r.get(10)?,
            focal_length: r.get(11)?,
            captured_at: r.get(12)?,
            orientation: r.get(13)?,
            rating: r.get(14)?,
            flag: r.get(15)?,
            color_label: r.get(16)?,
            thumb_ready: r.get::<_, Option<String>>(17)?.is_some(),
            copy_of: r.get(18)?,
            stack_id: r.get(19)?,
            stack_pos: r.get(20)?,
        })
    })?;

    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Original file path + EXIF orientation for an image, for export/render.
pub fn get_export_source(conn: &DbConn, image_id: &str) -> Result<(String, u16)> {
    let row = conn.query_row(
        "SELECT path, COALESCE(orientation, 1) FROM images WHERE id = ?1",
        params![image_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u16)),
    )?;
    Ok(row)
}

/// Editable IPTC fields.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Iptc {
    pub title: Option<String>,
    pub caption: Option<String>,
    pub copyright: Option<String>,
    pub creator: Option<String>,
}

pub fn get_iptc(conn: &DbConn, image_id: &str) -> Result<Iptc> {
    let row = conn.query_row(
        "SELECT iptc_title, iptc_caption, iptc_copyright, iptc_creator
         FROM images WHERE id = ?1",
        params![image_id],
        |r| {
            Ok(Iptc {
                title: r.get(0)?,
                caption: r.get(1)?,
                copyright: r.get(2)?,
                creator: r.get(3)?,
            })
        },
    )?;
    Ok(row)
}

pub fn set_iptc(conn: &DbConn, image_id: &str, iptc: &Iptc) -> Result<()> {
    conn.execute(
        "UPDATE images SET iptc_title = ?1, iptc_caption = ?2,
                           iptc_copyright = ?3, iptc_creator = ?4
         WHERE id = ?5",
        params![iptc.title, iptc.caption, iptc.copyright, iptc.creator, image_id],
    )?;
    Ok(())
}

/// Original file path + star rating, for writing an XMP sidecar.
pub fn get_sidecar_source(conn: &DbConn, image_id: &str) -> Result<(String, i32)> {
    let row = conn.query_row(
        "SELECT path, COALESCE(rating, 0) FROM images WHERE id = ?1",
        params![image_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?)),
    )?;
    Ok(row)
}

/// True when the image already has saved develop settings.
pub fn has_edit_params(conn: &DbConn, image_id: &str) -> Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM edit_params WHERE image_id = ?1",
            params![image_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

/// Load the current edit params for an image (neutral default if none saved).
pub fn get_edit_params(conn: &DbConn, image_id: &str) -> Result<EditParams> {
    let json: Option<String> = conn
        .query_row(
            "SELECT params FROM edit_params WHERE image_id = ?1",
            params![image_id],
            |r| r.get(0),
        )
        .optional()?;

    match json {
        Some(j) => Ok(serde_json::from_str(&j)?),
        None => Ok(EditParams::default()),
    }
}

/// Persist current edit params and append a history step (non-destructive).
pub fn save_edit_params(
    conn: &DbConn,
    image_id: &str,
    params: &EditParams,
    label: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    let json = serde_json::to_string(params)?;

    conn.execute(
        "INSERT INTO edit_params (image_id, params, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(image_id) DO UPDATE SET
            params = excluded.params,
            updated_at = excluded.updated_at",
        params![image_id, json, now],
    )?;

    let next_seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM history WHERE image_id = ?1",
        params![image_id],
        |r| r.get(0),
    )?;

    conn.execute(
        "INSERT INTO history (image_id, seq, label, params, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![image_id, next_seq, label, json, now],
    )?;

    // Keep history readable: cap at the newest 25 steps per image (the
    // current state itself lives in edit_params, so nothing is lost).
    conn.execute(
        "DELETE FROM history WHERE image_id = ?1 AND seq <= ?2 - 25",
        params![image_id, next_seq],
    )?;

    Ok(())
}

/// Full history log for an image, oldest first.
pub fn get_history(conn: &DbConn, image_id: &str) -> Result<Vec<HistoryStep>> {
    let mut stmt = conn.prepare(
        "SELECT seq, label, params, created_at
         FROM history WHERE image_id = ?1 ORDER BY seq ASC",
    )?;

    let rows = stmt.query_map(params![image_id], |r| {
        let params_json: String = r.get(2)?;
        Ok(HistoryStep {
            seq: r.get(0)?,
            label: r.get(1)?,
            params: serde_json::from_str(&params_json).unwrap_or_default(),
            created_at: r.get(3)?,
        })
    })?;

    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Set or clear a color label (red/yellow/green/blue/purple).
pub fn set_label(conn: &DbConn, image_id: &str, label: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE images SET color_label = ?1 WHERE id = ?2",
        params![label, image_id],
    )?;
    Ok(())
}

/// Read back the culling state (rating/flag/label) for an image. Used after a
/// re-scan upsert so streamed metadata doesn't clobber existing culls in the UI.
pub fn get_cull_state(conn: &DbConn, image_id: &str) -> Result<(i32, i32, Option<String>)> {
    let row = conn.query_row(
        "SELECT COALESCE(rating,0), COALESCE(flag,0), color_label FROM images WHERE id = ?1",
        params![image_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(row)
}

// ── Stacking ──

/// Group images into one stack (the classic Ctrl+G). If any already belong to a
/// stack, that whole stack is absorbed. The order of `ids` becomes the stack
/// order (first = top); absorbed members append after, keeping their relative
/// order. Returns the stack id.
pub fn stack_images(conn: &DbConn, ids: &[String]) -> Result<String> {
    if ids.is_empty() {
        return Err(crate::error::AppError::Msg("nothing to stack".into()));
    }
    let stack_id = format!("stk-{}", ids[0]);

    // Absorb existing stacks any of the ids belong to.
    let mut absorbed: Vec<String> = Vec::new();
    for id in ids {
        let existing: Option<String> = conn
            .query_row("SELECT stack_id FROM images WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?
            .flatten();
        if let Some(sid) = existing {
            let mut stmt = conn.prepare(
                "SELECT id FROM images WHERE stack_id = ?1 ORDER BY stack_pos",
            )?;
            for member in stmt.query_map(params![sid], |r| r.get::<_, String>(0))? {
                let member = member?;
                if !ids.contains(&member) && !absorbed.contains(&member) {
                    absorbed.push(member);
                }
            }
        }
    }

    let tx = conn.unchecked_transaction()?;
    for (pos, id) in ids.iter().chain(absorbed.iter()).enumerate() {
        tx.execute(
            "UPDATE images SET stack_id = ?1, stack_pos = ?2 WHERE id = ?3",
            params![stack_id, pos as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(stack_id)
}

/// Dissolve a stack (the classic Ctrl+Shift+G).
pub fn unstack(conn: &DbConn, stack_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE images SET stack_id = NULL, stack_pos = 0 WHERE stack_id = ?1",
        params![stack_id],
    )?;
    Ok(())
}

/// Promote one member to the top of its stack (shown while collapsed); the
/// rest keep their relative order.
pub fn set_stack_top(conn: &DbConn, image_id: &str) -> Result<()> {
    let stack_id: Option<String> = conn
        .query_row(
            "SELECT stack_id FROM images WHERE id = ?1",
            params![image_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let Some(sid) = stack_id else {
        return Ok(()); // not stacked — nothing to do
    };

    let mut stmt =
        conn.prepare("SELECT id FROM images WHERE stack_id = ?1 ORDER BY stack_pos")?;
    let members: Vec<String> = stmt
        .query_map(params![sid], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let tx = conn.unchecked_transaction()?;
    let mut pos = 1i64;
    for m in &members {
        let p = if m == image_id { 0 } else { let v = pos; pos += 1; v };
        tx.execute(
            "UPDATE images SET stack_pos = ?1 WHERE id = ?2",
            params![p, m],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ── Virtual copies ──

/// Duplicate an image row (and its current develop settings) as a virtual
/// copy: same file on disk, independent edits. Returns the new id.
pub fn create_virtual_copy(conn: &DbConn, image_id: &str) -> Result<String> {
    let base = image_id.split("-v").next().unwrap_or(image_id);
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM images WHERE copy_of = ?1 OR copy_of = ?2",
        params![image_id, base],
        |r| r.get(0),
    )?;
    let new_id = format!("{base}-v{}", n + 1);
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO images (id, path, filename, file_size, mtime, width, height, format,
            camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
            captured_at, orientation, thumb_key, rating, flag, color_label, imported_at,
            iptc_title, iptc_caption, iptc_copyright, iptc_creator, copy_of)
         SELECT ?1, path, filename, file_size, mtime, width, height, format,
            camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
            captured_at, orientation, thumb_key, rating, flag, color_label, ?2,
            iptc_title, iptc_caption, iptc_copyright, iptc_creator, ?3
         FROM images WHERE id = ?4",
        params![new_id, now, base, image_id],
    )?;

    // The copy starts from the source's CURRENT develop settings (classic rule).
    conn.execute(
        "INSERT INTO edit_params (image_id, params, updated_at)
         SELECT ?1, params, ?2 FROM edit_params WHERE image_id = ?3",
        params![new_id, now, image_id],
    )?;

    Ok(new_id)
}

/// Remove a row from the catalog (originals on disk are never touched; all
/// dependent rows cascade).
pub fn remove_from_catalog(conn: &DbConn, image_id: &str) -> Result<()> {
    conn.execute("DELETE FROM images WHERE id = ?1", params![image_id])?;
    Ok(())
}

/// Remove every catalogued photo inside `folder` (and its subfolders) from
/// the catalog. Files on disk are untouched. Returns the removed ids so the
/// caller can clean their cached previews.
pub fn remove_folder_from_catalog(conn: &DbConn, folder: &str) -> Result<Vec<String>> {
    let folder = folder.trim_end_matches('/');
    let mut stmt = conn.prepare("SELECT id FROM images WHERE path LIKE ?1 || '/%'")?;
    let ids: Vec<String> = stmt
        .query_map(params![folder], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    conn.execute(
        "DELETE FROM images WHERE path LIKE ?1 || '/%'",
        params![folder],
    )?;
    Ok(ids)
}

// ── Collections ──

pub fn create_collection(conn: &DbConn, name: &str) -> Result<Collection> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO collections (name, created_at) VALUES (?1, ?2)
         ON CONFLICT(name) DO NOTHING",
        params![name, now],
    )?;
    let row = conn.query_row(
        "SELECT id, name, publish_dir FROM collections WHERE name = ?1",
        params![name],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)),
    )?;
    Ok(Collection { id: row.0, name: row.1, count: 0, publish_dir: row.2 })
}

pub fn list_collections(conn: &DbConn) -> Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, COUNT(ci.image_id), c.publish_dir
         FROM collections c
         LEFT JOIN collection_images ci ON ci.collection_id = c.id
         GROUP BY c.id ORDER BY c.name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection { id: r.get(0)?, name: r.get(1)?, count: r.get(2)?, publish_dir: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_collection(conn: &DbConn, id: i64) -> Result<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn add_to_collection(conn: &DbConn, collection_id: i64, image_ids: &[String]) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?1, ?2)",
    )?;
    for id in image_ids {
        stmt.execute(params![collection_id, id])?;
    }
    Ok(())
}

pub fn remove_from_collection(
    conn: &DbConn,
    collection_id: i64,
    image_ids: &[String],
) -> Result<()> {
    let mut stmt = conn
        .prepare("DELETE FROM collection_images WHERE collection_id = ?1 AND image_id = ?2")?;
    for id in image_ids {
        stmt.execute(params![collection_id, id])?;
    }
    Ok(())
}

pub fn collection_members(conn: &DbConn, collection_id: i64) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT image_id FROM collection_images WHERE collection_id = ?1")?;
    let rows = stmt.query_map(params![collection_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ── Keywords ──

/// Find-or-create a keyword (upserting the whole "Parent > Child" chain when
/// given hierarchical syntax) and link the image to the leaf. Keyword names
/// stay globally unique (one "Norway", wherever it hangs).
pub fn add_keyword(conn: &DbConn, image_id: &str, name: &str) -> Result<Keyword> {
    let mut parent: Option<i64> = None;
    let mut id: i64 = 0;
    let mut leaf = String::new();
    for part in name.split('>').map(str::trim).filter(|p| !p.is_empty()) {
        conn.execute(
            "INSERT INTO keywords (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
            params![part],
        )?;
        id = conn.query_row(
            "SELECT id FROM keywords WHERE name = ?1",
            params![part],
            |r| r.get(0),
        )?;
        // Re-parent on every mention so "a > b" can adopt an existing root b.
        conn.execute(
            "UPDATE keywords SET parent_id = ?1 WHERE id = ?2 AND id IS NOT ?1",
            params![parent, id],
        )?;
        parent = Some(id);
        leaf = part.to_string();
    }
    if leaf.is_empty() {
        return Err(crate::error::AppError::Msg("empty keyword".into()));
    }
    conn.execute(
        "INSERT OR IGNORE INTO image_keywords (image_id, keyword_id) VALUES (?1, ?2)",
        params![image_id, id],
    )?;
    let parent_id: Option<i64> =
        conn.query_row("SELECT parent_id FROM keywords WHERE id = ?1", params![id], |r| {
            r.get(0)
        })?;
    Ok(Keyword { id, name: leaf, count: 0, parent_id })
}

pub fn remove_keyword(conn: &DbConn, image_id: &str, keyword_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM image_keywords WHERE image_id = ?1 AND keyword_id = ?2",
        params![image_id, keyword_id],
    )?;
    // Garbage-collect orphaned keywords so the keyword list stays clean —
    // but keep nodes that still have children hanging under them.
    conn.execute(
        "DELETE FROM keywords WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM image_keywords WHERE keyword_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM keywords WHERE parent_id = ?1)",
        params![keyword_id],
    )?;
    Ok(())
}

pub fn image_keywords(conn: &DbConn, image_id: &str) -> Result<Vec<Keyword>> {
    let mut stmt = conn.prepare(
        "SELECT k.id, k.name, k.parent_id FROM keywords k
         JOIN image_keywords ik ON ik.keyword_id = k.id
         WHERE ik.image_id = ?1 ORDER BY k.name ASC",
    )?;
    let rows = stmt.query_map(params![image_id], |r| {
        Ok(Keyword { id: r.get(0)?, name: r.get(1)?, count: 0, parent_id: r.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_keywords(conn: &DbConn) -> Result<Vec<Keyword>> {
    let mut stmt = conn.prepare(
        "SELECT k.id, k.name, COUNT(ik.image_id), k.parent_id FROM keywords k
         LEFT JOIN image_keywords ik ON ik.keyword_id = k.id
         GROUP BY k.id ORDER BY k.name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Keyword { id: r.get(0)?, name: r.get(1)?, count: r.get(2)?, parent_id: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Images tagged with the keyword OR any descendant (the classic parent-includes-
/// children filtering), via a recursive CTE.
pub fn keyword_members(conn: &DbConn, keyword_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE kw(id) AS (
             SELECT ?1
             UNION ALL
             SELECT k.id FROM keywords k JOIN kw ON k.parent_id = kw.id
         )
         SELECT DISTINCT image_id FROM image_keywords WHERE keyword_id IN kw",
    )?;
    let rows = stmt.query_map(params![keyword_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ── Presets (global) ──

/// Create or update a preset by name. Returns the stored row.
pub fn save_preset(conn: &DbConn, name: &str, params_json: &EditParams) -> Result<Preset> {
    let now = chrono::Utc::now().timestamp();
    let json = serde_json::to_string(params_json)?;
    conn.execute(
        "INSERT INTO presets (name, params, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET params = excluded.params",
        params![name, json, now],
    )?;
    let row = conn.query_row(
        "SELECT id, name, params, created_at FROM presets WHERE name = ?1",
        params![name],
        map_preset,
    )?;
    Ok(row)
}

pub fn list_presets(conn: &DbConn) -> Result<Vec<Preset>> {
    let mut stmt =
        conn.prepare("SELECT id, name, params, created_at FROM presets ORDER BY name ASC")?;
    let rows = stmt.query_map([], map_preset)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_preset(conn: &DbConn, id: i64) -> Result<()> {
    conn.execute("DELETE FROM presets WHERE id = ?1", params![id])?;
    Ok(())
}

fn map_preset(r: &rusqlite::Row<'_>) -> rusqlite::Result<Preset> {
    let json: String = r.get(2)?;
    Ok(Preset {
        id: r.get(0)?,
        name: r.get(1)?,
        params: serde_json::from_str(&json).unwrap_or_default(),
        created_at: r.get(3)?,
    })
}

// ── Snapshots (per image) ──

pub fn save_snapshot(
    conn: &DbConn,
    image_id: &str,
    name: &str,
    params_json: &EditParams,
) -> Result<Snapshot> {
    let now = chrono::Utc::now().timestamp();
    let json = serde_json::to_string(params_json)?;
    conn.execute(
        "INSERT INTO snapshots (image_id, name, params, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![image_id, name, json, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Snapshot {
        id,
        name: name.to_string(),
        params: params_json.clone(),
        created_at: now,
    })
}

pub fn list_snapshots(conn: &DbConn, image_id: &str) -> Result<Vec<Snapshot>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, params, created_at FROM snapshots
         WHERE image_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![image_id], |r| {
        let json: String = r.get(2)?;
        Ok(Snapshot {
            id: r.get(0)?,
            name: r.get(1)?,
            params: serde_json::from_str(&json).unwrap_or_default(),
            created_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_snapshot(conn: &DbConn, id: i64) -> Result<()> {
    conn.execute("DELETE FROM snapshots WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    fn test_conn() -> DbConn {
        let pool = r2d2::Pool::builder()
            .max_size(1)
            .build(SqliteConnectionManager::memory())
            .unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(include_str!("../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/0002_presets.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/0003_organize.sql"))
            .unwrap();
        conn
    }

    fn insert_image(conn: &DbConn, id: &str) {
        conn.execute(
            "INSERT INTO images (id, path, filename, file_size, mtime, imported_at)
             VALUES (?1, ?2, ?3, 1, 1, 1)",
            params![id, format!("/x/{id}.jpg"), format!("{id}.jpg")],
        )
        .unwrap();
    }

    fn migrate_extra(conn: &DbConn) {
        // Mirror the guarded ALTERs from init_pool for in-memory test DBs.
        for col in ["iptc_title", "iptc_caption", "iptc_copyright", "iptc_creator", "copy_of"] {
            crate::db::add_column_if_missing(conn, "images", col, "TEXT").unwrap();
        }
        crate::db::add_column_if_missing(conn, "images", "stack_id", "TEXT").unwrap();
        crate::db::add_column_if_missing(conn, "images", "stack_pos", "INTEGER NOT NULL DEFAULT 0")
            .unwrap();
        crate::db::add_column_if_missing(conn, "keywords", "parent_id", "INTEGER").unwrap();
        crate::db::add_column_if_missing(conn, "collections", "publish_dir", "TEXT").unwrap();
        crate::db::add_column_if_missing(conn, "collections", "publish_opts", "TEXT").unwrap();
    }

    #[test]
    fn hierarchical_keywords_chain_and_descend() {
        let conn = test_conn();
        migrate_extra(&conn);
        insert_image(&conn, "a");
        insert_image(&conn, "b");

        // "Travel > Norway" creates the chain and tags the leaf.
        let leaf = add_keyword(&conn, "a", "Travel > Norway").unwrap();
        assert_eq!(leaf.name, "Norway");
        assert!(leaf.parent_id.is_some());
        add_keyword(&conn, "b", "Travel").unwrap();

        let all = list_keywords(&conn).unwrap();
        let travel = all.iter().find(|k| k.name == "Travel").unwrap();
        assert_eq!(travel.parent_id, None);

        // Filtering the parent includes images tagged with descendants.
        let mut members = keyword_members(&conn, travel.id).unwrap();
        members.sort();
        assert_eq!(members, vec!["a".to_string(), "b".to_string()]);
        // The leaf only matches its own images.
        assert_eq!(keyword_members(&conn, leaf.id).unwrap(), vec!["a".to_string()]);

        // GC keeps a childless-but-parented node alive only while needed:
        // untagging "Norway" removes it (no children), but "Travel" survives
        // its untag because... it must NOT be deleted while Norway exists.
        remove_keyword(&conn, "b", travel.id).unwrap();
        assert!(
            list_keywords(&conn).unwrap().iter().any(|k| k.name == "Travel"),
            "parent with children must survive GC"
        );
    }

    #[test]
    fn folder_removal_forgets_subtree_only() {
        let conn = test_conn();
        migrate_extra(&conn);
        // insert_image puts files at /x/<id>.jpg — add a nested one manually.
        insert_image(&conn, "a");
        insert_image(&conn, "b");
        conn.execute(
            "INSERT INTO images (id, path, filename, file_size, mtime, imported_at)
             VALUES ('c', '/x/sub/c.jpg', 'c.jpg', 1, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, filename, file_size, mtime, imported_at)
             VALUES ('d', '/y/d.jpg', 'd.jpg', 1, 1, 1)",
            [],
        )
        .unwrap();

        // Removing /x forgets a, b AND the nested c — but not /y's d.
        let removed = remove_folder_from_catalog(&conn, "/x").unwrap();
        assert_eq!(removed.len(), 3, "removed {removed:?}");
        let left = list_images(&conn).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "d");

        // Prefix safety: a sibling folder sharing the name prefix survives.
        conn.execute(
            "INSERT INTO images (id, path, filename, file_size, mtime, imported_at)
             VALUES ('e', '/xtra/e.jpg', 'e.jpg', 1, 1, 1)",
            [],
        )
        .unwrap();
        remove_folder_from_catalog(&conn, "/x").unwrap();
        assert!(list_images(&conn).unwrap().iter().any(|i| i.id == "e"));
    }

    #[test]
    fn stacking_groups_merges_and_promotes() {
        let conn = test_conn();
        migrate_extra(&conn);
        for id in ["a", "b", "c", "d"] {
            insert_image(&conn, id);
        }

        // Stack a+b: a is top.
        let sid = stack_images(&conn, &["a".into(), "b".into()]).unwrap();
        let by_id = |conn: &DbConn| {
            let imgs = list_images(conn).unwrap();
            imgs.into_iter().map(|m| (m.id.clone(), m)).collect::<std::collections::HashMap<_, _>>()
        };
        let m = by_id(&conn);
        assert_eq!(m["a"].stack_id.as_deref(), Some(sid.as_str()));
        assert_eq!((m["a"].stack_pos, m["b"].stack_pos), (0, 1));
        assert!(m["c"].stack_id.is_none());

        // Stacking c with b absorbs the whole a+b stack into the new one.
        let sid2 = stack_images(&conn, &["c".into(), "b".into()]).unwrap();
        let m = by_id(&conn);
        assert_eq!(m["a"].stack_id.as_deref(), Some(sid2.as_str()), "absorbed");
        assert_eq!((m["c"].stack_pos, m["b"].stack_pos, m["a"].stack_pos), (0, 1, 2));

        // Promote a to top; relative order of the rest holds.
        set_stack_top(&conn, "a").unwrap();
        let m = by_id(&conn);
        assert_eq!((m["a"].stack_pos, m["c"].stack_pos, m["b"].stack_pos), (0, 1, 2));

        // Unstack dissolves.
        unstack(&conn, &sid2).unwrap();
        let m = by_id(&conn);
        assert!(m["a"].stack_id.is_none() && m["b"].stack_id.is_none());
    }

    #[test]
    fn virtual_copy_duplicates_edits_independently() {
        let conn = test_conn();
        migrate_extra(&conn);
        insert_image(&conn, "abc123");

        let mut p = EditParams::default();
        p.exposure = 0.7;
        save_edit_params(&conn, "abc123", &p, "edit").unwrap();

        let vc = create_virtual_copy(&conn, "abc123").unwrap();
        assert_eq!(vc, "abc123-v1");

        // Copy inherits the source's current settings…
        let copied = get_edit_params(&conn, &vc).unwrap();
        assert_eq!(copied.exposure, 0.7);
        // …but edits diverge independently.
        p.exposure = -1.0;
        save_edit_params(&conn, &vc, &p, "diverge").unwrap();
        assert_eq!(get_edit_params(&conn, "abc123").unwrap().exposure, 0.7);
        assert_eq!(get_edit_params(&conn, &vc).unwrap().exposure, -1.0);

        // Second copy numbers up; removal cascades.
        assert_eq!(create_virtual_copy(&conn, "abc123").unwrap(), "abc123-v2");
        remove_from_catalog(&conn, &vc).unwrap();
        let listed = list_images(&conn).unwrap();
        assert_eq!(listed.len(), 2, "original + v2 remain");
    }

    #[test]
    fn collections_roundtrip() {
        let conn = test_conn();
        migrate_extra(&conn);
        insert_image(&conn, "a");
        insert_image(&conn, "b");

        let c = create_collection(&conn, "Trip").unwrap();
        // Creating again with the same name returns the same collection.
        assert_eq!(create_collection(&conn, "Trip").unwrap().id, c.id);

        add_to_collection(&conn, c.id, &["a".into(), "b".into(), "a".into()]).unwrap();
        let listed = list_collections(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].count, 2, "duplicate adds must not double-count");

        remove_from_collection(&conn, c.id, &["a".into()]).unwrap();
        assert_eq!(collection_members(&conn, c.id).unwrap(), vec!["b".to_string()]);

        delete_collection(&conn, c.id).unwrap();
        assert!(list_collections(&conn).unwrap().is_empty());
    }

    #[test]
    fn keywords_roundtrip_and_gc() {
        let conn = test_conn();
        migrate_extra(&conn);
        insert_image(&conn, "a");
        insert_image(&conn, "b");

        let k = add_keyword(&conn, "a", "sunset").unwrap();
        add_keyword(&conn, "b", "sunset").unwrap();
        add_keyword(&conn, "a", "beach").unwrap();

        let all = list_keywords(&conn).unwrap();
        assert_eq!(all.len(), 2);
        let sunset = all.iter().find(|x| x.name == "sunset").unwrap();
        assert_eq!(sunset.count, 2);

        assert_eq!(image_keywords(&conn, "a").unwrap().len(), 2);
        assert_eq!(keyword_members(&conn, k.id).unwrap().len(), 2);

        // Removing the last link garbage-collects the keyword itself.
        remove_keyword(&conn, "a", k.id).unwrap();
        remove_keyword(&conn, "b", k.id).unwrap();
        assert!(list_keywords(&conn).unwrap().iter().all(|x| x.name != "sunset"));
    }

    #[test]
    fn preset_roundtrip_and_overwrite() {
        let conn = test_conn();

        let mut p = EditParams::default();
        p.exposure = 0.5;
        let saved = save_preset(&conn, "Punchy", &p).unwrap();
        assert_eq!(saved.name, "Punchy");
        assert_eq!(saved.params.exposure, 0.5);

        // Same name overwrites instead of duplicating.
        p.exposure = 1.0;
        save_preset(&conn, "Punchy", &p).unwrap();
        let all = list_presets(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].params.exposure, 1.0);

        delete_preset(&conn, all[0].id).unwrap();
        assert!(list_presets(&conn).unwrap().is_empty());
    }

    #[test]
    fn snapshot_roundtrip_keeps_geometry() {
        let conn = test_conn();
        // Snapshots reference an image row (FK).
        conn.execute(
            "INSERT INTO images (id, path, filename, file_size, mtime, imported_at)
             VALUES ('img1', '/x/a.jpg', 'a.jpg', 1, 1, 1)",
            [],
        )
        .unwrap();

        let mut p = EditParams::default();
        p.crop_w = 0.5;
        p.angle = 3.0;
        save_snapshot(&conn, "img1", "Before client tweaks", &p).unwrap();

        let snaps = list_snapshots(&conn, "img1").unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].params.crop_w, 0.5);
        assert_eq!(snaps[0].params.angle, 3.0);

        delete_snapshot(&conn, snaps[0].id).unwrap();
        assert!(list_snapshots(&conn, "img1").unwrap().is_empty());
    }
}

/// Set a star rating (0..5) or pick/reject flag (-1/0/1).
pub fn set_cull(conn: &DbConn, image_id: &str, rating: Option<i32>, flag: Option<i32>) -> Result<()> {
    if let Some(r) = rating {
        conn.execute(
            "UPDATE images SET rating = ?1 WHERE id = ?2",
            params![r, image_id],
        )?;
    }
    if let Some(f) = flag {
        conn.execute("UPDATE images SET flag = ?1 WHERE id = ?2", params![f, image_id])?;
    }
    Ok(())
}
