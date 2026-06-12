import { useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useDevelopStore } from "@/store/developStore";
import { deleteSnapshot, listSnapshots, saveSnapshot } from "@/api/commands";
import type { Snapshot } from "@/types/models";

/**
 * Per-image snapshots: capture the complete current state (including crop)
 * under a name; click to restore it later. The history log keeps recording,
 * so restores are undoable.
 */
export function SnapshotsPanel() {
  const imageId = useDevelopStore((s) => s.imageId);
  const params = useDevelopStore((s) => s.params);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!imageId) {
      setSnapshots([]);
      return;
    }
    void listSnapshots(imageId).then(setSnapshots).catch(console.error);
  }, [imageId]);

  const capture = async () => {
    if (!imageId || busy) return;
    setBusy(true);
    try {
      const name = new Date().toLocaleString();
      await saveSnapshot(imageId, name, params);
      setSnapshots(await listSnapshots(imageId));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (snap: Snapshot) => {
    setMany(snap.params);
    await commit(`Snapshot: ${snap.name}`);
  };

  const remove = async (id: number) => {
    if (!imageId) return;
    await deleteSnapshot(id);
    setSnapshots(await listSnapshots(imageId));
  };

  return (
    <PanelSection title="Snapshots" defaultOpen={false}>
      {snapshots.length === 0 ? (
        <p className="panel-muted">No snapshots for this photo.</p>
      ) : (
        <ul className="named-list">
          {snapshots.map((s) => (
            <li key={s.id} onClick={() => void restore(s)} title="Restore snapshot">
              <span className="fname">{s.name}</span>
              <button
                className="row-delete"
                title="Delete snapshot"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(s.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => void capture()} disabled={!imageId || busy}>
          + Snapshot
        </button>
      </div>
    </PanelSection>
  );
}
