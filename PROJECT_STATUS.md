# LumenRoom — Project Status & Resume Guide

_Last updated: 2026-06-11_

LumenRoom is an open-source, Linux-first, **non-destructive RAW photo editor** — a
lightweight alternative to the leading commercial editor. **Tauri v2 + React 18 + TypeScript** frontend,
**Rust** imaging backend. Codename "LumenRoom"; directory is `~/App_Projects/Lightcraft`
(name not finalized — all product/identifier strings say LumenRoom).

> ✅ All green: frontend build, backend `cargo test --lib` (48 passed).
> **v0.38 — HEADLESS CLI (Phase E, tested live)**: `lumenroom import` /
> `lumenroom export` run the real engines without a window — verified
> end-to-end on this box against the sample DNG.
> **v0.37 — DAM POLISH (v3 Phase D complete)**: stacking, folder rename/move,
> hierarchical keywords, painter tool, publish-to-folder, workflow-faithful survey ✕.
> **v0.36 — COLOR MANAGEMENT + PROFILES (B6+B7, Phase B complete)**: sRGB ICC
> in JPEG/PNG exports; camera Profile slot atop Basic in both pipelines.
> v0.35: full RAW demosaic (B5). v0.34: Phase A workflow automation.
> Remaining in v3: Phase C (ONNX AI masks/denoise — needs hands-on session),
> Phase E (tethering, headless CLI, keybind remap).

---

## How to build / run

```bash
npm install                 # once
npm run tauri dev           # dev app with HMR (needs a graphical session)
npm run tauri build         # release: .AppImage/.deb/.rpm in src-tauri/target/release/bundle/

npx tsc --noEmit            # frontend type-check
npm run build               # frontend production bundle (tsc + vite)
cd src-tauri && cargo check # backend compile check
cd src-tauri && cargo test --lib   # backend unit tests (5 pass + 1 ignored real-raw)
```

Toolchain on this machine is already installed: Node 22, Rust 1.95, tauri-cli 2.11,
webkit2gtk-4.1. **This box is headless** — everything is verified by compile/test, the
UI has never been run in a real window.

⚠️ **Git caveat:** the git repo is rooted at `/home/server`, NOT this project dir
(no `.git` in Lightcraft). **NEVER `git add -A`** from here — it would stage the whole
home directory. Nothing has been committed.

A real sample RAW lives at `sample_raw/sample.dng` (Sony A7 IV DNG, user-provided) —
used by the ignored integration test.

---

## Architecture (the load-bearing decisions)

- **Image bytes NEVER cross the JSON IPC bridge.** Three channels:
  - `invoke()` → `#[tauri::command]` for control (scan/edits/cull/history/export).
  - Custom **`lumen://` URI scheme** for pixels (`lumen://thumb/<id>`, `lumen://preview/<id>`)
    — webview fetches `<img src>` natively, gets free caching. Handler: `src-tauri/src/protocol.rs`.
  - `Channel<ScanEvent>` for live import progress.
- **Non-destructive:** originals read-only; edits live in SQLite (`edit_params` JSON +
  append-only `history`). Catalog is source of truth; XMP sidecars are an export artifact.
- **Develop pipeline is implemented TWICE and must stay in lockstep:**
  - GPU: `src/features/develop/gl/Renderer.ts` (WebGL fragment shader, live preview).
  - CPU: `src-tauri/src/imaging/pipeline.rs` (`apply_edits`, full-res export).
  - Same constants/order. **Change one → change the other**, or exports diverge from preview.
- **Thumbnails baked upright** (EXIF orientation applied in `imaging::apply_orientation`),
  cached at `<XDG cache>/LumenRoom/thumbnails/<id>.jpg`; 2048px develop proxy at
  `<id>_preview.jpg` (lazily generated on first `lumen://preview` request).
- **RAW handling — two-speed** (`imaging/raw.rs`): the default fast path scans the file
  for embedded JPEG streams and decodes the largest (~14MP preview, works for
  DNG/CR2/CR3/NEF/ARW/etc). Since v0.35, Settings → Performance → "RAW decode quality:
  Full" switches exports + 1:1 previews to a true rawler demosaic at native sensor
  resolution (`decode_raw_best(path, full)` with automatic fallback to the preview scan).
  Thumbs/2048px proxies always use the fast path.

---

## Feature status

### Backend (Rust, `src-tauri/src/`) — all compiling & tested
- `db/` — r2d2-pooled SQLite, `migrations/0001_init.sql` (images, edit_params, history),
  `models.rs` (ImageMeta, EditParams, HistoryStep), `queries.rs`.
- Commands: `scan_directory` (rayon parallel + Channel progress), `list_images`,
  `get_edit_params`, `save_edit_params`, `get_history`, `set_cull`, `export_image`,
  `export_sidecar`.
- `imaging/`: `thumbnail.rs` (bake at any size), `raw.rs` (embedded-preview extraction),
  `metadata.rs` (EXIF; date parser handles dash/colon/ISO-T), `pipeline.rs` (apply_edits),
  `mod.rs` (apply_orientation + ext lists).
- `protocol.rs`: thumb + lazy preview routes.
- `catalog/`: `scan.rs`, `export.rs`, `sidecar.rs` (XMP w/ crs: interop + lossless
  lumenroom:Params).
- Tests: raw ×2, pipeline ×2 (neutral passthrough, +1EV brightens), sidecar ×1,
  `real_raw_file_end_to_end` (ignored; run via `LUMEN_TEST_RAW=<path> cargo test --lib real_raw -- --ignored`).

### Frontend (React, `src/`)
- **Stores** (`store/`): `catalogStore` (images/byId/**visible**/filter/selectedId/**selection**),
  `developStore` (params + undo/redo + history), `uiStore` (mode, libraryView=grid|loupe|**survey**, scan).
- **Library module** (`features/library/`): ThumbGrid, LibraryView, LoupeView, **SurveyView (new)**,
  Filmstrip, FilterBar (flag/rating/sort), FoldersPanel (left panel, folders from paths).
- **Develop module** (`features/develop/`): ImageCanvas (WebGL, 2048 proxy, throttled
  histogram readback), gl/Renderer.ts, histogram/{Histogram,histogramBus}, panels/{BasicPanel,
  HistoryPanel}, ExportButton, SidecarButton, DevelopView.
- `hooks/useKeyboardShortcuts.ts`: G/E grid/loupe, D develop, ←/→ nav, P/X/U flags, 0–5 ratings.
- `App.tsx` topbar: Grid/Loupe sub-toggle (library) + Library/Develop module switcher.

### the commercial editor-parity scorecard
- Library: import, grid + loupe, **survey (IN PROGRESS)**, filmstrip, flags/ratings,
  filter bar, folders panel ✓
- Develop: GPU sliders (exposure/contrast/highlights/shadows/whites/blacks/temp/tint/
  saturation/vibrance/clarity), histogram, undo/redo, history panel ✓
- Output: full-res JPEG/PNG/TIFF export ✓, XMP sidecar export ✓

---

## v0.11 — Survey + multi-select (DONE)

- `catalogStore`: `selection[]` + `toggleSelect` (Ctrl/Cmd-click), `rangeSelect`
  (Shift-click), `setPrimary`, `cullMany` (selection-wide rating/flag).
- `ThumbGrid`: the commercial editor click semantics (plain/ctrl/shift), `co-selected` styling.
- `SurveyView` (N): candidates = multi-selection (2+) else visible set; click = active,
  hover-✕ = reject; auto grid layout.
- Shortcuts: N = survey; P/X/U/0–5 now apply to the whole selection.
- tsconfig bumped ES2020 → ES2022 (`Array.at`).

## v0.12 — The the commercial editor five-zone shell (Phase 1, DONE)

- **Shell** (`App.tsx`): topbar (brand + module picker right) · collapsible left/right
  panel groups · center work area · persistent filmstrip in every module.
  `Tab` toggles side panels, `Shift+Tab` also the filmstrip (uiStore.panelsOpen/filmstripOpen).
- **`PanelSection`** accordion primitive (`components/PanelSection.tsx`).
- **Library left**: Navigator (thumb preview) · Catalog (All Photographs / Previous
  Import — `lastImportIds`, session-only) · Folders as a **hierarchical tree**
  (common-root, single-child chains collapsed, subtree filtering) · Collections stub ·
  Import…/Export… footer.
- **Library right**: Histogram (CPU, from thumb via `histogram/plot.ts` shared module) ·
  Quick Develop (classic-style **relative** nudges applied to the whole selection +
  Reset All) · Keywording stub · Metadata (file + EXIF).
- **Center**: FilterBar (grid only; flags + min-rating + **label swatches**; sort moved
  out) · Toolbar (view modes ▦▢⊞, sort, thumbnail-size slider → grid `minmax`).
- **Grid cells**: the commercial editor anatomy — index number (top-right), color-label border tint,
  flag/rating badges.
- **Develop**: left = Presets/Snapshots stubs + History (moved from right) · right =
  Histogram + Basic regrouped (WB → Tone → Presence) + XMP/Export footer · center =
  canvas only.
- **Color labels end-to-end**: `images.color_label` exposed through `list_images`,
  new `set_label` command (validated), `ImageMeta.colorLabel`, `labelMany`, keys 6–9
  (toggle), label filter, tints in grid/filmstrip/loupe.
- **Catalog store**: `filter.source` union (all | folder-subtree | previousImport),
  label filter; import flush now replaces re-imported rows instead of duplicating.
- **Backend fix**: re-scan upserts now read back preserved rating/flag/label
  (`get_cull_state`) so streamed events don't show zeroed culls for known images.

## v0.13 — Culling completeness (Phase 2, DONE)

- **Compare view (C)** (`CompareView.tsx` + `enterCompare.ts`): pinned "Select" (left,
  `uiStore.compareSelectId`) vs "Candidate" (right = the catalog's active selection, so
  ←/→ steps it and P/X/U/0–9 cull it with zero special-casing). Swap, Make Select
  (promote + advance), Done. Entering with 2+ selected uses primary vs next selected.
  Toolbar gained the XY button (classic view order: grid, loupe, compare, survey).
- **Filmstrip header** (the classic strip): source breadcrumb ("All Photographs · 50 of 1469 ·
  filename / N selected") left; compact attribute mini-filter right (pick/reject flag
  toggles, min-rating stars, label swatches) — drives the SAME `catalogStore.filter`
  as the Library Filter bar, so everything stays consistent.
- **Caps Lock auto-advance**: after P/X/U/rating/label with Caps Lock on (and a single
  photo targeted), selection steps to the next photo — the classic rapid-culling flow.

## v0.14 — Crop & Straighten (Phase 3 begins, DONE)

- **EditParams** grew `cropX/cropY/cropW/cropH` (normalized, top-down, over the
  straightened frame) + `angle` (degrees, ±45). Manual `Default` (cropW/H = 1.0);
  `serde(default)` keeps old saved edits compatible. `geometry_is_identity()` helper
  both sides.
- **Straighten model**: rotate around center + auto-zoom so no empty corners —
  `straighten_scale()` (Rust) === `straightenScale()` (TS), formula documented in both.
- **Rust** (`pipeline.rs`): `apply_geometry()` — bilinear sampling, y-up convention
  matching GL, rayon over rows; runs before `apply_edits` in export. 3 new tests
  (identity noop, crop halves dims, scale sanity). XMP sidecar emits crs:HasCrop/
  CropLeft/Top/Right/Bottom/CropAngle when geometry non-identity.
- **WebGL** (`Renderer.ts`): geometry block ahead of the color pipeline (crop window →
  auto-zoom → rotate → sample; careful top-down↔GL-y-up conversion documented).
  Canvas resizes to the crop so displayed aspect is right. `render(p, {fullFrame})`
  ignores crop while the tool is open.
- **UI**: `CropPanel` (toggle ◻ Crop / Done / Reset + Angle slider) above Basic;
  `CropOverlay` — dim mask, rule-of-thirds grid, 8 resize handles + drag-to-move,
  normalized coords mapped via the canvas bounding box (ResizeObserver-tracked);
  `R` toggles the tool (develop mode); `developStore.cropMode` + `setMany`.

## v0.15 — Point Tone Curve (DONE)

- **EditParams** += `toneCurve: [x,y][]` (normalized, sorted; default identity
  [(0,0),(1,1)]); `curve_is_identity()` both sides.
- **Interpolation**: Fritsch–Carlson monotone cubic (no overshoot) — `curve_lut()` in
  `pipeline.rs` === `makeCurveEval()` in `src/features/develop/curve.ts` (keep matched).
- **Application point**: after contrast, before saturation — same spot in both
  pipelines. Rust: 256-entry f32 LUT, lerped sampling. WebGL: 256×1 RGB LUT texture on
  unit 1 (samplers now bound explicitly: image=0, curve=1), re-uploaded only when the
  curve changes (JSON key cache).
- **UI** (`ToneCurvePanel`): SVG editor below Basic — quarter grid + reference
  diagonal, click-to-add point, drag (endpoints vertical-only = black/white levels;
  interior points x-clamped between neighbours), double-click to remove, Reset;
  commits "Tone Curve" history step on pointer-up.
- 3 new backend tests: identity LUT is linear, midpoint lift + monotonicity,
  curve brightens through apply_edits. `NumericEditKey` type added since EditParams
  now has a non-numeric field (sliders/quick-develop constrain to it).

## v0.16 — HSL / Color Mixer (DONE)

- **EditParams** += `hslHue/hslSat/hslLum: [f32;8]` (-100..100), bands Red, Orange,
  Yellow, Green, Aqua, Blue, Purple, Magenta (centers 0/30/60/120/180/240/280/320° —
  `HSL_CENTERS` matched in pipeline.rs and `src/features/develop/hsl.ts`).
- **Model**: per-pixel rgb→HSV; adjacent band adjustments blended linearly by hue
  (wrapping); slider mapping hue ±100→±30°, sat ±100→×0..2, lum ±100→×0.5..1.5;
  application weighted by `smoothstep(0, 0.15, pixelSat)` so neutrals never shift.
  Applied after vibrance / before clarity in BOTH pipelines.
- **Rust**: `hsl_lut()` bakes a 360-entry (shift, satMul, lumMul) hue LUT; rgb2hsv/
  hsv2rgb helpers. **WebGL**: same LUT encoded into a 360×1 RGB texture on unit 2
  (R=shift, G=satMul/2, B=lumMul−0.5), `u_hslOn` gate avoids identity quantization;
  `uploadLut()` generalized (curve unit 1 + hsl unit 2), JSON-key re-upload caching;
  identity LUTs uploaded at construction so no texture is ever incomplete.
- **UI** (`HslPanel`, "Color Mixer", collapsed by default): Hue/Saturation/Luminance
  tabs × 8 band sliders with color chips, per-slider history labels, Reset All.
- 2 new behavior tests: red-band desaturation greys a red pixel while leaving blue
  untouched; +100 red hue pushes red toward orange. 13 backend tests total.

## v0.17 — Presets & Snapshots (DONE)

- **Migration `0002_presets.sql`**: `presets` (global, UNIQUE name) + `snapshots`
  (per-image, FK CASCADE); both run idempotently at startup after 0001.
- **Semantics**: presets are "looks" — geometry is stripped on save
  (`stripGeometry`) and the target photo's own crop/angle preserved on apply
  (`mergePreset`). Snapshots capture the FULL state incl. geometry.
- **Backend** (`catalog/presets.rs`): save_preset (upsert by name) / list / delete +
  save_snapshot / list / delete. First in-memory DB tests (`db::queries::tests`):
  preset roundtrip + name-overwrite, snapshot roundtrip keeping geometry. 15 total.
- **UI**: `PresetsPanel` (click to apply → "Preset: <name>" history step, inline
  name input + Save, hover-✕ delete) and `SnapshotsPanel` (+ Snapshot with timestamp
  name, click to restore → undoable commit, hover-✕ delete) replace the Develop
  left-rail stubs. Restores/applies go through the normal commit flow, so History
  keeps recording.

## v0.18–v0.20 — Color Grading, Effects, B&W, Copy/Paste, Before/After, XMP import, Text search (DONE)

- **Color Grading** (3-way split toning): EditParams += 10 flat numeric fields
  (per-zone hue 0..360 / sat 0..100 / lum -100..100 + balance). Zone weights from
  current luma with balance-shifted pivot (`0.5 + 0.25·β`, clamped .05–.95); additive
  tint casts (0.3) + zone luminance (0.25) — constants matched shader↔pipeline.rs,
  applied after HSL / before clarity. `ColorGradingPanel` w/ per-zone tint chips.
  Test: warm highlights tint bright pixels, leave shadows neutral.
- **Effects**: vignette (amount/midpoint, elliptical falloff in output space) + grain
  (uv-hash noise, same formula both sides — visually matched, not bit-exact).
  `apply_effects()` is a separate coordinate-aware Rust pass after apply_edits
  (the per-pixel pass has no x/y); shader does it at the very end. `EffectsPanel`.
  Test: corners darken, center doesn't.
- **B&W treatment** (`blackWhite: bool`): collapse to luma before the color stages
  (sat/vibrance/HSL naturally no-op on grey; grading still applies = split-toned
  B&W). Color | B&W toggle atop Basic. Test: output is exactly grey.
- **Copy/Paste settings**: developStore clipboard (stripGeometry on copy, mergePreset
  on paste → commits "Paste Settings"); footer buttons + Ctrl+Shift+C/V (handled
  before the modifier-guard in the key hook).
- **Before/After (Y)**: renders NEUTRAL_EDIT but keeps the photo's geometry so
  framing doesn't jump; "Before" badge overlay.
- **XMP import** (round-trip closed): `parse_xmp_params` reads the lossless
  `lumenroom:Params` attribute back (XML-unescape, &amp; last);
  `read_sidecar_for(original)` finds `<basename>.xmp`; `import_sidecar` command
  (registered, no UI button yet); **scan auto-imports sidecars** for images with no
  existing edit_params (never clobbers catalog edits). Test: full roundtrip equality
  across every params field.
- **Text search**: `filter.text` matches filename/camera/lens (case-insensitive),
  search input in FilterBar; flows through `visible` like everything else.

## v0.21 — Sharpening (DONE)

- `sharpenAmount` (0..100). **Rust** `apply_detail()`: true unsharp mask over a 3×3
  box blur on final colors, runs between apply_edits and apply_effects in export.
  **Shader**: cross-kernel approximation on the *input* sample (documented
  divergence; export is reference quality). `DetailPanel` (NR planned).
  Test: edge overshoot both directions, flat regions untouched. 20 backend tests.

## v0.22 — Collections, Keywords, Batch Export (Phase 4 core, DONE)

- **Migration `0003_organize.sql`**: collections + collection_images, keywords +
  image_keywords (all FK CASCADE; keyword GC on last unlink).
- **Backend** (`catalog/organize.rs`): 11 commands — collection CRUD + add/remove
  members + member listing; keyword find-or-create/link (multi-image), unlink+GC,
  per-image list, global list w/ counts, members. 22 backend tests (2 new roundtrips
  incl. duplicate-add no-double-count and keyword GC).
- **Store**: `Source` += `{kind:'collection'}`; `filter.keyword`; membership sets
  (`collectionMembers`/`keywordMembers`) loaded async via `selectCollection` /
  `setKeywordFilter` / `refreshCollectionMembers`; `applyFilter` takes a MemberCtx;
  leaving a collection source drops its membership.
- **UI**: `CollectionsPanel` (browse/click, ⊕ add selection, ⊖ remove when active,
  ✕ delete, inline create) replaces the left stub; `KeywordsPanel` (chips on the
  active photo + add-to-selection input + Keyword List w/ counts and click-to-filter)
  replaces the right stub; keyword filter chip shown in FilterBar; filmstrip
  breadcrumb knows collection names.
- **Batch export**: Library footer Export… renders the whole selection full-res
  (`exportSelection`: folder picker, `<stem>_edited.jpg`, stem de-dupe, progress on
  the button).

## v0.23 — Packaging + polish (DONE)

- **Release bundles build clean**: AppImage (portable, 84 MB) + .deb + .rpm in
  `src-tauri/target/release/bundle/`. This also proves the full release link
  (LTO, strip), beyond `cargo check`.
- **Read XMP** button in the Develop footer (manual `import_sidecar`, reloads
  params + history after).
- **Metadata filters**: camera + lens dropdowns in the FilterBar (distinct values
  from the catalog; only shown when >1 exists).
- **Shortcuts overlay** (`?` to toggle, Esc closes): all keybindings, grouped.
- README rewritten to match the actual feature set.

## v0.24 — Noise Reduction + Masking (DONE)

- **NR** (`noiseLuminance`/`noiseColor`, 0..100): Rust `apply_noise_reduction` —
  5×5 **bilateral** on luma (range sigma 0.08, edge-preserving) + 5×5 chroma
  average, in a y/cb/cr opponent space (exact-inverse transform). Shader previews a
  4-tap cross approximation (gated, shares taps with sharpening). Export chain:
  edits → masks → NR → sharpen → effects. Test: noise flattens, hard edge survives.
- **Masking** (`masks: Mask[]`, max 4 rendered): linear + radial gradients in
  **straightened-frame coords** (glued through crops; frameUv reused from the
  shader's geometry block, computed from crop params in Rust). Per-mask local
  adjustments: exposure (EV, in linear light), contrast, saturation, temp/tint —
  `apply_local` matched in both pipelines, applied after clarity / before vignette.
  Masks live inside EditParams JSON, so XMP round-trip, presets (geometry-stripped
  — note: masks travel with presets currently), snapshots, and copy/paste all work
  unchanged. GLSL ES 1.0 uniform arrays (vec4×4 ×3) with constant-bound loop.
  `MaskingPanel`: add/select/delete + geometry & adjustment sliders (draggable
  on-canvas overlay deferred until hands-on testing). Tests: radial brightens
  center not corner; linear fades top→bottom exactly.

## v0.25 — The seven-feature UX batch (DONE)

1. **Focus-aware shortcuts**: `uiStore.focusContext` (library/develop/filmstrip, set
   on pointer-down per region); Ctrl+A selects all *visible* (preventDefault — no
   webview text-select), Ctrl+D deselects; active in Library or when the filmstrip
   has focus.
2. **Zoom system**: `zoomStore` + shared `ZoomPane` (Loupe + Develop canvas):
   Fit/Fill/100%/200%/arbitrary, wheel zoom anchored at cursor, click toggles
   Fit↔100% at point, drag pans, publishes viewport. **Navigator** upgraded:
   FIT/FILL/100%/200% header buttons, zoom slider + %, live viewport rectangle,
   click/drag-to-pan; now also in Develop's left rail. Develop canvas wrapped in
   ZoomPane (CSS transform; CropOverlay re-anchored to .canvas-area). Note: 100% =
   100% of the 2048px proxy, not native pixels (documented).
3. **Auto-XMP sync**: debounced writer in Rust — `AppState.xmp_gen` generation map +
   1.5s delayed thread per edit; only the latest generation writes, so slider
   commits coalesce. Hooked into save_edit_params AND set_cull (xmp:Rating), gated
   by the new `autoXmp` pref (default on).
4. **Crop double-click commits** (inside the rect) — no Done button required.
5. **Visual mask placement**: `MaskOverlay` on the canvas — +Linear/+Radial arms a
   draft, drag on the photo places it (linear start→end / radial center→radii);
   active mask shows draggable handles (endpoints / center+radius); Esc cancels a
   draft; activeMaskIndex moved into developStore (panel + overlay share).
6. **Context menus**: `ContextMenu` component (clamped, hover submenus) + builders
   in `features/library/menus.ts` — photo menu (Develop, flags, rating ▸, label ▸,
   Develop Settings ▸ copy/paste/write-XMP/read-XMP, Add to Collection ▸, Export,
   Show in File Manager), folder menu, develop-canvas menu. Right-clicking an
   unselected photo selects it (classic rule). Backend `reveal_file` (D-Bus
   FileManager1 → xdg-open fallback). Default webview menu suppressed app-wide.
7. **Preferences** (gear / Ctrl+,): prefs.rs persists JSON to XDG config —
   autoXmp, importRecursive (honored by importFolder), exportQuality, catalogDir
   (custom catalog location, applied on restart). Catalog section: photo count, DB
   size+path, **Optimize Catalog** (VACUUM+ANALYZE), **preview-cache size + Clear**.
   Prefs live in AppState for command-side gating.

## v0.26 — RGB channel tone curves (Tier 1 #1, DONE)

- EditParams += `toneCurveR/G/B` (identity defaults; `one_curve_is_identity` helper;
  master identity check covers all four).
- Composition: out_c = master(channel_c(x)) — `channel_curve_luts()` in pipeline.rs
  === `bakeCurveLuts()` in curve.ts. The 256×1 RGB LUT texture already carried
  independent channels, so the shader needed ZERO changes.
- ToneCurvePanel: RGB/R/G/B channel tabs (curve drawn in channel color); all
  editing logic operates on the active channel; channel-aware history labels.
- Tests: red-channel curve lifts only red; channel composes under master. 27 total.

## v0.27 — Tier 1 items 2–4 + Quick Collection (DONE)

- **Range masks**: Mask += rangeType (none/luminance/color), rangeLo/Hi/Soft (lum
  band w/ smoothstep edges) and rangeHue/Tol (circular hue distance, saturation-
  gated so neutrals never match). Weight = geometric × range, computed on the
  CURRENT pixel color — matched `range_weight()` (pipeline.rs) ↔ shader block
  (`u_maskRngA/B[4]`). Panel: Off/Lum/Color tabs + range sliders. Tests: lum band
  leaves dark half byte-identical; color range hits red, spares blue.
- **Export dialog** (`ExportDialog.tsx` + `export_image_with` command): destination
  picker, naming tokens {name}/{seq}/{date} (live preview, stem de-dupe), JPEG/
  PNG/TIFF, quality, downscale-only resize, **text watermark** (ab_glyph +
  embedded DejaVuSans, ~2.5% of long edge, 75% white, 5 anchors) — watermark
  render test. Honest note in dialog: exports embed no metadata (≡ full strip).
  Old quick-export path removed; context menu + Library footer open the dialog.
- **1:1 preview tier**: `lumen://full/<id>` (lazily cached `<id>_full.jpg`).
  Loupe swaps proxy→full past 100%, rescaling the numeric zoom by the dims ratio
  so the view doesn't jump ("1:1" badge shows). `previewBuild` pref
  (minimal/standard/full) drives eager baking at import (scan.rs). Develop canvas
  intentionally stays on the 2048 proxy (GPU cost; documented).
- **Quick Collection (B)**: reserved "Quick Collection" (find-or-create via the
  name-upsert), B toggles the selection in/out (primary-membership decides),
  appears in the Collections panel with live count.

## v0.28 — Tier 1 items 5b–8 (DONE)

- **Smart Collections** (migration 0004): rules JSON (minRating/flag/label/camera/
  lens/textContains) stored backend, evaluated LIVE in applyFilter (Source kind
  "smart" carries rules inline) — membership updates the instant you cull. Panel
  with compact rule builder + live counts + ⚙ rows.
- **Editable IPTC** (guarded ALTER ADD COLUMN migration 0005 via
  `add_column_if_missing`): title/caption/copyright/creator editable in the
  Metadata panel (blur/Enter saves), written to the sidecar as Dublin Core
  attributes (dc:title/description/rights/creator), auto-XMP synced.
- **Dehaze**: veil subtract + levels restretch + slope steepening (0.25) + sat
  lift (0.12), after contrast / before curves, matched both pipelines; slider in
  Basic→Presence. Test: hazy pair stretches >90 levels, shadows deepen.
- **Sharpening Masking** (the classic Masking slider): unsharp weighted by
  smoothstep-edge magnitude — flat dither stays quiet at masking=100 while hard
  edges still overshoot (test). Cross-kernel twin in the shader.
- **Import dialog**: source picker · Add/Copy/Move segmented (Move carries an
  explicit ⚠ warning) · destination picker · subfolders toggle (pref-seeded).
  Copy/Move preserve relative structure, **carry .xmp sidecars along**, fall back
  rename→copy+delete across filesystems, report per-file failures, and index the
  NEW locations. `scan_directory` gained mode/dest params.

## ☀️ Overnight run (v0.29) — six Tier 2 features shipped

1. **Histogram clipping indicators**: corner triangles light up when >0.1% of
   samples sit on the rails; click (or **J**) toggles the on-image overlay —
   blown highlights painted red, crushed shadows blue (display-only shader
   stage, never exported).
2. **Parametric tone curve**: Highlights/Lights/Darks/Shadows region sliders
   (±100 → ±0.12 at fixed anchors), composed UNDER the point curves:
   out = master(channel(parametric(x))) — `parametric_points` matched Rust↔TS.
   Region section appears on the RGB tab of the Tone Curve panel. Test: shadows
   lift darks, highlights stay put.
3. **Calibration panel**: per-primary hue (±45°) + saturation remap as a 3×3
   matrix (columns = luma-normalized transformed primaries), applied in LINEAR
   light before WB — `calibration_matrix` (Rust) === `calibrationMatrix`
   (calibration.ts), shader takes the 3 columns as uniforms. Test: blue-primary
   shift leaves pure red byte-exact, blue gains green (teal).
4. **Virtual copies**: `images.copy_of` column; VC id = `{base}-vN`; copies the
   row + CURRENT edit_params (classic rule) + the cached previews; independent edits
   verified by test; `remove_from_catalog` (cascades; disk untouched); ⧉ badge
   in the grid; context menu gained Create Virtual Copy / Remove from Catalog.
   **Schema fix this required**: `images.path` was UNIQUE — guarded one-time
   table REBUILD migration (`drop_path_unique_if_present`, FKs off during, ids
   preserved) + relaxed 0001 for fresh catalogs. Also hardened `list_images`
   against NULL `format`. Protocol id guard now allows `-`.
5. **CA correction** (Lens Corrections panel): lateral chromatic aberration —
   R/B channels resampled radially about the lens axis (±0.5%), implemented at
   the geometry/sampling stage in BOTH pipelines. Test: green/blue
   byte-identical, red resamples. (lensfun profile corrections still planned.)
6. **Texture**: mid-frequency band (3×3 − 5×5 neighbourhood means) enhancement/
   smoothing in the detail pass; shader previews a single-band approximation.
   Slider joined Basic→Presence (Texture · Clarity · Dehaze — full the commercial editor set).

**Verification**: 36 backend tests passing, frontend builds clean throughout,
installers repackaged at the end of the run.

## v0.51 — LENSFUN LENS PROFILES (user confirmed masking fixed; requested)

Real per-lens corrections from the lensfun database (CC-BY-SA, the data
darktable/RawTherapee use):
1. **Embedded DB**: the 34 interchangeable-lens XMLs (mil-*/slr-*, 3.5MB →
   951 lenses with distortion data) vendored at `src-tauri/lensfun/`,
   embedded via include_dir, parsed lazily (quick-xml) into a OnceLock index
   (`imaging/lensdb.rs`).
2. **Matching**: token-overlap scoring of the EXIF lens string (≥0.6
   required); equal scores prefer the lowest-crop-factor calibration.
   Distortion interpolated linearly between calibrated focal lengths;
   poly3 entries converted into ptlens form (a=0, b=k1, c=0).
3. **Pipelines**: EditParams += lens_a/b/c — ptlens cubic
   Rd = Ru·(a·Ru³+b·Ru²+c·Ru+d), d=1−a−b−c, r normalized to min(w,h)/2
   (PT/hugin convention) — applied in map_frame ≡ geoMap (u_lensABC)
   BEFORE the manual r² distortion (they compose). Test: barrel cubic
   remaps borders; zero = byte-identical.
4. **TCA**: profile vr/vb mapped onto the existing CA sliders
   ((v−1)/0.005·100).
5. **UI**: Lens Corrections → Profile: "Enable Profile Corrections" looks up
   via `lookup_lens_profile(lens, focal)` and writes the cubic + CA into the
   edit (one history step, XMP-portable); shows the matched name; Off
   clears. No-match → message + manual sliders.
Deferred: vignetting calibrations (need aperture/distance axes), fixed-lens
compact profiles, crop-factor cross-application scaling.

## v0.50 — SUBJECT MASK FRAME-SPACE FIX (user confirmed Lights/Darks fixed)

With the in-shader overlay proving frameUv correct (Lights/Darks align), the
remaining Subject offset had one candidate left: the weight map was generated
from the **embedded JPEG** while the 1:1 view shows the **full demosaic** —
DNG DefaultCropArea and the camera's JPEG framing routinely differ by a few
px on full-frame files (the crop-mode sample matched, which hid this from
every probe). Fix: `generate_subject_mask` now derives the map from the
**cached 1:1 preview file** (`<id>_full.jpg` — the exact displayed/exported
pixels), falling back to the embedded bake (which then matches the 2048
proxy). Also: Rust `raster_sample` switched to the GL texel-center
convention (uv·size − 0.5) so exports match the shader to the half-texel.
**Frame-space rule going forward**: anything sampled at frameUv must be
derived from the same decode path the renderer displays.

## v0.49 — IN-SHADER MASK OVERLAY (screenshot-diagnosed)

User screenshot showed the green tint riding slightly off the subject — and
the same "misplaced" feel for linear/radial. Root cause class: the tint was a
DOM <img> stretched over the canvas, positioned by browser-rect math — a
DIFFERENT code path from the shader applying the effect; any rounding between
them reads as misplacement, and it can never be fully exact at all zooms.
**Fix (the the commercial editor way): the mask overlay is now rendered inside the fragment
shader** — `u_maskView` selects the active mask slot; its post-range weight
(`viewW`, the exact value the adjustment uses) is painted green at frag end.
Tint and effect are the same number — they cannot disagree, for every mask
kind, at any zoom. DOM raster tint removed (.mask-raster-tint path returns
null); ImageCanvas passes maskView on all renders. Also: the backbuffer
clamp now preserves aspect (a one-axis clamp would squash the photo).

## v0.48 — BIGGER AI MODEL (user call)

Select Subject now runs **silueta** (43MB, rembg) instead of u2netp (4.6MB):
same U²-Net architecture, so the tract protobuf patch and inference path are
unchanged — just substantially better training. Verified live end-to-end on
this box: download → patch → inference 8.4s release first-call (plan cached
after; ~13× slower in debug builds). Model lands at `<cache>/models/
silueta.onnx`; users' next "+ Subject" triggers the one-time 43MB download.

## v0.47 — SEVENTH FEEDBACK ROUND (mask halos + subject targeting)

User: halos around Lights/Darks/Subject masks; Subject "not right at target".
1. **Alignment measured, not guessed**: new ignored probe
   `measure_mask_alignment_bias` — synthetic squares at known positions →
   mask centroid bias is **−0.3..−0.5px** (sub-pixel). The AI chain is
   aligned; the perceived mis-targeting was the soft halo edge.
2. **Lights/Darks rebuilt halo-free**: new mask kind **"global"** (weight 1
   everywhere, both pipelines: kind code 4 / `"global" => 1.0`) + the
   existing PER-PIXEL luminance range refinement (lo/hi/soft). No baked map
   → no upsampling halo, evaluated at full res on actual pixel values, and
   tunable live via the Range sliders. addLuminosity no longer calls the
   backend; labels derive from range values. Old raster luminosity masks
   still render (kind raster kept).
3. **Subject matte tightened**: weight map baked at 1536px (was 1024) and the
   refine snap is now a steep smoothstep(0.35..0.65) — kills the halo band
   the 320px model boundary leaves, while the bilateral pass keeps edges
   locked to the image.

## v0.46 — SIXTH FEEDBACK ROUND (space-pan, brush/gradient feather, AI refine)

1. **Spacebar hand tool** (pro-editor convention, researched per user ask):
   HOLD Space → overlays go pointer-transparent + drag pans through ANY
   active tool (grab cursor); quick TAP (<250ms, no drag) still toggles
   Fit ↔ 100% — resolved on keyup via zoomStore.spacePan/spacePanUsed.
2. **Brush size + feather**: Brush Feather slider (developStore.brushFeather)
   drives a two-band low-alpha halo in paintSegment; Size already existed.
3. **Linear gradient feather**: new feather semantics — transition band
   around the midpoint, span = 2·feather; 0.5 ≡ the historical whole-span
   look (backward compatible). Both pipelines + panel slider. Radial already
   had Radius X/Y + Feather.
4. **Select Subject accuracy**: edge-aware refinement — `refine_mask()` in
   ai.rs: joint bilateral filter of the 320px-upscaled saliency map guided
   by the photo's luma (r=6, σc=0.12 @1024px) + gentle contrast snap (1.5×).
   Mask edges lock onto real image edges. Test proves a 6px-offset soft edge
   snaps to the guide edge. Wired into generate_subject_mask.

## v0.45 — FIFTH FEEDBACK ROUND (overlay tracking + tool UX)

1. **Masks drifting on zoom (ALL masks) + brush painting beside the cursor**:
   one root cause — overlays track the canvas with ResizeObserver, but
   ZoomPane moves it with CSS transforms, which never fire RO. The stale box
   skewed both the drawn overlay AND pointer→frame mapping. Overlays now also
   subscribe to zoomStore (every pan/zoom republishes) — Mask + Spot fixed.
2. **Subject tint offset**: the weight map is FULL-frame but the canvas shows
   the crop window — tint now positions through the crop rect
   (left=-cropX/cropW…); brush paint canvas uses frame aspect, not crop.
3. **Layer names**: raster masks labeled by generator (Subject / Lights /
   Darks / Brush) via the raster id.
4. **Tool exit UX**: floating "✓ Done" pill bottom-center of the canvas
   whenever ANY tool is active (crop commits, spots apply, masks
   applyMaskSession); Esc still works.
5. **Pan while masking**: mask overlay is pointer-transparent except while
   placing/painting; geometry handles carry their own pointer-captured drag
   handlers (line/ellipse = move, circles = endpoints/radii). Click-drag pan
   + wheel zoom now work with masks showing.
6. **Masking panel widening**: tool buttons wrap (.panel-section .actions
   flex-wrap) instead of stretching the right rail.
7. **Develop Export**: the topbar button now opens the FULL Export dialog
   (same as Library); the old single-JPEG quick save is gone.

## v0.44 — FOURTH FEEDBACK ROUND (res/contrast confirmed fixed by user)

1. **Dropdowns finally**: select popups are NATIVE GTK menus — page CSS can't
   style them. `color-scheme: dark` on :root makes GTK render them dark.
2. **"Subject selector makes a radial brush"**: segmentation verified working
   on the real DNG (new ignored probe, 4.2% tight subject) — the bug was UI:
   MaskOverlay had no raster branch and fell through to radial handles. Now:
   raster masks render the weight map as a green selection tint
   (.mask-raster-tint, sepia→hue-rotate), no fake handles, pointer events
   pass through (pass-through class), and addRaster auto-shows the overlay.
3. **Wheel zoom dying after tools**: ZoomPane's wheel handler was on its own
   div; tool overlays are SIBLINGS above it. Wheel now binds natively
   (passive:false) on the parent stage (.canvas-area) via a logic ref.
4. **Navigator**: forced 3:2 box + a broken %-chain misplaced the viewport
   rect and ignored orientation. Container now sizes to the image (portrait
   shows portrait); .nav-wrap hugs the img so the rect maps 1:1.
5. **Heal/Clone split + feather**: Spot.feather (default 0.4, both pipelines:
   edge0 = r·(1−feather), shader u_spotB[i].z); separate ◌ Heal / ⧇ Clone arm
   buttons (developStore.spotMode drives placement); Feather slider.
6. **Highlights washing out color (commercial-editor comparison)**: tone regions were
   ADDITIVE (flat offset kills channel ratios near white). Now multiplicative
   luma-ratio scaling (g = (l+region)/l, capped 8×) in BOTH pipelines —
   hue-preserving recovery like the classic. Test pins the warm-ratio survival.
7. **Texture/NR/Sharpening "do nothing"**: regression from the auto-1:1
   upgrade — detail taps are ±1 native texel, invisible when 4608px is viewed
   at ~1200px fit. New `u_detail` uniform stretches taps by texels-per-
   displayed-pixel (zoomScale fed via renderer.viewScale), so previews are
   visible at fit and converge to the exact kernel at 100%. Export unchanged.
8. **Lens database**: lensfun is the answer (the open lens-correction DB) —
   integration = vendor/parse its XML (distortion poly3/ptlens + TCA +
   vignetting, matched by EXIF lens + focal). Planned as the next milestone.

## v0.43 — THIRD FEEDBACK ROUND: measured flatness fix + cache/1:1 bugs

User re-tested v0.42 after a cache clear; three findings, all reproduced/fixed:
1. **Flat 1:1 persists** — measured on the reference DNG (new ignored probe
   `compare_embedded_vs_demosaic` in raw.rs): the v0.41 base look left the
   demosaic at median 77 / SD 44.5 vs the camera's 123 / 58.9 — cameras add
   baseline EXPOSURE, not just a curve. `apply_base_look` is now ADAPTIVE:
   linear-light auto-exposure toward median≈0.20 lin (max +2EV, brighten-only,
   capped so only the top ~0.5% can clip), composed with the S-curve into one
   LUT, sat 1.18. Measured result: median 111 / SD 55.8 / p95 223 ≡ camera.
2. **"Clear preview cache" left the grid blank** — serve_thumb never lazily
   rebaked (preview/full did). Now it regenerates like the others.
3. **"1:1" badge with soft pixels** — two fixes: (a) the badge claimed at load
   START (during a slow post-clear demosaic it lied for ~10s) — now it turns
   on only after the texture is actually uploaded (in-flight guard ref);
   (b) WebKitGTK can silently grant a SMALLER GL backbuffer than the canvas
   asks for → CSS stretch = soft "1:1". `adoptGrantedBackbuffer()` detects
   the clamp, adopts the granted size, logs a console warning (the user-side
   diagnostic if softness ever returns), and `reqW/reqH` tracking prevents
   per-frame realloc churn.
⚠ Users must clear the preview cache once more after updating — the flat 1:1s
baked by older builds are still cached (immutable) until then.

## v0.42 — AI SELECT SUBJECT (Phase C8, verified live)

The modern flagship headline, fully local: U²-Net-p salient-object segmentation via
**tract** (pure-Rust ONNX inference) in `imaging/ai.rs`.
- **Why tract, not ort**: nothing dynamic to bundle — the inference engine
  compiles into the binary, so the AppImage risk that kept this deferred is
  gone by construction. One-shot mask generation doesn't need ort's speed
  (1.9s in release on this box).
- **Model**: u2netp.onnx (4.6MB, rembg release) downloads on first use into
  `<cache>/models/` (atomic .part rename). tract can't run it as-shipped, so
  `patch_resize_modes()` rewrites the protobuf (prost, matching v0.11):
  (1) `pytorch_half_pixel` → `half_pixel` (identical for dims > 1);
  (2) tract mis-evaluates Resize with dynamic `sizes` (collapses 2× decoder
  upsamples to 1×) → two-pass fix: run tract's OWN shape analysis on the
  mode-fixed model to learn each Resize's concrete in/out dims, then bake
  constant `scales` initializers. Load path uses `into_typed()` (NOT
  into_optimized — the optimizer trips the same bug).
- **Pipeline**: 320×320 squash, ImageNet normalization, min-max-normalized
  fused saliency output, upscaled to the 1024px frame proxy → raster-mask
  PNG (the v0.40 slot — only the generator differs). Plan cached in a
  OnceLock after first load.
- `generate_subject_mask` command + "+ Subject" button in Masking (busy
  state, alert on failure). Sky/background ≈ + Subject then Invert.
- Ignored test `subject_mask_runs_end_to_end` (real download + inference):
  `cargo test --lib subject_mask_runs -- --ignored --nocapture`.

## v0.41 — SECOND HANDS-ON FEEDBACK ROUND (11 items, all addressed)

1. **Flat full-decode renders**: rawler's neutral develop now gets a baked
   "camera standard"-ish base look (S-curve + sat 1.15, `apply_base_look` in
   raw.rs) so 1:1 zoom/exports sit visually beside the embedded previews.
2. **Develop low-res**: the 1:1 tier upgrade no longer waits for zoom — it
   loads ~350ms after a photo opens (pro editors load 1:1 in Develop too).
3. **Invisible dropdown text**: explicit `select option` colors (WebKitGTK
   renders the popup with page styles — they were unstyled).
4. **Brush rework**: unlimited strokes painting into an offscreen weight map
   (raster mask infra) + **Erase** mode + Size slider; Apply (button or
   double-click) persists via new `save_mask_raster` command (base64 PNG —
   the only pixels that ever cross IPC, one-shot). The 24-point cap is gone;
   `applyMaskSession` in developStore owns the session lifecycle.
5. **Masks as layers**: Masking panel list = named layers ("2 · Radial
   gradient"), click selects + shows handles for re-editing any time.
6. **✕ visibility**: `.row-delete` was `opacity: 0` outside `.named-list`
   hover (invisible in Masking/Spots panels!) — now always visible, red hover.
7. **Lens corrections**: new `distortion` param (-100..100 → ±0.15 r²
   radial remap in map_frame ≡ geoMap — both pipelines) + per-lens defaults
   saved in prefs keyed by EXIF lens string (Save for this lens / Apply saved).
8. **Crop aspect ratios**: Aspect select (Free/Original/1:1/5:4/4:3/3:2/16:9)
   in CropPanel; choosing snaps the rect (center-anchored), drags stay
   constrained (corner/edge anchoring in CropOverlay).
9. **History cap**: newest 25 steps per image (pruned on save).
10. **Export revamp**: wide own-window dialog (classic sections), **Color Space
    sRGB | AdobeRGB(1998)** (real gamut conversion + matching CC0 ICC
    embedded; classic red≈219 test), **Original format** (verbatim DNG/RAW
    copy + XMP edits), Ctrl+Shift+E opens it from Library AND Develop.
11. **Keybindings**: already shipped in v0.38 — Settings → Shortcuts.

## v0.40 — Raster mask kind + luminosity masks (Phase C groundwork)

The infrastructure AI segmentation will plug into, proven end-to-end with a
real (non-AI) generator:
1. **Mask kind "raster"** (`Mask.raster_id`): a grayscale weight-map PNG in
   `<cache>/masks/<id>.png`, frame-space top-down, bilinear-sampled.
   Referenced by id in EditParams (rides through XMP/presets/snapshots/
   copy-paste); the PNG itself is machine-local — like the classic AI masks, it
   regenerates rather than travels.
2. **Both pipelines**: Rust `mask_weight` raster branch + `raster_sample`
   (bilinear) + `load_mask_rasters`/`apply_masks_with` (export paths thread
   `masks_dir`; old `apply_masks` = no-raster wrapper). Shader: `u_rasterTex`
   (unit 3, LUMINANCE, unflipped so v == top-down frame y) + `u_rasterIdx`;
   kind code 3 in `u_maskMeta[i].w`. Preview budget: 1 raster map (like the
   single previewed brush); exports render all. Missing map = no-op (tested).
3. **`lumen://mask/<rasterId>`** protocol route serves the PNGs to the shader.
4. **First generator — luminosity masks** (`generate_luminosity_mask`
   command): bakes highlights/midtones/shadows weight bands from the upright
   original's luma at 1024px. Masking panel: "+ Lights" / "+ Darks" buttons
   add a raster mask wired to the full local-adjustment set (exposure/
   contrast/sat/temp/tint + range refinements compose on top).
5. AI subject/sky masks (ort + ONNX) will reuse this exact slot — only the
   generator differs. Still deferred to a hands-on session (runtime bundling).

## v0.39 — Develop 1:1 tier (user fix) + second window (Phase E)

**Second window (F11)** — the classic second-monitor view: `SecondWindow.tsx`.
F11 creates/closes a `WebviewWindow` ("second", `index.html?second=1`);
App.tsx mounts `SecondWindowView` alone in that webview. Webviews share no JS
state, so the main window broadcasts `{id, filename}` over the
`second-window-photo` Tauri event on every selection change (re-broadcast on
window creation so it doesn't open blank); the second window renders a clean
full-bleed loupe (2048 proxy, double-click for 1:1). Capabilities: windows +=
"second"; create-webview-window/close/emit/listen perms added.
⚠ Cross-window flow is compile-verified only — needs the hands-on session.

**Report**: "the DNG looks way better and higher resolution in Library than in
Develop." Cause: the Library Loupe upgrades to the native-res `lumen://full`
preview past 100% (since v0.26), but the Develop canvas stayed on the 2048px
proxy at every zoom. **Fix**: ImageCanvas now mirrors the Loupe's tier swap —
zooming past ~100% of the proxy loads the 1:1 preview (full demosaic when the
RAW pref is on) and re-uploads it as the GL texture, with the same
no-visual-jump zoom rescale (numeric zoom × prevW/newW), a floating "1:1"
badge, and a graceful retry on load failure. Oversized sources are downscaled
to the GPU's MAX_TEXTURE_SIZE through an offscreen canvas
(`Renderer.setImage` now accepts canvases; `maxTextureSize()` added). New
photo resets to the fast proxy tier.

## v0.38 — ROADMAP v3 Phase E (part): headless CLI + keybind remap (DONE)

**Keybinding remap** (Settings → Shortcuts): the single-key surface (18
view/cull/develop/chrome actions) is remappable — click the key chip, press a
new letter; conflicts steal the binding; "Reset All". Implemented as a
translation layer (`src/hooks/keymap.ts`): custom keys translate back to the
action's default key before the existing workflow-faithful switch, remapped-away
defaults go inert; overrides persist in localStorage (`lumen.keymap`).

`src-tauri/src/cli.rs` — `cli::try_run_cli()` runs before `tauri::Builder`, so
subcommands never touch the webview (works over SSH/cron):
- `lumenroom import <dir> [--recursive]` — the GUI's own `scan::process_one`
  per file (thumbnails, EXIF, sidecar pickup, dedupe by content-address).
- `lumenroom export --dest <dir> [--all | --picks | --collection <name> |
  <files…>] [--preset <name>] [--format jpeg|png|tiff] [--quality N]
  [--long-edge N] [--full-raw]` — `render_with_options` with the saved edits;
  `--preset` reads the Export-dialog presets from prefs; default target is
  flagged picks ("export my keepers" one-liner); stem de-dupe on collisions.
- Same catalog resolution as the GUI (prefs may relocate it); hand-rolled flag
  parsing (no new deps).
- **Verified live on this headless box** (isolated catalog via XDG_* env):
  imported the real A7IV DNG, exported a correct 800×1200 upright JPEG;
  error paths + help checked.

## v0.37 — ROADMAP v3 Phase D: DAM polish (DONE)

1. **Stacking** (migration 0007: images.stack_id TEXT + stack_pos INT):
   `stack_images` (merges absorbed stacks, order = given ids, first = top),
   `unstack`, `set_stack_top` — all in queries.rs with a roundtrip test.
   Frontend: collapsed-by-default in `applyFilter` via `collapseStacks()`
   (best member = lowest stackPos surviving the filter); `expandedStacks` +
   `stackCounts` in catalogStore; grid badge (count / "pos/count" when open,
   click toggles); Ctrl+G groups selection, Ctrl+Shift+G unstacks; Stacking
   submenu in the photo context menu.
2. **Folder rename/move** (`rename_folder` / `move_folder` commands): disk
   rename first, then prefix-safe catalog path rewrite
   (`?new || substr(path, length(?old)+1)`, NOT REPLACE). Guards: source is
   dir, target free, no move-into-self. Folder context menu: Rename… (prompt),
   Move… (dir picker); browse source follows the new path.
3. **Hierarchical keywords** (migration 0008: keywords.parent_id):
   "Travel > Norway" syntax upserts the chain and tags the leaf;
   `keyword_members` uses a recursive CTE so filtering a parent includes
   descendants; GC keeps nodes with children. Indented tree in the panel.
4. **Painter tool** (the classic spray can): toolbar 🖌 in grid view arms it; payload
   = rating/flag/label/keyword; clicking thumbs sprays instead of selecting
   (painter.ts + uiStore.painter); Esc disarms; crosshair cursor.
5. **Publish-to-folder** (migration 0009: collections.publish_dir/opts +
   `published` ledger): ⇪ on a collection row — first use picks the folder
   (options seeded from prefs.lastExport, which is field-compatible with
   ExportOptions), then one click exports new/re-edited members (blake3 hash
   of EditParams JSON detects re-edits) and deletes files for photos that
   left the collection. Returns exported/skipped/removed counts.
6. **Survey ✕ = drop from selection** (classic semantics): narrows the candidate
   set via the new `setSelection`; no longer flags the photo as a reject.

**Verification**: 48 backend tests passing, frontend build clean.

## v0.36 — ROADMAP v3 Phases B6+B7: color management + camera profiles (DONE)

**B6 — sRGB ICC embedding** (`catalog/export.rs`):
1. Compact sRGB v2 profile (456 bytes, CC0, saucecontrol/Compact-ICC-Profiles)
   vendored at `src-tauri/icc/sRGB-v2-micro.icc`, embedded via `include_bytes!`.
2. Every JPEG export carries it in an APP2 `ICC_PROFILE` segment (both
   `encode_jpeg_capped` and the simple `write_encoded` path); PNG exports get
   an iCCP chunk via the new `encode_png_srgb()` (explicit `PngEncoder`).
   TIFF stays untagged — the `image` crate's TIFF encoder has no ICC hook.
3. Tests assert the APP2 marker + profile bytes (JPEG) and iCCP chunk (PNG)
   actually appear in the encoded output.

**B7 — camera profile slot** (the classic Profile dropdown atop Basic):
1. `EditParams.profile: String` ("" default = neutral; serde(default) keeps old
   JSON). Rides free through presets/snapshots/XMP/copy-paste like everything.
2. Look table `profile_look()` in pipeline.rs ≡ `PROFILES` in
   `src/features/develop/profiles.ts` (MUST match): per profile a base tone
   curve, a saturation multiplier, and a B&W flag —
   Default(identity) / Color(S+1.08) / Vivid(S+1.20) / Portrait(soft, 1.02) /
   Landscape(S+1.15) / B&W(grey collapse).
3. Composition: profile curve sits at the very BOTTOM of the curve stack —
   out = master(channel(parametric(profile(x)))) in `channel_curve_luts` ≡
   `bakeCurveLuts` (so it behaves like a base rendering, not an edit). Profile
   saturation multiplies with the user slider at the Saturation stage
   (`(1+sat)*satMul`, new `u_profSat` uniform). B&W profile reuses the
   existing `u_bw`/`n.bw` path (`blackWhite || profile=="bw"`).
4. UI: Profile `<select>` above the Color/B&W treatment seg in BasicPanel;
   changes go through `commit()` so History records "Profile: X".
5. Tests: unknown profile = byte-identical passthrough (old catalogs safe),
   vivid widens channel spread + darkens shadows, bw collapses to grey.

## v0.35 — ROADMAP v3 Phase B5: full RAW demosaic (DONE)

1. **`rawler 0.6` integration** (`imaging/raw.rs`): `decode_full_raw()` runs the
   complete develop chain — decode, black/white levels, camera WB, full demosaic,
   camera→sRGB color transform — via `RawDevelop::develop_intermediate()`.
   rawler links its own (older) `image` crate, so the result is bridged through
   raw RGB bytes (`to_rgb8().into_raw()` → our `RgbImage::from_raw`).
2. **`decode_raw_best(path, full)`** is the single entry point: `full=true`
   tries demosaic and falls back to the embedded-preview scan on any error
   (unsupported model, corrupt file); `full=false` is the old fast path.
3. **`rawDecode` pref** ("embedded" default | "full"), Settings → Performance →
   "RAW decode quality". Wired into:
   - `export_image` / `export_image_with` (both render fns take `raw_full: bool`),
   - `protocol.rs serve_full` — when on, the 1:1 preview is a true demosaic
     (oriented, JPEG q90, cached), not the embedded JPEG.
   Library thumbs and the 2048px Develop proxy stay on the fast path by design.
4. **Verified on the real A7IV DNG** (ignored test extended; ~8.8s decode):
   demosaic produced 4608×3072 — identical to the embedded preview, which
   looked like a failure until diagnosed: the sample is an **APS-C crop-mode
   shot**, so 4608×3072 IS native resolution there. Assertion relaxed to `>=`
   with an explanatory comment. On full-frame files the gain is ~14MP → 33MP.

**Verification**: 41 backend tests passing, frontend build clean.

## v0.34 — ROADMAP v3 Phase A: workflow automation (DONE)

1. **Auto-Import** (`catalog/autoimport.rs`, notify crate): watches the
   pref-configured folder (Settings → General: enable + Choose…); new files
   wait for size-stability (camera/copy still writing), run through the normal
   import pipeline, and stream into the open catalog via the "auto-import"
   event (store.addImported). Watcher restarts live on prefs change; in-flight
   set dedupes Create/Modify storms.
2. **Export presets + Export with Previous**: named option sets persisted in
   prefs (destination never stored in a preset); the dialog seeds itself from
   the last export; the photo context menu gained "Export with Previous"
   (one-click re-export via the new shared `exportRunner.ts`, which the dialog
   also uses now).
3. **Neighbor prefetch** (`prefetch_previews` command): on selection change
   (debounced 250ms) the ±2 neighbors' 2048px proxies are pre-baked in the
   background — the the commercial editor "Loading…" lag class, designed out.
4. **Rolling catalog backups**: at launch, BEFORE the pool opens (file closed),
   `catalog.sqlite` is copied to `backups/catalog-<stamp>.sqlite`; keeps the
   newest N (pref, default 5, Settings → Catalog).

## v0.33 — classic keymap (DONE)

Implemented per the user's reference (the vendor's help shortcut page) — every binding
whose feature exists in LumenRoom:
- **Undo/Redo**: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (Develop) — the engine existed,
  the binding didn't.
- **Zoom**: Z and Space toggle Fit↔100% (Loupe/Develop); Ctrl+= / Ctrl+- step.
- **Chrome**: L Lights Out 3-state (dims then blacks the panels/topbar/
  filmstrip via .lights-dim/.lights-off classes) · F fullscreen (Tauri window
  API + new capability permissions) · I info overlay (filename/settings/date,
  Loupe + Develop) · T toolbar · F6/F7/F8 filmstrip/left/right (panelsOpen was
  split into leftPanelOpen/rightPanelOpen; Tab still toggles both).
- **Library**: Ctrl+L attribute-filter bypass (source survives; new
  filtersEnabled in catalogStore) · Ctrl+' virtual copy · Ctrl+S write XMP for
  the selection · Enter grid→loupe · Esc back-to-grid/cancel-tool · Home/End ·
  Delete/Backspace remove-from-catalog WITH confirm dialog (judgment call,
  matches the classic prompt; disk never touched).
- **Develop**: O mask-overlay toggle · \ before/after alias.
- ? overlay rewritten as the full 4-column reference.

## v0.32 — Heal / Clone spot removal (DONE)

- **Model**: `spots: Vec<Spot>` in EditParams ({x,y} dst, {srcX,srcY} source,
  radius, heal flag; frame coords; preview renders 8, XMP/snapshots carry them).
- **Engine**: the frame→source geometry math was refactored into ONE shared
  mapping (`map_frame` closure in Rust === `geoMap()` GLSL function) — spots
  simply redirect the sample through the same mapping with a feathered blend,
  so they ride crop/rotation/keystone correctly. **Heal** = clone + low-
  frequency transfer (4-tap blur difference dst−src) so the patch adopts the
  destination's tone; **Clone** = exact copy. Applied at the sampling stage in
  BOTH pipelines (before all color work, classic style).
- **Tests**: clone covers a black blemish from a clean source (corner
  byte-identical); heal lands measurably closer to the destination tone than
  raw clone on a brightness mismatch. 41 total.
- **UI**: Heal/Clone panel (arm tool → click blemish; auto source offset;
  Heal|Clone toggle + Size per spot; list w/ delete; Apply) + SpotOverlay
  (solid dst circle, dashed src circle, connecting line, drag either,
  double-click applies — consistent with the mask workflow).

## v0.31 — Hands-on feedback round 1 (DONE)

User tested the app for the first time. Four reports, four fixes:
1. **Filmstrip Ctrl+A**: every selected frame now gets the blue box (`selected`
   for all members; the active photo additionally ringed via `.primary`); grid
   co-selected strengthened to full accent too.
2. **Mask Apply**: double-click the photo (or the new Apply button in the
   Masking panel) dismisses the editing overlay and commits — user keeps
   working; the mask stays active for the adjustment sliders.
3. **Brush paint highlight**: the stroke renders as a translucent **green**
   band (width = brush diameter, classic-style) while painting and while editing;
   on release the mask auto-applies (overlay hidden, highlight gone, sliders
   ready).
4. **Export revamp** (research §5 alignment): resize modes (long edge / short
   edge / megapixels, downscale-only) · **JPEG file-size cap** (quality steps
   down to 40 until it fits — tested) · **output sharpening** (post-resize
   screen sharpen) · explicit Color Space row (sRGB, fixed) · explicit
   Metadata row (None/full-strip, others planned).

## v0.30 — Radial rotation · Transform keystone · Brush masks (DONE)

- **Radial mask rotation** (-180..180°): sample rotated into ellipse space —
  matched in `mask_weight` (Rust) and the shader (rotation rides in
  `u_maskRngB[i].z`); Rotate slider in the panel; overlay ellipse rotates.
- **Transform keystone** (Vertical/Horizontal, ±100 → ±0.35 projective):
  out→src projective remap of frame coords before rotation, both pipelines;
  sliders in Crop & Straighten → Transform; geometry-identity, stripGeometry
  and mergePreset all updated. Test: vertical bar widths differ top vs bottom.
  Note: masks evaluate on OUTPUT frame coords (consistent both pipelines).
- **Brush masks** (the headline): strokes stored as up-to-24 frame-coord
  points INSIDE EditParams (so XMP/snapshots/copy-paste carry them); weight =
  feathered falloff from distance-to-polyline — `mask_weight` "brush" branch
  (Rust, point-to-segment min) === shader loop over `u_brushPts[24]`.
  **Preview supports one brush mask** (uniform budget; export supports all 4;
  UI caps at one). Painting UX: + Brush arms the tool → paint directly on the
  photo (live stroke preview, 0.02 min spacing), release creates the mask;
  drag moves the whole stroke; Brush Size + Feather sliders; range refinement
  (lum/color) composes with brushes too. Test: brightens along the stroke,
  byte-identical far away and beyond the stroke end.

## What remains (the genuinely hands-on tail)

AI subject/sky masks · heal/clone spots · lensfun profile corrections (system
lib install) · keybinding remap · Copy-as-DNG · folder rename/move ops ·
brush eraser/multi-stroke. **The single most valuable next step is unchanged:
a human session in the app** — the whole interactive surface (zoom, crop, mask
painting, menus, dialogs) is compile- and test-verified but untouched by hand.

## Known limitations
- RAW = embedded preview (~14MP), not full sensor res. Develop proxy is 2048px (export is full-res).
- Clarity is a midtone-contrast approximation (no blur pass) in both shader and Rust pipeline.
- No XMP import yet (export only). No tests on the React layer (build/type-check only).
- EXIF aperture/focal best-effort; capture date now parses correctly (was a bug, fixed).
