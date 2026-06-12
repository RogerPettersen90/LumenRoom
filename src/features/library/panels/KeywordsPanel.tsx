import { useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";
import { addKeyword, imageKeywords, listKeywords, removeKeyword } from "@/api/commands";
import type { Keyword } from "@/types/models";

/**
 * Keywording + Keyword List (the classic two panels merged): tag the selected
 * photo(s), and click any keyword below to filter the whole catalog by it.
 */
export function KeywordsPanel() {
  const selectedId = useCatalogStore((s) => s.selectedId);
  const selection = useCatalogStore((s) => s.selection);
  const keywordFilter = useCatalogStore((s) => s.filter.keyword);
  const setKeywordFilter = useCatalogStore((s) => s.setKeywordFilter);

  const [chips, setChips] = useState<Keyword[]>([]);
  const [all, setAll] = useState<Keyword[]>([]);
  const [input, setInput] = useState("");

  const refresh = async () => {
    setAll(await listKeywords());
    setChips(selectedId ? await imageKeywords(selectedId) : []);
  };

  useEffect(() => {
    void refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const targets = selection.length > 0 ? selection : selectedId ? [selectedId] : [];

  const add = async () => {
    const name = input.trim();
    if (!name || targets.length === 0) return;
    await addKeyword(targets, name);
    setInput("");
    await refresh();
  };

  const removeChip = async (k: Keyword) => {
    if (!selectedId) return;
    await removeKeyword(selectedId, k.id);
    await refresh();
  };

  return (
    <PanelSection title="Keywording" defaultOpen={false}>
      {selectedId ? (
        <>
          <div className="chip-row">
            {chips.length === 0 && <span className="panel-muted">No keywords.</span>}
            {chips.map((k) => (
              <span className="chip" key={k.id}>
                {k.name}
                <button className="chip-x" onClick={() => void removeChip(k)} title="Remove">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="inline-add">
            <input
              type="text"
              placeholder={targets.length > 1 ? `Tag ${targets.length} photos…` : "Add keyword…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <button onClick={() => void add()} disabled={!input.trim()}>
              Add
            </button>
          </div>
        </>
      ) : (
        <p className="panel-muted">Select a photo to tag it.</p>
      )}

      {all.length > 0 && (
        <>
          <h4 className="kw-list-title">Keyword List</h4>
          <ul className="named-list">
            {flattenTree(all).map(({ kw: k, depth }) => (
              <li
                key={k.id}
                className={keywordFilter?.id === k.id ? "active" : ""}
                style={depth > 0 ? { paddingLeft: 10 + depth * 14 } : undefined}
                onClick={() =>
                  void setKeywordFilter(keywordFilter?.id === k.id ? null : k)
                }
                title="Filter by keyword (parents include children)"
              >
                <span className="fname">
                  {depth > 0 && <span className="kw-twig">└ </span>}
                  {k.name}
                </span>
                <span className="fcount">{k.count}</span>
              </li>
            ))}
          </ul>
          <p className="panel-muted">Tip: “Travel &gt; Norway” nests keywords.</p>
        </>
      )}
    </PanelSection>
  );
}

/** Roots-first depth walk so the list renders as an indented tree. */
function flattenTree(all: Keyword[]): Array<{ kw: Keyword; depth: number }> {
  const byParent = new Map<number | null, Keyword[]>();
  const ids = new Set(all.map((k) => k.id));
  for (const k of all) {
    // Treat dangling parents (filtered out / race) as roots.
    const key = k.parentId !== null && ids.has(k.parentId) ? k.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(k);
    byParent.set(key, list);
  }
  const out: Array<{ kw: Keyword; depth: number }> = [];
  const walk = (parent: number | null, depth: number) => {
    for (const k of byParent.get(parent) ?? []) {
      out.push({ kw: k, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
