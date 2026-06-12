# LumenRoom — Commercial-Parity Roadmap

> **REVISED 2026-06-12 (v3)** — full capability audit + second research round
> (modern commercial AI features, workflow automation, engine internals, user pain
> points). v2 below is COMPLETE except its Tier 2/3 leftovers, which are folded
> into v3. This section is the live plan.

## Capability audit (v0.33 — ~13.2k LOC, 42 commands, 41 tests)

**DAM**: Import dialog (Add/Copy/Move + sidecar transfer + preview-build tiers) ·
RAW embedded-preview pipeline (real-DNG verified) · five-zone shell ·
Grid/Loupe/Compare/Survey · filmstrip + mini-filter + breadcrumb · folders tree ·
collections + Quick Collection + Smart Collections (live rules) · keywords ·
flags/stars/labels + Caps advance · full filter system + Ctrl+L bypass · zoom +
Navigator + 1:1 tier · virtual copies · context menus · IPTC editing · complete
classic keymap · Lights Out · prefs/catalog mgmt.
**Develop (dual-pipeline, GPU preview ≡ Rust export)**: calibration · WB/tone ·
dehaze/texture/clarity · parametric + master + RGB curves · B&W · sat/vibrance ·
HSL · color grading · masks (linear/radial+rotation/brush × lum/color range) ·
heal/clone at the sampling stage · NR (bilateral) · sharpen + edge masking ·
vignette/grain · crop/straighten/keystone/CA · presets/snapshots/history/
undo-redo/copy-paste/before-after/clipping.
**Output**: export dialog (tokens/formats/resize modes/size cap/output
sharpen/watermark) · batch · lossless XMP round-trip + debounced auto-sync.

## v3 plan

### Phase A — Workflow automation (high value, fully headless-buildable)
1. **Auto-Import / watched folder** (the classic Auto Import): `notify` crate watches a
   pref-configured folder; new files import automatically (background, streams
   into the open catalog). The #1 working-photographer automation.
2. **Export presets**: save/recall named option sets in the Export dialog +
   "Export with Previous" (one keystroke re-export).
3. **Neighbor prefetch**: pre-generate develop proxies for the ±2 photos around
   the selection in the background — kills the classic infamous "Loading…" lag class.
4. **Catalog backup**: zip the .sqlite on exit (pref-gated, keep N copies) —
   the classic backup-on-close parity.

### Phase B — Engine depth
5. ✅ **Full RAW demosaic** (rawler develop path, v0.35): lifts the embedded-preview
   ceiling to full sensor res for 1:1 zoom + export. Behind Settings →
   Performance → RAW decode quality; embedded previews stay the fast default.
6. ✅ **Color management v1** (v0.36): compact sRGB v2 ICC profile (CC0) embedded
   in every JPEG (APP2) + PNG (iCCP) export; groundwork for AdobeRGB export +
   soft proofing later. (TIFF: `image` crate has no ICC hook — untagged.)
7. ✅ **Camera profile slot** (v0.36): per-image baseline profile dropdown atop
   Basic (Default/Color/Vivid/Portrait/Landscape/B&W) — base tone curve composed
   UNDER user curves + saturation multiplier, matched both pipelines
   (profile_look ≡ profiles.ts). DCP camera-matching later.

### Phase C — Local AI tier (open-source friendly, fully offline)
8. ✅ **AI subject masks (v0.42)**: U²-Net-p segmentation via **tract** (pure-
   Rust ONNX inference — nothing dynamic to bundle, AppImage stays self-
   contained; the ort/libonnxruntime risk is gone by construction). 4.6MB
   model downloads on first use and is graph-patched for tract compat
   (pytorch_half_pixel → half_pixel + constant-folded Resize scales via
   tract's own shape analysis). Verified live: 1.9s release-mode inference,
   subject=255/background=0. "+ Subject" in Masking; + Invert ≈ sky/
   background. (v0.40 below: the raster-mask slot it plugs into.)
   Remaining in C: AI denoise.
9. **AI denoise** (model-based) once the ONNX infrastructure from #8 exists.

### Phase D — DAM polish (from v2 leftovers + research)
10. ✅ (v0.37) Stacking (Ctrl+G group / Ctrl+Shift+G unstack, badge, collapse) ·
    folder rename/move (disk + prefix-safe path rewrite) · hierarchical
    keywords ("Travel > Norway", parent filter includes children) · painter
    tool (spray rating/flag/label/keyword) · publish-to-folder (per-collection
    dest + opts, hash ledger syncs new/changed/removed) · survey ✕ =
    drop-from-selection (classic semantics, no longer rejects).

### Phase E — Linux-first uniqueness
11. ✅ **headless CLI** (v0.38): `lumenroom import <dir>` + `lumenroom export
    --dest <dir> [--all|--picks|--collection N|files…] [--preset/--format/
    --quality/--long-edge/--full-raw]` — real engines, no window, verified
    end-to-end on the sample DNG over SSH. ✅ **keybind remap UI** (v0.38):
    Settings → Shortcuts, translation-layer remap of the single-key surface.
    ✅ **second window** (v0.39): F11 webview + event-driven loupe (needs
    hands-on verification). Remaining: **gphoto2 tethering** (needs camera
    hardware).

**Sequencing**: A1→A2→A3 immediately (pure value, no risk) · B5 next (deepest
engine win) · C8 when ready for the model-runtime leap · D/E interleaved with
hands-on feedback rounds.

## Gap analysis: research vs. LumenRoom v0.25

**Already at parity:** catalog-links-not-copies model · Add-mode import · Grid/Loupe/
Compare/Survey + P/X/U, 1–5, 6–9 taxonomy · folders mirror (read-only) · collections ·
keywording (flat) · histogram + Quick Develop + EXIF metadata panel · Navigator with
zoom regions · presets/snapshots/history · Basic (Treatment/WB/Tone/part of Presence) ·
point tone curve · HSL · color grading (3 zones + balance) · sharpen amount + NR
lum/color · linear/radial masks · post-crop vignette/grain · XMP sidecar round-trip ·
batch export.

### Tier 1 — build now (high value, headless-verifiable)
1. **RGB channel tone curves** — per-channel point curves composed with the master;
   our LUT texture already has independent R/G/B channels, so the shader needs zero
   changes. Unlocks cinematic grading.
2. **Range masks (luminance + color)** — refine any mask's weight by pixel luminance
   band or color similarity. Pointwise → clean dual-pipeline fit.
3. **Export dialog** — format (JPEG/TIFF/PNG), resize long-edge / megapixel cap,
   quality, **naming tokens** (date/name/sequence), metadata strip toggle, **text
   watermark** with anchor positions.
4. **1:1 preview tier** — full-resolution preview cache (`lumen://full/<id>`),
   ZoomPane swaps to it past ~120%; import-time preview building pref
   (minimal/standard/1:1). Kills the "100% = 2048 proxy" caveat.
5. **Quick Collection (B)** + **Smart Collections** (rule JSON evaluated like
   filters: rating/flag/label/camera/lens/keyword/date).
6. **Editable IPTC** (title/caption/copyright/creator) in Metadata panel, stored in
   catalog + written to XMP.
7. **Dehaze** (pointwise approximation) + **sharpening edge masking** (the classic Masking
   slider; protects flat areas/skies).
8. **Import dialog** — Add / **Copy** / **Move** modes with destination picker +
   preview-build choice. (Copy-as-DNG deferred — needs a DNG writer.)

### Tier 2 — needs hands-on session or heavy machinery
Brush masks (raster storage) · AI subject/sky masks (ML) · heal/clone · lensfun
profile corrections + CA removal · Transform/Upright (homography pass) · parametric
curve region sliders · Texture (multi-band) · camera Profiles + Calibration ·
Smart Previews (offline proxies) · folder rename/move ops · hierarchical keywords ·
radial mask rotation · keybinding remap.

### Tier 3 — deliberate non-goals (revisit post-1.0)
Map, Book, Slideshow, Print, Web modules · generative AI remove · Blurb/FTP
integrations · color-managed soft proofing (sRGB-only pipeline for now).


_Goal: a flagship-class experience, native on Linux. Reference: the leading commercial editor's
Library module screenshot (five-zone layout). Get the pieces in place first, then
diverge/innovate._

## Architecture verdict

The foundation is right and stays: **Tauri v2 + Rust backend + SQLite catalog +
`lumen://` pixel side-channel + WebGL live develop preview + CPU-twin export pipeline.**
This is exactly the performance shape the commercial editor itself uses (catalog DB + preview cache +
GPU develop). What needs rebuilding is the **app shell** — our current single-toolbar
layout doesn't match the classic five-zone anatomy, and every future feature (panels, navigator,
filmstrip-everywhere) lands inside that shell. Shell first, then fill the panels.

## the leading commercial editor anatomy (what we're matching)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Identity plate            …            Library | Develop | (modules) │ ← module picker
├──────────┬───────────────────────────────────────────┬───────────────┤
│ LEFT     │  Library Filter (Text|Attribute|Metadata) │ RIGHT         │
│ Navigator│                                           │ Histogram     │
│ Catalog  │            CENTER WORK AREA               │ Quick Develop │
│ Folders  │      (Grid / Loupe / Compare / Survey)    │ Keywording    │
│ Collect. │                                           │ Metadata      │
│ Import…  │  Toolbar (view modes, sort, thumb size)   │               │
├──────────┴───────────────────────────────────────────┴───────────────┤
│ FILMSTRIP (persistent across ALL modules, with mini-filter)          │
└──────────────────────────────────────────────────────────────────────┘
```
Develop swaps the panel contents: left = Presets/Snapshots/History, right =
Histogram + tool strip + Basic/Tone Curve/HSL/Color Grading/Detail/Lens/Transform/
Effects/Calibration. All side panels are collapsible accordions (disclosure
triangles); Tab hides side panels.

---

## Phase 1 — The the commercial editor Shell  ⟵ NEXT

Rebuild the frame; move existing features into it. No new imaging code.

1. **Five-zone `AppShell`**: top bar (identity plate left, module picker right) ·
   collapsible left panel group · center + toolbar · collapsible right panel group ·
   **persistent filmstrip in every module** (incl. Library grid). `Tab` toggles side
   panels. Panel groups scroll independently.
2. **`PanelSection` accordion** component (the classic core UI primitive) — collapsible
   sections with disclosure triangles, used by every panel below.
3. **Library left panels**: Navigator (preview w/ FIT/FILL/100% + zoom-rect for loupe) ·
   Catalog (All Photographs / Previous Import) · **Folders as a hierarchical tree**
   (upgrade from flat list; counts per node, expandable) · Collections (stub) ·
   `Import…` / `Export…` buttons pinned at the bottom (classic layout).
4. **Library right panels**: Histogram (for the selected photo) · Quick Develop
   (classic-style **relative** nudge buttons, applies to whole selection) · Keywording
   (stub until Phase 4) · Metadata (EXIF panel — data already in catalog).
5. **Grid cell anatomy**: index number (large, grey, top-left, classic style) · color-label
   cell tint · flag/rating badges · thumbnail-size slider in the toolbar.
6. **Develop panel rearrange**: left = History (moves from right) + Presets/Snapshots
   stubs · right = Histogram + Basic regrouped in the commercial editor order (WB → Tone → Presence).
7. **Color labels**: 6/7/8/9 shortcuts, label tints in grid/filmstrip, label filter in
   FilterBar + filmstrip mini-filter. (Schema already has `images.color_label`.)

## Phase 2 — Culling completeness
- **Compare view (C)**: Select vs Candidate side-by-side, swap (↑/↓), synced zoom.
- Filmstrip mini-filter (flags/stars/labels) + source breadcrumb ("Folder X — 50 of 1469").
- Caps-Lock auto-advance when flagging/rating (classic behaviour); `B` Quick Collection (later).

## Phase 3 — Develop depth (largest phase; each lands in BOTH pipelines: WebGL shader + Rust export)
- **Crop & straighten** tool (overlay w/ thirds grid; crop params into EditParams).
- **Tone Curve** (parametric + point curve).
- **HSL / Color Mixer** (8 color channels × hue/sat/luminance).
- **Color Grading** (shadows/midtones/highlights wheels + blending/balance).
- **Detail**: sharpening + noise reduction (real convolution — CPU/Rust for export;
  preview approximation or Rust-rendered preview readback).
- **Effects**: post-crop vignette + grain. **B&W** treatment toggle.
- **Lens Corrections** via the **lensfun** database (Linux-native win!) + Transform.
- **Presets / Snapshots / Copy-Paste settings / Before-After (Y)** — all cheap once
  EditParams is the unit of exchange.
- **Masking** (linear/radial gradient, brush w/ feather) — last; needs a mask stack
  per image (schema + shader + export). Big but designed-for.

## Phase 4 — Data & search
- **Collections + Collection Sets** (new tables; drag-drop add; smart collections later).
- **Keywords** (tables + Keywording panel + suggestions + keyword filter).
- **Filter bar Text tab** (search filename/metadata) + **Metadata tab** (column browser:
  date/camera/lens/label classic style).
- **XMP import** (read `lumenroom:Params` + crs: back; auto-detect sidecars on scan).
- Virtual copies; stacking.

## Phase 5 — Output & Linux polish
- Export dialog w/ presets: resize, quality, sharpening-for-output, rename, watermark; batch.
- Tethering/Map/Book/Slideshow/Print/Web: **non-goals** (revisit after uniqueness phase).
- Packaging: AppImage/deb/rpm, .desktop entry, MIME/file associations, freedesktop
  thumbnailer integration.
- Then: the "build it uniquely" phase — diverge where Linux lets us be better
  (lensfun, local-first sync, scriptability).

## Schema additions queued (single migration when Phase 4 starts)
`collections`, `collection_images`, `keywords`, `image_keywords`, `presets`,
`snapshots`, `masks` (Phase 3 masking). `images.color_label` already exists.
