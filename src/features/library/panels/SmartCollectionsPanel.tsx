import { useEffect, useMemo, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore, smartRulesMatch } from "@/store/catalogStore";
import type { SmartRules } from "@/store/catalogStore";
import type { ColorLabel } from "@/types/models";
import {
  deleteSmartCollection,
  listSmartCollections,
  saveSmartCollection,
} from "@/api/commands";
import type { SmartCollectionRow } from "@/api/commands";

/**
 * Smart Collections: rule-based virtual albums. Rules are stored as JSON and
 * evaluated live against the catalog, so membership updates the moment you
 * cull (rate/flag/label) a photo.
 */
export function SmartCollectionsPanel() {
  const images = useCatalogStore((s) => s.images);
  const source = useCatalogStore((s) => s.filter.source);
  const setFilter = useCatalogStore((s) => s.setFilter);

  const [rows, setRows] = useState<SmartCollectionRow[]>([]);
  const [building, setBuilding] = useState(false);
  const [name, setName] = useState("");
  const [rules, setRules] = useState<SmartRules>({});

  const refresh = async () => setRows(await listSmartCollections());
  useEffect(() => {
    void refresh().catch(console.error);
  }, []);

  const cameras = useMemo(
    () => [...new Set(images.map((i) => i.cameraModel).filter(Boolean))].sort() as string[],
    [images]
  );

  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of rows) {
      const parsed = safeRules(row.rules);
      map.set(row.id, images.filter((i) => smartRulesMatch(parsed, i)).length);
    }
    return map;
  }, [rows, images]);

  const browse = (row: SmartCollectionRow) => {
    setFilter({
      source: { kind: "smart", id: row.id, name: row.name, rules: safeRules(row.rules) },
    });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await saveSmartCollection(trimmed, JSON.stringify(rules));
    setName("");
    setRules({});
    setBuilding(false);
    await refresh();
  };

  const remove = async (row: SmartCollectionRow) => {
    await deleteSmartCollection(row.id);
    if (source.kind === "smart" && source.id === row.id) {
      setFilter({ source: { kind: "all" } });
    }
    await refresh();
  };

  const activeId = source.kind === "smart" ? source.id : null;

  return (
    <PanelSection title="Smart Collections" defaultOpen={false}>
      {rows.length === 0 && !building && (
        <p className="panel-muted">Rule-based albums that update themselves.</p>
      )}
      {rows.length > 0 && (
        <ul className="named-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className={activeId === row.id ? "active" : ""}
              onClick={() => browse(row)}
              title={describeRules(safeRules(row.rules))}
            >
              <span className="fname">⚙ {row.name}</span>
              <button
                className="row-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(row);
                }}
                title="Delete smart collection"
              >
                ✕
              </button>
              <span className="fcount">{counts.get(row.id) ?? 0}</span>
            </li>
          ))}
        </ul>
      )}

      {building ? (
        <div className="smart-builder">
          <input
            type="text"
            placeholder="Smart collection name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label>
            Rating ≥
            <select
              value={rules.minRating ?? ""}
              onChange={(e) =>
                setRules({ ...rules, minRating: e.target.value ? +e.target.value : undefined })
              }
            >
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Flag
            <select
              value={rules.flag ?? ""}
              onChange={(e) =>
                setRules({ ...rules, flag: (e.target.value || undefined) as SmartRules["flag"] })
              }
            >
              <option value="">Any</option>
              <option value="pick">Pick</option>
              <option value="reject">Reject</option>
              <option value="unflagged">Unflagged</option>
            </select>
          </label>
          <label>
            Label
            <select
              value={rules.label ?? ""}
              onChange={(e) =>
                setRules({ ...rules, label: (e.target.value || undefined) as ColorLabel })
              }
            >
              <option value="">Any</option>
              {["red", "yellow", "green", "blue", "purple"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {cameras.length > 1 && (
            <label>
              Camera
              <select
                value={rules.camera ?? ""}
                onChange={(e) => setRules({ ...rules, camera: e.target.value || undefined })}
              >
                <option value="">Any</option>
                {cameras.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Name contains
            <input
              type="text"
              value={rules.textContains ?? ""}
              onChange={(e) =>
                setRules({ ...rules, textContains: e.target.value || undefined })
              }
            />
          </label>
          <div className="actions">
            <button onClick={() => void create()} disabled={!name.trim()}>
              Save
            </button>
            <button onClick={() => setBuilding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button onClick={() => setBuilding(true)}>+ Smart Collection</button>
        </div>
      )}
    </PanelSection>
  );
}

function safeRules(json: string): SmartRules {
  try {
    return JSON.parse(json) as SmartRules;
  } catch {
    return {};
  }
}

function describeRules(r: SmartRules): string {
  const parts: string[] = [];
  if (r.minRating) parts.push(`★≥${r.minRating}`);
  if (r.flag) parts.push(r.flag);
  if (r.label) parts.push(r.label);
  if (r.camera) parts.push(r.camera);
  if (r.lens) parts.push(r.lens);
  if (r.textContains) parts.push(`"${r.textContains}"`);
  return parts.join(" · ") || "matches everything";
}
