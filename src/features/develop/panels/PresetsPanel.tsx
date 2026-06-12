import { useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useDevelopStore } from "@/store/developStore";
import { deletePreset, listPresets, savePreset } from "@/api/commands";
import type { Preset } from "@/types/models";
import { mergePreset, stripGeometry } from "@/types/models";

/**
 * Develop presets: click to apply a saved "look" (the photo's own crop/angle
 * is preserved), save the current settings under a name, hover-✕ to delete.
 */
export function PresetsPanel() {
  const params = useDevelopStore((s) => s.params);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listPresets().then(setPresets).catch(console.error);
  }, []);

  const apply = async (preset: Preset) => {
    setMany(mergePreset(params, preset.params));
    await commit(`Preset: ${preset.name}`);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await savePreset(trimmed, stripGeometry(params));
      setPresets(await listPresets());
      setName("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await deletePreset(id);
    setPresets(await listPresets());
  };

  return (
    <PanelSection title="Presets">
      {presets.length === 0 ? (
        <p className="panel-muted">No presets yet — dial in a look and save it.</p>
      ) : (
        <ul className="named-list">
          {presets.map((p) => (
            <li key={p.id} onClick={() => void apply(p)} title="Apply preset">
              <span className="fname">{p.name}</span>
              <button
                className="row-delete"
                title="Delete preset"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(p.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inline-add">
        <input
          type="text"
          placeholder="Preset name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button onClick={() => void save()} disabled={!name.trim() || busy}>
          Save
        </button>
      </div>
    </PanelSection>
  );
}
