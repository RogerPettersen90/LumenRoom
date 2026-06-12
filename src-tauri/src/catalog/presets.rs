use crate::db::models::{EditParams, Preset, Snapshot};
use crate::db::{queries, AppState};
use crate::error::Result;

/// Save (or overwrite by name) a develop preset. The frontend strips geometry
/// before calling — a "look" should never crop the photo it's applied to.
#[tauri::command]
pub fn save_preset(
    name: String,
    params: EditParams,
    state: tauri::State<'_, AppState>,
) -> Result<Preset> {
    let conn = state.conn()?;
    queries::save_preset(&conn, name.trim(), &params)
}

#[tauri::command]
pub fn list_presets(state: tauri::State<'_, AppState>) -> Result<Vec<Preset>> {
    let conn = state.conn()?;
    queries::list_presets(&conn)
}

#[tauri::command]
pub fn delete_preset(id: i64, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::delete_preset(&conn, id)
}

/// Capture the full current state (including geometry) as a named snapshot.
#[tauri::command]
pub fn save_snapshot(
    image_id: String,
    name: String,
    params: EditParams,
    state: tauri::State<'_, AppState>,
) -> Result<Snapshot> {
    let conn = state.conn()?;
    queries::save_snapshot(&conn, &image_id, name.trim(), &params)
}

#[tauri::command]
pub fn list_snapshots(
    image_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Snapshot>> {
    let conn = state.conn()?;
    queries::list_snapshots(&conn, &image_id)
}

#[tauri::command]
pub fn delete_snapshot(id: i64, state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = state.conn()?;
    queries::delete_snapshot(&conn, id)
}
