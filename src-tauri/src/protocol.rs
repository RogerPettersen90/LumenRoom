use crate::db::{queries, AppState};
use crate::imaging::thumbnail;
use std::path::Path;
use tauri::http::{Request, Response};
use tauri::{Manager, UriSchemeContext};

/// Handler for the custom `lumen://` scheme — the binary side-channel that
/// keeps image bytes off the JSON IPC bridge. The webview requests these URLs
/// from `<img>` tags and decodes/caches them natively.
///
///   lumen://thumb/<id>     -> cached 512px Library thumbnail
///   lumen://preview/<id>   -> cached 2048px Develop proxy (lazily generated)
pub fn handle<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let state = ctx.app_handle().state::<AppState>();

    let uri = req.uri();
    let kind = uri.host().unwrap_or("");
    let id = uri.path().trim_start_matches('/');

    // ids are hex blake3 hashes (virtual copies append "-vN") — reject
    // anything else (path-traversal guard).
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return not_found();
    }

    match kind {
        "thumb" => serve_thumb(state.inner(), id),
        "preview" => serve_preview(state.inner(), id),
        "full" => serve_full(state.inner(), id),
        "mask" => serve_mask(state.inner(), id),
        _ => not_found(),
    }
}

/// Raster mask weight map (grayscale PNG) for the shader preview.
fn serve_mask(state: &AppState, id: &str) -> Response<Vec<u8>> {
    match std::fs::read(state.cache_dir.join("masks").join(format!("{id}.png"))) {
        Ok(bytes) => Response::builder()
            .header("Content-Type", "image/png")
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}

/// 1:1 preview: the full-resolution upright JPEG, generated + cached on first
/// request. Used by the Loupe when zooming past 100% so sharpness checks see
/// true pixels.
fn serve_full(state: &AppState, id: &str) -> Response<Vec<u8>> {
    // The cache name encodes the decode mode: switching the "RAW decode
    // quality" pref must take effect immediately, not serve stale bakes
    // (embedded-res 1:1s looked "low resolution" after enabling demosaic).
    let raw_full = state.prefs.lock().expect("prefs poisoned").raw_decode == "full";
    let file = if raw_full {
        state.cache_dir.join(format!("{id}_fullraw.jpg"))
    } else {
        state.cache_dir.join(format!("{id}_full.jpg"))
    };
    if let Ok(bytes) = std::fs::read(&file) {
        return jpeg(bytes);
    }
    let generate = || -> crate::error::Result<Vec<u8>> {
        let conn = state.conn()?;
        let (path, orientation) = queries::get_export_source(&conn, id)?;
        drop(conn);
        let p = Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

        let bytes = if raw_full && crate::imaging::is_raw(&ext) {
            // True 1:1: full demosaic, oriented, encoded without resize.
            let img = crate::imaging::raw::decode_raw_best(p, true)?;
            let upright = crate::imaging::apply_orientation(img, orientation);
            let rgb = upright.to_rgb8();
            let mut out = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
                .encode_image(&rgb)?;
            out
        } else {
            thumbnail::bake(p, orientation, u32::MAX, 90)?
        };
        let _ = std::fs::write(&file, &bytes);
        Ok(bytes)
    };
    match generate() {
        Ok(bytes) => jpeg(bytes),
        Err(_) => not_found(),
    }
}

fn serve_thumb(state: &AppState, id: &str) -> Response<Vec<u8>> {
    let file = state.cache_dir.join(format!("{id}.jpg"));
    if let Ok(bytes) = std::fs::read(&file) {
        return jpeg(bytes);
    }
    // Lazily rebake — "Clear preview cache" must not leave the grid blank.
    let generate = || -> crate::error::Result<Vec<u8>> {
        let conn = state.conn()?;
        let (path, orientation) = queries::get_export_source(&conn, id)?;
        drop(conn);
        let bytes = thumbnail::bake(
            Path::new(&path),
            orientation,
            thumbnail::THUMB_LONG_EDGE,
            80,
        )?;
        let _ = std::fs::write(&file, &bytes);
        Ok(bytes)
    };
    match generate() {
        Ok(bytes) => jpeg(bytes),
        Err(_) => not_found(),
    }
}

/// Serve the Develop proxy, generating + caching it on first request. Lazy
/// generation keeps import fast (no large proxy baked unless an image is
/// actually opened in Develop).
fn serve_preview(state: &AppState, id: &str) -> Response<Vec<u8>> {
    let file = state.cache_dir.join(format!("{id}_preview.jpg"));
    if let Ok(bytes) = std::fs::read(&file) {
        return jpeg(bytes);
    }

    match generate_preview(state, id, &file) {
        Ok(bytes) => jpeg(bytes),
        Err(_) => not_found(),
    }
}

fn generate_preview(state: &AppState, id: &str, dest: &Path) -> crate::error::Result<Vec<u8>> {
    let conn = state.conn()?;
    let (path, orientation) = queries::get_export_source(&conn, id)?;
    drop(conn);

    let bytes = thumbnail::bake(
        Path::new(&path),
        orientation,
        thumbnail::PREVIEW_LONG_EDGE,
        88,
    )?;
    let _ = std::fs::write(dest, &bytes); // cache miss is non-fatal
    Ok(bytes)
}

fn jpeg(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Content-Type", "image/jpeg")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .body(Vec::new())
        .expect("static 404 response")
}
