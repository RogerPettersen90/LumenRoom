# LumenRoom

A fast, **Linux-first**, non-destructive RAW photo editor and catalog —
free and open source. Built with **Tauri v2 + React + TypeScript** on a
**Rust** imaging backend.

**Status: beta.** Daily-drivable, under active development. Expect rough
edges; your originals are never touched, so experimenting is safe.

## Philosophy

- **Performance first.** Decoding, metadata, and pixel work happen in Rust.
  Image bytes never cross the JSON IPC bridge — they are served over a custom
  `lumen://` URI scheme the webview decodes natively. Every develop
  adjustment renders live on the GPU.
- **Non-destructive.** Originals are read-only, always. Edits live in a local
  SQLite catalog and in portable `.xmp` sidecars readable by other editors.
- **Private by design.** No account, no cloud, no telemetry. The AI features
  run entirely on your machine (a small model is downloaded once, then
  everything is offline).
- **Linux-native.** XDG directories, AppImage/deb/rpm, a real headless CLI.

## Features

**Library / culling** — classic five-zone layout with collapsible panels and
a persistent filmstrip. Grid / Loupe / Compare / Survey views; flags, star
ratings, color labels; Caps-Lock auto-advance; folders, collections, smart
collections, hierarchical keywords, stacks, painter tool; text and metadata
filters; live histogram and Quick Develop.

**Develop** — every imaging operation exists twice, in the WebGL preview
shader and the Rust export pipeline, kept in lockstep so exports match the
preview:

- White balance, exposure, hue-preserving tone regions, contrast, clarity,
  texture, dehaze, vibrance/saturation
- Tone curves (parametric, point, per-RGB-channel), HSL color mixer,
  3-way color grading, B&W, camera profiles, calibration
- Crop & straighten with aspect presets, perspective correction
- **Lens corrections**: profiles for 950+ lenses from the lensfun database
  (distortion + chromatic aberration, matched from EXIF and interpolated to
  your focal length), plus manual sliders and per-lens defaults
- **Masking**: linear/radial gradients, unlimited-stroke brush with eraser
  and feather, per-pixel luminance/color range masks, and **AI Select
  Subject** (local U²-Net segmentation with edge-aware refinement)
- Heal & clone with feathering; sharpening, noise reduction, vignette, grain
- Virtual copies, snapshots, presets, full undo history, before/after

**Export** — JPEG/PNG/TIFF/original with sRGB or wide-gamut print output
(ICC embedded), resize modes, file-size cap, output sharpening, watermarking,
naming tokens, export presets, and publish-to-folder (auto-sync a collection
to a directory).

**Automation** — watched-folder auto-import, rolling catalog backups, and a
headless CLI:

```bash
lumenroom import ~/Photos/shoot-2026
lumenroom export --picks --dest /tmp/out --preset web
```

## Building

```bash
npm install
npm run tauri dev     # development app (needs a graphical session)
npm run tauri build   # release: AppImage/.deb/.rpm in src-tauri/target/release/bundle/

npm run build                      # frontend type-check + bundle
cd src-tauri && cargo test --lib   # backend test suite
```

Requires Node 20+, Rust 1.80+, and webkit2gtk-4.1 dev packages.

## Architecture at a glance

| Path | Mechanism | Carries |
|------|-----------|---------|
| Control | `invoke()` → `#[tauri::command]` | scans, edits, culling, organize |
| Pixels | `lumen://` URI scheme | thumbnails, develop proxies, 1:1 previews, mask maps |
| Events | `Channel<ScanEvent>` + app events | live import progress, auto-import |

The develop pipeline exists twice by design — a WebGL fragment shader for the
live preview and `src-tauri/src/imaging/pipeline.rs` for full-res export —
with operations and constants kept in lockstep (each is annotated with its
twin).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

LumenRoom bundles or downloads third-party components, including lens
calibration data from the [lensfun](https://lensfun.github.io/) project
(CC-BY-SA 3.0) and the DejaVu Sans font. See
[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for the complete list.
