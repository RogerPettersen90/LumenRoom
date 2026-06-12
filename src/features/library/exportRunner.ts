import { invoke } from "@tauri-apps/api/core";
import { useCatalogStore } from "@/store/catalogStore";

export interface ExportSettings {
  dest: string;
  pattern: string;
  /** "original" = verbatim file copy (a DNG stays a DNG); edits ride in XMP. */
  format: "jpeg" | "png" | "tiff" | "original";
  /** Output color space (profile embedded): sRGB or AdobeRGB (1998). */
  colorSpace: "srgb" | "adobergb";
  quality: number;
  resizeMode: "long" | "short" | "megapixels";
  resizeValue: number | null;
  maxFileKb: number | null;
  outputSharpen: boolean;
  watermarkText: string | null;
  watermarkAnchor: "br" | "bl" | "tr" | "tl" | "center";
}

export const EXPORT_EXT: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  tiff: "tif",
  original: "orig", // placeholder — the backend swaps in the source extension
};

/** Resolve the naming pattern for one photo. */
export function resolveExportName(s: ExportSettings, id: string, seq: number): string {
  const img = useCatalogStore.getState().byId[id];
  const stem = img ? img.filename.replace(/\.[^.]+$/, "") : id.slice(0, 8);
  const date = img?.capturedAt
    ? new Date(img.capturedAt * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return s.pattern
    .replace(/\{name\}/g, stem)
    .replace(/\{seq\}/g, String(seq).padStart(3, "0"))
    .replace(/\{date\}/g, date);
}

/** Run a full export of `ids` with the given settings. */
export async function runExport(
  ids: string[],
  s: ExportSettings,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const used = new Set<string>();
  let done = 0;
  for (const id of ids) {
    const base = resolveExportName(s, id, done + 1);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) candidate = `${base}_${n++}`;
    used.add(candidate);

    await invoke("export_image_with", {
      imageId: id,
      dest: `${s.dest}/${candidate}.${EXPORT_EXT[s.format]}`,
      options: {
        format: s.format,
        colorSpace: s.colorSpace ?? "srgb",
        quality: s.quality,
        resizeMode: s.resizeMode,
        resizeValue: s.resizeValue,
        maxFileKb: s.maxFileKb,
        outputSharpen: s.outputSharpen,
        watermarkText: s.watermarkText,
        watermarkAnchor: s.watermarkAnchor,
      },
    });
    done++;
    onProgress?.(done, ids.length);
  }
  return done;
}
