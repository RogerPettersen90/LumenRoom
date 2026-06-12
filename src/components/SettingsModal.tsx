import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Overrides } from "@/hooks/keymap";
import { boundKey, loadOverrides, REMAP_ACTIONS, saveOverrides } from "@/hooks/keymap";
import type { CatalogInfo, Prefs } from "@/api/commands";
import {
  catalogInfo,
  clearThumbnailCache,
  getPrefs,
  optimizeCatalog,
  setPrefs,
} from "@/api/commands";

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * Preferences (Ctrl+,) — structured after the classic editor's: General behaviours,
 * Performance/cache maintenance, and Catalog management. Changes persist
 * immediately to the config file.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [prefs, setLocal] = useState<Prefs | null>(null);
  const [info, setInfo] = useState<CatalogInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void getPrefs().then(setLocal).catch(console.error);
    void catalogInfo().then(setInfo).catch(console.error);
  }, []);

  const save = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setLocal(next);
    await setPrefs(next);
    if (patch.rawDecode !== undefined) {
      const { setRawDecodeMode } = await import("@/api/protocol");
      setRawDecodeMode(next.rawDecode);
    }
  };

  const pickCatalogDir = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Catalog folder" });
    if (typeof dir === "string") {
      await save({ catalogDir: dir });
      setNote("Catalog location saved — restart LumenRoom to switch.");
    }
  };

  const optimize = async () => {
    setNote("Optimizing…");
    await optimizeCatalog();
    setInfo(await catalogInfo());
    setNote("Catalog optimized ✓");
  };

  const clearCache = async () => {
    const freed = await clearThumbnailCache();
    setInfo(await catalogInfo());
    setNote(`Cleared ${fmtBytes(freed)} of previews (they regenerate as needed)`);
  };

  if (!prefs) return null;

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-card settings-card" onClick={(e) => e.stopPropagation()}>
        <h2>Preferences</h2>

        <h3>General</h3>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.autoXmp}
            onChange={(e) => void save({ autoXmp: e.target.checked })}
          />
          Automatically write XMP sidecars after edits
        </label>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.importRecursive}
            onChange={(e) => void save({ importRecursive: e.target.checked })}
          />
          Include subfolders when importing
        </label>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.autoImportEnabled}
            onChange={(e) => void save({ autoImportEnabled: e.target.checked })}
          />
          Auto-Import from watched folder
          <button
            onClick={() =>
              void open({ directory: true, multiple: false, title: "Watched folder" }).then(
                (dir) => {
                  if (typeof dir === "string") void save({ autoImportDir: dir });
                }
              )
            }
          >
            Choose…
          </button>
        </label>
        {prefs.autoImportDir && (
          <p className="pref-info">
            <span className="pref-path" title={prefs.autoImportDir}>
              Watching: {prefs.autoImportDir}
            </span>
          </p>
        )}
        <label className="pref-row">
          Export JPEG quality
          <input
            type="number"
            min={50}
            max={100}
            value={prefs.exportQuality}
            onChange={(e) =>
              void save({ exportQuality: Math.min(100, Math.max(50, +e.target.value || 90)) })
            }
          />
        </label>

        <h3>Performance</h3>
        <label className="pref-row">
          RAW decode quality
          <select
            value={prefs.rawDecode}
            onChange={(e) => void save({ rawDecode: e.target.value })}
          >
            <option value="embedded">Embedded preview (fast)</option>
            <option value="full">Full demosaic (native res, slow)</option>
          </select>
        </label>
        <label className="pref-row">
          Build previews on import
          <select
            value={prefs.previewBuild}
            onChange={(e) => void save({ previewBuild: e.target.value })}
          >
            <option value="minimal">Minimal (fastest import)</option>
            <option value="standard">Standard (2048px proxies)</option>
            <option value="full">1:1 (instant zoom, slow import)</option>
          </select>
        </label>
        {info && (
          <p className="pref-info">
            Preview cache: {fmtBytes(info.cacheBytes)}
            <button onClick={() => void clearCache()}>Clear</button>
          </p>
        )}

        <h3>Catalog</h3>
        {info && (
          <p className="pref-info">
            {info.imageCount} photos · {fmtBytes(info.dbBytes)}
            <span className="pref-path" title={info.dbPath}>
              {info.dbPath}
            </span>
          </p>
        )}
        <label className="pref-row">
          Keep rolling backups (made at launch)
          <input
            type="number"
            min={0}
            max={50}
            value={prefs.catalogBackups}
            onChange={(e) =>
              void save({ catalogBackups: Math.min(50, Math.max(0, +e.target.value || 0)) })
            }
          />
        </label>
        <div className="actions">
          <button onClick={() => void optimize()}>Optimize Catalog</button>
          <button onClick={() => void pickCatalogDir()}>Choose Catalog Folder…</button>
        </div>
        {prefs.catalogDir && (
          <p className="panel-muted">Custom catalog: {prefs.catalogDir} (applies on restart)</p>
        )}

        <h3>Shortcuts</h3>
        <p className="panel-muted">
          Press <kbd>?</kbd> anywhere for the reference. Click a key below, then press
          the new binding (Esc cancels).
        </p>
        <ShortcutRemap />

        <h3>About</h3>
        <p className="panel-muted">
          LumenRoom beta — free and open-source software, licensed under
          GPL-3.0-or-later. Includes lens calibration data from the lensfun
          project (CC-BY-SA 3.0), the DejaVu Sans font, and CC0 ICC profiles;
          the optional Select Subject model (U²-Net, Apache-2.0) is downloaded
          on first use and runs entirely on this machine. See
          THIRD-PARTY-LICENSES.md in the source distribution for the full
          list. LumenRoom is an independent project, not affiliated with or
          endorsed by Adobe Inc.
        </p>

        {note && <p className="pref-note">{note}</p>}
        <p className="panel-muted">Press Esc or click outside to close</p>
      </div>
    </div>
  );
}

/**
 * Remap table for the single-key shortcuts: click the key chip, press the new
 * key. Conflicts steal the binding (the other action reverts to default).
 */
function ShortcutRemap() {
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const [capturing, setCapturing] = useState<string | null>(null); // default key

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return; // letters only
      const next: Overrides = { ...overrides };
      const newKey = e.key.toLowerCase();
      // Steal the key from any action currently using it.
      for (const a of REMAP_ACTIONS) {
        if (boundKey(a.key, next) === newKey) delete next[a.key];
      }
      if (newKey === capturing) delete next[capturing];
      else next[capturing] = newKey;
      saveOverrides(next);
      setOverrides(next);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, overrides]);

  const reset = () => {
    saveOverrides({});
    setOverrides({});
  };

  return (
    <div className="remap">
      {REMAP_ACTIONS.map((a) => (
        <div className="remap-row" key={a.key}>
          <span className="remap-label">{a.label}</span>
          <kbd
            className={`remap-key ${capturing === a.key ? "capturing" : ""} ${
              overrides[a.key] ? "custom" : ""
            }`}
            title="Click, then press a new key"
            onClick={() => setCapturing(capturing === a.key ? null : a.key)}
          >
            {capturing === a.key ? "…" : boundKey(a.key, overrides).toUpperCase()}
          </kbd>
        </div>
      ))}
      {Object.keys(overrides).length > 0 && (
        <div className="actions">
          <button onClick={reset}>Reset All to Defaults</button>
        </div>
      )}
    </div>
  );
}

function fmtBytes(b: number): string {
  if (b > 1 << 30) return `${(b / (1 << 30)).toFixed(1)} GB`;
  if (b > 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
