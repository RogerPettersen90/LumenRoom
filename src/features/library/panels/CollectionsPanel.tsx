import { useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  getPrefs,
  listCollections,
  publishCollection,
  removeFromCollection,
  setPublishConfig,
} from "@/api/commands";
import type { Collection } from "@/types/models";

/**
 * Collections (virtual albums). Click to browse one; ⊕ adds the current
 * selection; when browsing a collection, ⊖ removes the selection from it.
 */
export function CollectionsPanel() {
  const selection = useCatalogStore((s) => s.selection);
  const source = useCatalogStore((s) => s.filter.source);
  const selectCollection = useCatalogStore((s) => s.selectCollection);
  const refreshMembers = useCatalogStore((s) => s.refreshCollectionMembers);
  const setFilter = useCatalogStore((s) => s.setFilter);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [name, setName] = useState("");

  const refresh = async () => setCollections(await listCollections());

  useEffect(() => {
    void refresh().catch(console.error);
  }, []);

  const activeId = source.kind === "collection" ? source.id : null;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createCollection(trimmed);
    setName("");
    await refresh();
  };

  const addSelected = async (c: Collection) => {
    if (selection.length === 0) return;
    await addToCollection(c.id, selection);
    await refresh();
    await refreshMembers();
  };

  const removeSelected = async (c: Collection) => {
    if (selection.length === 0) return;
    await removeFromCollection(c.id, selection);
    await refresh();
    await refreshMembers();
  };

  const remove = async (c: Collection) => {
    await deleteCollection(c.id);
    if (activeId === c.id) setFilter({ source: { kind: "all" } });
    await refresh();
  };

  const [publishing, setPublishing] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** First publish configures the folder (options seeded from the last
   * export); afterwards it's one click to sync new/changed/removed. */
  const publish = async (c: Collection) => {
    try {
      if (!c.publishDir) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const dir = await open({
          directory: true,
          multiple: false,
          title: `Publish "${c.name}" to…`,
        });
        if (typeof dir !== "string") return;
        const prefs = await getPrefs();
        await setPublishConfig(c.id, dir, prefs.lastExport ?? "{}");
      }
      setPublishing(c.id);
      const r = await publishCollection(c.id);
      setNote(`${c.name}: ${r.exported} exported · ${r.skipped} current · ${r.removed} retracted`);
      await refresh();
    } catch (err) {
      setNote(String(err));
    } finally {
      setPublishing(null);
    }
  };

  return (
    <PanelSection title="Collections">
      {collections.length === 0 ? (
        <p className="panel-muted">No collections yet.</p>
      ) : (
        <ul className="named-list">
          {collections.map((c) => (
            <li
              key={c.id}
              className={activeId === c.id ? "active" : ""}
              onClick={() => void selectCollection(c)}
              title={`Browse "${c.name}"`}
            >
              <span className="fname">{c.name}</span>
              <span className="row-actions">
                {selection.length > 0 && (
                  <button
                    className="row-icon"
                    title={`Add ${selection.length} selected`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void addSelected(c);
                    }}
                  >
                    ⊕
                  </button>
                )}
                {selection.length > 0 && activeId === c.id && (
                  <button
                    className="row-icon"
                    title="Remove selected from this collection"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeSelected(c);
                    }}
                  >
                    ⊖
                  </button>
                )}
                <button
                  className="row-icon"
                  title={
                    c.publishDir
                      ? `Publish to ${c.publishDir}`
                      : "Publish to folder… (pick destination)"
                  }
                  disabled={publishing !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void publish(c);
                  }}
                >
                  {publishing === c.id ? "…" : "⇪"}
                </button>
                <button
                  className="row-delete"
                  title="Delete collection"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(c);
                  }}
                >
                  ✕
                </button>
              </span>
              <span className="fcount">{c.count}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="panel-muted">{note}</p>}
      <div className="inline-add">
        <input
          type="text"
          placeholder="New collection…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <button onClick={() => void create()} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </PanelSection>
  );
}
