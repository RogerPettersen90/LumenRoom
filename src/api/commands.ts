// Typed wrappers over Tauri's `invoke`. The frontend only ever talks to the
// backend through these — keeps the IPC contract in one auditable place.

import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  Collection,
  ColorLabel,
  EditParams,
  HistoryStep,
  ImageMeta,
  Keyword,
  Preset,
  ScanEvent,
  Snapshot,
} from "@/types/models";

/**
 * Scan a directory for images. Progress streams back through `onEvent` so the
 * grid can fill in live; the resolved promise is the final imported count.
 */
export async function scanDirectory(
  dir: string,
  recursive: boolean,
  mode: "add" | "copy" | "move",
  dest: string | undefined,
  onEvent: (e: ScanEvent) => void
): Promise<number> {
  const channel = new Channel<ScanEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("scan_directory", { dir, recursive, mode, dest, onEvent: channel });
}

export function listImages(): Promise<ImageMeta[]> {
  return invoke<ImageMeta[]>("list_images");
}

export function getEditParams(imageId: string): Promise<EditParams> {
  return invoke<EditParams>("get_edit_params", { imageId });
}

export function saveEditParams(
  imageId: string,
  params: EditParams,
  label: string
): Promise<void> {
  return invoke("save_edit_params", { imageId, params, label });
}

export function getHistory(imageId: string): Promise<HistoryStep[]> {
  return invoke<HistoryStep[]>("get_history", { imageId });
}

export function setCull(
  imageId: string,
  rating: number | null,
  flag: number | null
): Promise<void> {
  return invoke("set_cull", { imageId, rating, flag });
}

export function setLabel(imageId: string, label: ColorLabel | null): Promise<void> {
  return invoke("set_label", { imageId, label });
}

/**
 * Render the image at full resolution with its saved edits and write it to
 * `dest`. Output format is inferred from the destination extension. Resolves
 * to the written path.
 */
export function exportImage(
  imageId: string,
  dest: string,
  quality?: number
): Promise<string> {
  return invoke<string>("export_image", { imageId, dest, quality });
}

/**
 * Write a non-destructive XMP sidecar (`<original>.xmp`) next to the original
 * so other editors can read the edits. Resolves to the written path.
 */
export function exportSidecar(imageId: string): Promise<string> {
  return invoke<string>("export_sidecar", { imageId });
}

// ── Presets & snapshots ──

export function savePreset(name: string, params: EditParams): Promise<Preset> {
  return invoke<Preset>("save_preset", { name, params });
}

export function listPresets(): Promise<Preset[]> {
  return invoke<Preset[]>("list_presets");
}

export function deletePreset(id: number): Promise<void> {
  return invoke("delete_preset", { id });
}

export function saveSnapshot(
  imageId: string,
  name: string,
  params: EditParams
): Promise<Snapshot> {
  return invoke<Snapshot>("save_snapshot", { imageId, name, params });
}

export function listSnapshots(imageId: string): Promise<Snapshot[]> {
  return invoke<Snapshot[]>("list_snapshots", { imageId });
}

export function deleteSnapshot(id: number): Promise<void> {
  return invoke("delete_snapshot", { id });
}

export function importSidecar(imageId: string): Promise<EditParams> {
  return invoke<EditParams>("import_sidecar", { imageId });
}

// ── Collections ──

export function createCollection(name: string): Promise<Collection> {
  return invoke<Collection>("create_collection", { name });
}

export function listCollections(): Promise<Collection[]> {
  return invoke<Collection[]>("list_collections");
}

export function deleteCollection(id: number): Promise<void> {
  return invoke("delete_collection", { id });
}

export function addToCollection(id: number, imageIds: string[]): Promise<void> {
  return invoke("add_to_collection", { id, imageIds });
}

export function removeFromCollection(id: number, imageIds: string[]): Promise<void> {
  return invoke("remove_from_collection", { id, imageIds });
}

export function collectionMembers(id: number): Promise<string[]> {
  return invoke<string[]>("collection_members", { id });
}

// ── Publish-to-folder ──

export interface PublishReport {
  exported: number;
  removed: number;
  skipped: number;
}

/** Configure a collection's publish destination + options (ExportOptions JSON). */
export function setPublishConfig(id: number, dir: string, options: string): Promise<void> {
  return invoke("set_publish_config", { id, dir, options });
}

/** Sync the collection to its publish folder (new/changed/removed). */
export function publishCollection(id: number): Promise<PublishReport> {
  return invoke<PublishReport>("publish_collection", { id });
}

// ── Keywords ──

export function addKeyword(imageIds: string[], name: string): Promise<Keyword> {
  return invoke<Keyword>("add_keyword", { imageIds, name });
}

export function removeKeyword(imageId: string, keywordId: number): Promise<void> {
  return invoke("remove_keyword", { imageId, keywordId });
}

export function imageKeywords(imageId: string): Promise<Keyword[]> {
  return invoke<Keyword[]>("image_keywords", { imageId });
}

export function listKeywords(): Promise<Keyword[]> {
  return invoke<Keyword[]>("list_keywords");
}

export function keywordMembers(id: number): Promise<string[]> {
  return invoke<string[]>("keyword_members", { id });
}

// ── Stacking ──

/** Group images into a stack (first id = top); returns the stack id. */
export function stackImages(imageIds: string[]): Promise<string> {
  return invoke<string>("stack_images", { imageIds });
}

export function unstack(stackId: string): Promise<void> {
  return invoke("unstack", { stackId });
}

export function setStackTop(imageId: string): Promise<void> {
  return invoke("set_stack_top", { imageId });
}

/** Pre-bake develop proxies for upcoming photos (fire-and-forget). */
export function prefetchPreviews(imageIds: string[]): Promise<void> {
  return invoke("prefetch_previews", { imageIds });
}

/** Create a virtual copy; resolves to the new image id. */
export function createVirtualCopy(imageId: string): Promise<string> {
  return invoke<string>("create_virtual_copy", { imageId });
}

/** Remove a photo / virtual copy from the catalog (disk untouched). */
export function removeFromCatalog(imageId: string): Promise<void> {
  return invoke("remove_from_catalog", { imageId });
}

// ── IPTC metadata ──

export interface Iptc {
  title: string | null;
  caption: string | null;
  copyright: string | null;
  creator: string | null;
}

export function getIptc(imageId: string): Promise<Iptc> {
  return invoke<Iptc>("get_iptc", { imageId });
}

export function setIptc(imageId: string, iptc: Iptc): Promise<void> {
  return invoke("set_iptc", { imageId, iptc });
}

// ── Smart collections ──

export interface SmartCollectionRow {
  id: number;
  name: string;
  rules: string; // JSON SmartRules
}

export function saveSmartCollection(name: string, rules: string): Promise<SmartCollectionRow> {
  return invoke<SmartCollectionRow>("save_smart_collection", { name, rules });
}

export function listSmartCollections(): Promise<SmartCollectionRow[]> {
  return invoke<SmartCollectionRow[]>("list_smart_collections");
}

export function deleteSmartCollection(id: number): Promise<void> {
  return invoke("delete_smart_collection", { id });
}

/** Reveal a file in the system file manager. */
export function revealFile(path: string): Promise<void> {
  return invoke("reveal_file", { path });
}

/** Rename a folder on disk + rewrite catalog paths. Returns the new path. */
export function renameFolder(path: string, newName: string): Promise<string> {
  return invoke<string>("rename_folder", { path, newName });
}

/** Move a folder into another parent (disk + catalog). Returns the new path. */
export function moveFolder(path: string, newParent: string): Promise<string> {
  return invoke<string>("move_folder", { path, newParent });
}

// ── Preferences & catalog management ──

export interface Prefs {
  autoXmp: boolean;
  importRecursive: boolean;
  catalogDir: string | null;
  exportQuality: number;
  previewBuild: string; // "minimal" | "standard" | "full"
  autoImportDir: string | null;
  autoImportEnabled: boolean;
  rawDecode: string; // "embedded" | "full"
  catalogBackups: number;
  exportPresets: Array<{ name: string; options: string }>;
  lastExport: string | null;
  /** Per-lens correction defaults (lens string → JSON LensDefault). */
  lensDefaults: Record<string, string>;
}

export interface CatalogInfo {
  dbPath: string;
  dbBytes: number;
  cacheBytes: number;
  imageCount: number;
}

export function getPrefs(): Promise<Prefs> {
  return invoke<Prefs>("get_prefs");
}

export function setPrefs(prefs: Prefs): Promise<void> {
  return invoke("set_prefs", { prefs });
}

export function catalogInfo(): Promise<CatalogInfo> {
  return invoke<CatalogInfo>("catalog_info");
}

export function optimizeCatalog(): Promise<void> {
  return invoke("optimize_catalog");
}

/** Returns bytes freed. */
export function clearThumbnailCache(): Promise<number> {
  return invoke<number>("clear_thumbnail_cache");
}

/**
 * Bake a luminosity-mask weight map ("highlights" | "midtones" | "shadows")
 * for the image; resolves to the raster id for a kind:"raster" mask.
 */
export function generateLuminosityMask(
  imageId: string,
  mode: "highlights" | "midtones" | "shadows"
): Promise<string> {
  return invoke<string>("generate_luminosity_mask", { imageId, mode });
}

/** Persist a painted brush weight map (data-URL PNG) → raster id. */
export function saveMaskRaster(imageId: string, data: string): Promise<string> {
  return invoke<string>("save_mask_raster", { imageId, data });
}

/**
 * AI Select Subject (local U²-Net inference; ~4.6MB model downloads on first
 * use). Resolves to the raster id for a kind:"raster" mask. Slow-ish (a few
 * seconds) — show progress.
 */
export function generateSubjectMask(imageId: string): Promise<string> {
  return invoke<string>("generate_subject_mask", { imageId });
}

// ── Lens profiles (lensfun) ──

export interface LensProfile {
  matched: string;
  lensA: number;
  lensB: number;
  lensC: number;
  caRed: number;
  caBlue: number;
}

/** Look up a lensfun correction profile (embedded DB; null = no match). */
export function lookupLensProfile(
  lens: string,
  focal: number | null
): Promise<LensProfile | null> {
  return invoke<LensProfile | null>("lookup_lens_profile", { lens, focal });
}

/** Forget a folder + everything under it (disk untouched). Returns count. */
export function removeFolderFromCatalog(path: string): Promise<number> {
  return invoke<number>("remove_folder_from_catalog", { path });
}
