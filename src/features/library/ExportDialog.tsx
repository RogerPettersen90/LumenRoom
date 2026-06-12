import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getPrefs, setPrefs } from "@/api/commands";
import type { Prefs } from "@/api/commands";
import { useCatalogStore } from "@/store/catalogStore";
import { EXPORT_EXT, resolveExportName, runExport } from "./exportRunner";
import type { ExportSettings } from "./exportRunner";

interface ExportDialogProps {
  onClose: () => void;
}

const DEFAULTS: ExportSettings = {
  dest: "",
  pattern: "{name}_edited",
  format: "jpeg",
  colorSpace: "srgb",
  quality: 90,
  resizeMode: "long",
  resizeValue: null,
  maxFileKb: null,
  outputSharpen: false,
  watermarkText: null,
  watermarkAnchor: "br",
};

/**
 * The Export dialog (the classic export architecture): destination, naming tokens,
 * format/quality, sizing + file-size cap, output sharpening, watermarking —
 * with named presets and a remembered "previous export".
 */
export function ExportDialog({ onClose }: ExportDialogProps) {
  const selection = useCatalogStore((s) => s.selection);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const ids = selection.length > 0 ? selection : selectedId ? [selectedId] : [];

  const [s, setS] = useState<ExportSettings>(DEFAULTS);
  const [resize, setResize] = useState(false);
  const [capSize, setCapSize] = useState(false);
  const [prefs, setPrefsLocal] = useState<Prefs | null>(null);
  const [presetName, setPresetName] = useState("");
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    void getPrefs()
      .then((p) => {
        setPrefsLocal(p);
        setS((cur) => ({ ...cur, quality: p.exportQuality }));
        // Start from the previous export when one exists.
        if (p.lastExport) {
          try {
            const prev = JSON.parse(p.lastExport) as ExportSettings;
            setS(prev);
            setResize(prev.resizeValue != null);
            setCapSize(prev.maxFileKb != null);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(console.error);
  }, []);

  const patch = (p: Partial<ExportSettings>) => setS((cur) => ({ ...cur, ...p }));

  const applyPreset = (json: string) => {
    try {
      const v = JSON.parse(json) as Partial<ExportSettings>;
      setS((cur) => ({ ...cur, ...v, dest: cur.dest })); // presets never carry the destination
      setResize((v.resizeValue ?? null) != null);
      setCapSize((v.maxFileKb ?? null) != null);
    } catch {
      /* ignore */
    }
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name || !prefs) return;
    const { dest: _dest, ...rest } = s;
    const entry = { name, options: JSON.stringify(rest) };
    const next = {
      ...prefs,
      exportPresets: [...prefs.exportPresets.filter((p) => p.name !== name), entry],
    };
    await setPrefs(next);
    setPrefsLocal(next);
    setPresetName("");
  };

  const pickDest = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Export to folder" });
    if (typeof dir === "string") patch({ dest: dir });
  };

  const run = async () => {
    if (!s.dest || ids.length === 0 || progress) return;
    const effective: ExportSettings = {
      ...s,
      resizeValue: resize ? s.resizeValue ?? 2048 : null,
      maxFileKb: s.format === "jpeg" && capSize ? s.maxFileKb ?? 1024 : null,
      watermarkText: s.watermarkText?.trim() || null,
    };
    try {
      const done = await runExport(ids, effective, (d, t) => setProgress(`Exporting ${d}/${t}…`));
      // Remember for "Export with Previous".
      if (prefs) {
        const next = { ...prefs, lastExport: JSON.stringify(effective) };
        await setPrefs(next);
      }
      setProgress(`Exported ${done} ✓`);
      window.setTimeout(onClose, 1200);
    } catch (err) {
      console.error("export failed:", err);
      setProgress("Failed (see console)");
    }
  };

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-card settings-card export-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          Export {ids.length} photo{ids.length === 1 ? "" : "s"}
        </h2>

        {prefs && prefs.exportPresets.length > 0 && (
          <label className="pref-row">
            Preset
            <select defaultValue="" onChange={(e) => e.target.value && applyPreset(e.target.value)}>
              <option value="">— choose —</option>
              {prefs.exportPresets.map((p) => (
                <option key={p.name} value={p.options}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <h3>Destination</h3>
        <div className="actions" style={{ marginTop: 4 }}>
          <button onClick={() => void pickDest()}>Choose folder…</button>
          <span className="pref-path">{s.dest || "No folder selected"}</span>
        </div>

        <h3>File Naming</h3>
        <label className="pref-row">
          Pattern
          <input
            type="text"
            className="wide"
            value={s.pattern}
            onChange={(e) => patch({ pattern: e.target.value })}
          />
        </label>
        <p className="panel-muted">
          Tokens: {"{name}"} · {"{seq}"} · {"{date}"}. Preview:{" "}
          {ids[0] ? `${resolveExportName(s, ids[0], 1)}.${EXPORT_EXT[s.format]}` : "—"}
        </p>

        <h3>File Settings</h3>
        <label className="pref-row">
          Format
          <select
            value={s.format}
            onChange={(e) => patch({ format: e.target.value as ExportSettings["format"] })}
          >
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="tiff">TIFF</option>
            <option value="original">Original (DNG/RAW copy + XMP edits)</option>
          </select>
          {s.format === "jpeg" && (
            <>
              Quality
              <input
                type="number"
                min={50}
                max={100}
                value={s.quality}
                onChange={(e) =>
                  patch({ quality: Math.min(100, Math.max(50, +e.target.value || 90)) })
                }
              />
            </>
          )}
        </label>
        {s.format === "original" ? (
          <p className="panel-muted">
            Verbatim file copy — a DNG stays a DNG at full quality; your edits travel
            in the XMP sidecar instead of baking in.
          </p>
        ) : (
          <label className="pref-row">
            Color Space
            <select
              value={s.colorSpace}
              disabled={s.format === "tiff"}
              title={
                s.format === "tiff"
                  ? "TIFF exports are untagged sRGB for now"
                  : "Profile is embedded; AdobeRGB converts at encode time"
              }
              onChange={(e) =>
                patch({ colorSpace: e.target.value as ExportSettings["colorSpace"] })
              }
            >
              <option value="srgb">sRGB (display / web)</option>
              <option value="adobergb">AdobeRGB (1998) — print</option>
            </select>
          </label>
        )}

        {s.format !== "original" && (
          <>
        <h3>Image Sizing</h3>
        <label className="pref-row">
          <input type="checkbox" checked={resize} onChange={(e) => setResize(e.target.checked)} />
          Resize to fit
          {resize && (
            <>
              <select
                value={s.resizeMode}
                onChange={(e) => patch({ resizeMode: e.target.value as ExportSettings["resizeMode"] })}
              >
                <option value="long">Long edge (px)</option>
                <option value="short">Short edge (px)</option>
                <option value="megapixels">Megapixels (×0.01)</option>
              </select>
              <input
                type="number"
                min={1}
                max={100000}
                value={s.resizeValue ?? 2048}
                onChange={(e) => patch({ resizeValue: Math.max(1, +e.target.value || 2048) })}
              />
            </>
          )}
        </label>
        {s.format === "jpeg" && (
          <label className="pref-row">
            <input type="checkbox" checked={capSize} onChange={(e) => setCapSize(e.target.checked)} />
            Limit file size to
            {capSize && (
              <input
                type="number"
                min={50}
                max={100000}
                value={s.maxFileKb ?? 1024}
                onChange={(e) => patch({ maxFileKb: Math.max(50, +e.target.value || 1024) })}
              />
            )}
            {capSize && "KB (quality steps down to fit)"}
          </label>
        )}

        <h3>Output Sharpening</h3>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={s.outputSharpen}
            onChange={(e) => patch({ outputSharpen: e.target.checked })}
          />
          Sharpen for screen (applied after resize)
        </label>

        <h3>Watermarking</h3>
        <label className="pref-row">
          Text
          <input
            type="text"
            className="wide"
            placeholder="© Your Name (empty = none)"
            value={s.watermarkText ?? ""}
            onChange={(e) => patch({ watermarkText: e.target.value })}
          />
          <select
            value={s.watermarkAnchor}
            onChange={(e) => patch({ watermarkAnchor: e.target.value as ExportSettings["watermarkAnchor"] })}
          >
            <option value="br">Bottom right</option>
            <option value="bl">Bottom left</option>
            <option value="tr">Top right</option>
            <option value="tl">Top left</option>
            <option value="center">Center</option>
          </select>
        </label>

        <h3>Metadata</h3>
        <label className="pref-row">
          <select disabled value="none" title="Embedding copyright/EXIF into exports is planned">
            <option value="none">None — strip everything (EXIF, GPS, serials)</option>
          </select>
        </label>
          </>
        )}

        <div className="actions" style={{ marginTop: 14 }}>
          <button onClick={() => void run()} disabled={!s.dest || ids.length === 0 || !!progress}>
            {progress ?? "Export"}
          </button>
          <div className="inline-add" style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="Save as preset…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button onClick={() => void savePreset()} disabled={!presetName.trim()}>
              Save
            </button>
          </div>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
