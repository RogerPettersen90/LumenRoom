// Builders for the custom `lumen://` scheme. These URLs go straight into
// <img src> — the webview fetches and decodes them natively, so no image
// bytes ever cross the JSON IPC bridge.

export function thumbUrl(imageId: string): string {
  return `lumen://thumb/${imageId}`;
}

/**
 * Develop preview proxy — a ~2048px upright JPEG of the *unedited* original,
 * generated and cached on first request by the backend. Edits are applied live
 * on top of it by the WebGL pipeline, so this URL is stable per image.
 */
export function previewUrl(imageId: string): string {
  return `lumen://preview/${imageId}`;
}

// The active RAW decode mode — part of the 1:1 URL so the webview's
// immutable HTTP cache can't serve a stale bake after the pref changes.
let rawDecodeMode = "embedded";
export function setRawDecodeMode(mode: string): void {
  rawDecodeMode = mode;
}

/** 1:1 full-resolution preview (lazily generated; used past 100% zoom). */
export function fullUrl(imageId: string): string {
  return `lumen://full/${imageId}?m=${rawDecodeMode}`;
}

/** Raster mask weight map (grayscale PNG, frame space). */
export function maskUrl(rasterId: string): string {
  return `lumen://mask/${rasterId}`;
}
