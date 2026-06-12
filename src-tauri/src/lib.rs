mod catalog;
mod cli;
mod db;
mod error;
mod imaging;
mod prefs;
mod protocol;

use db::AppState;
use directories::ProjectDirs;
use tauri::Manager;

/// Build and run the LumenRoom Tauri application.
pub fn run() {
    // Headless CLI subcommands (import/export) run and exit before any
    // window or webview is touched — usable over SSH and in cron jobs.
    if cli::try_run_cli() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Resolve XDG data/cache dirs and prepare the catalog + thumb cache.
            let dirs = ProjectDirs::from("org", "LumenRoom", "LumenRoom")
                .ok_or("could not resolve a home directory")?;

            // Preferences may point at a custom catalog directory.
            let loaded_prefs = prefs::load_prefs();
            let data_dir = loaded_prefs
                .catalog_dir
                .as_ref()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| dirs.data_dir().to_path_buf());
            let cache_dir = dirs.cache_dir().join("thumbnails");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&cache_dir)?;

            // Rolling backup BEFORE the catalog opens (file guaranteed closed).
            let db_path = data_dir.join("catalog.sqlite");
            prefs::backup_catalog(&db_path, loaded_prefs.catalog_backups);

            let pool = db::init_pool(&db_path)?;
            app.manage(AppState {
                db: pool,
                cache_dir,
                xmp_gen: std::sync::Arc::new(std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
                prefs: std::sync::Mutex::new(loaded_prefs),
            });
            app.manage(catalog::autoimport::AutoImportState::default());
            catalog::autoimport::restart(app.handle());
            Ok(())
        })
        // Pixel side-channel: <img src="lumen://thumb/<id>"> served from cache.
        .register_uri_scheme_protocol("lumen", |ctx, req| protocol::handle(ctx, req))
        .invoke_handler(tauri::generate_handler![
            catalog::scan::scan_directory,
            catalog::export::export_image,
            catalog::export::export_image_with,
            catalog::sidecar::export_sidecar,
            catalog::list_images,
            catalog::get_edit_params,
            catalog::save_edit_params,
            catalog::get_history,
            catalog::set_cull,
            catalog::set_label,
            catalog::get_iptc,
            catalog::set_iptc,
            catalog::prefetch_previews,
            catalog::create_virtual_copy,
            catalog::remove_from_catalog,
            catalog::presets::save_preset,
            catalog::presets::list_presets,
            catalog::presets::delete_preset,
            catalog::presets::save_snapshot,
            catalog::presets::list_snapshots,
            catalog::presets::delete_snapshot,
            catalog::sidecar::import_sidecar,
            catalog::organize::create_collection,
            catalog::organize::list_collections,
            catalog::organize::delete_collection,
            catalog::organize::add_to_collection,
            catalog::organize::remove_from_collection,
            catalog::organize::collection_members,
            catalog::organize::add_keyword,
            catalog::organize::remove_keyword,
            catalog::organize::image_keywords,
            catalog::organize::list_keywords,
            catalog::organize::keyword_members,
            catalog::organize::set_publish_config,
            catalog::organize::publish_collection,
            catalog::organize::stack_images,
            catalog::organize::unstack,
            catalog::organize::set_stack_top,
            catalog::organize::save_smart_collection,
            catalog::organize::list_smart_collections,
            catalog::organize::delete_smart_collection,
            catalog::reveal_file,
            catalog::generate_luminosity_mask,
            catalog::generate_subject_mask,
            catalog::save_mask_raster,
            catalog::lookup_lens_profile,
            catalog::remove_folder_from_catalog,
            catalog::rename_folder,
            catalog::move_folder,
            prefs::get_prefs,
            prefs::set_prefs,
            prefs::catalog_info,
            prefs::optimize_catalog,
            prefs::clear_thumbnail_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumenRoom");
}
