import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getPrefs } from "@/api/commands";
import { useCatalogStore } from "@/store/catalogStore";

interface ImportDialogProps {
  onClose: () => void;
}

type Mode = "add" | "copy" | "move";

/**
 * The Import dialog (the classic ingestion gate): source folder, handling mode
 * (Add / Copy / Move), destination for transfers, subfolder inclusion.
 * Sidecars travel with their photos on Copy/Move; preview building follows
 * the preference (Settings → Performance).
 */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const importDirectory = useCatalogStore((s) => s.importDirectory);

  const [source, setSource] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("add");
  const [dest, setDest] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);

  useEffect(() => {
    void getPrefs()
      .then((p) => setRecursive(p.importRecursive))
      .catch(() => undefined);
  }, []);

  const pick = async (set: (v: string) => void, title: string) => {
    const dir = await open({ directory: true, multiple: false, title });
    if (typeof dir === "string") set(dir);
  };

  const ready = source !== null && (mode === "add" || dest !== null);

  const run = () => {
    if (!ready || !source) return;
    // Import streams progress into the top bar; close the dialog immediately.
    void importDirectory(source, recursive, mode, dest ?? undefined);
    onClose();
  };

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-card settings-card" onClick={(e) => e.stopPropagation()}>
        <h2>Import Photos</h2>

        <h3>Source</h3>
        <div className="actions" style={{ marginTop: 4 }}>
          <button onClick={() => void pick(setSource, "Import from folder")}>
            Choose source…
          </button>
          <span className="pref-path">{source ?? "No folder selected"}</span>
        </div>
        <label className="pref-row">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          Include subfolders
        </label>

        <h3>File Handling</h3>
        <div className="seg" style={{ marginBottom: 8 }}>
          {(["add", "copy", "move"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m === "add" ? "Add" : m === "copy" ? "Copy" : "Move"}
            </button>
          ))}
        </div>
        <p className="panel-muted">
          {mode === "add" &&
            "Index the photos where they are — nothing on disk is touched."}
          {mode === "copy" &&
            "Copy the photos (and their .xmp sidecars) into the destination, then index the copies. Originals stay put."}
          {mode === "move" &&
            "⚠ Move the photos out of the source folder into the destination. The source files will no longer be there afterwards."}
        </p>

        {mode !== "add" && (
          <>
            <h3>Destination</h3>
            <div className="actions" style={{ marginTop: 4 }}>
              <button onClick={() => void pick(setDest, "Destination folder")}>
                Choose destination…
              </button>
              <span className="pref-path">{dest ?? "No folder selected"}</span>
            </div>
          </>
        )}

        <div className="actions" style={{ marginTop: 14 }}>
          <button onClick={run} disabled={!ready}>
            {mode === "move" ? "Move & Import" : "Import"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
