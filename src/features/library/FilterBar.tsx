import { useMemo } from "react";
import { useCatalogStore } from "@/store/catalogStore";
import type { FlagFilter } from "@/store/catalogStore";
import type { ColorLabel } from "@/types/models";

const FLAGS: { key: FlagFilter; label: string; title: string }[] = [
  { key: "all", label: "All", title: "All photos" },
  { key: "pick", label: "⚑ Picks", title: "Flagged as pick" },
  { key: "reject", label: "⚑ Rejects", title: "Flagged as reject" },
  { key: "unflagged", label: "Unflagged", title: "No flag" },
];

const LABELS: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];

/**
 * Library Filter bar (Attribute filtering): flag, minimum rating, and color
 * label. Drives the catalog's `visible` set, so the grid, filmstrip, and
 * arrow-navigation all honour it. (Text and Metadata tabs arrive in Phase 4.)
 */
export function FilterBar() {
  const filter = useCatalogStore((s) => s.filter);
  const setFilter = useCatalogStore((s) => s.setFilter);
  const setKeywordFilter = useCatalogStore((s) => s.setKeywordFilter);
  const visibleCount = useCatalogStore((s) => s.visible.length);
  const totalCount = useCatalogStore((s) => s.images.length);
  const images = useCatalogStore((s) => s.images);

  // Distinct cameras/lenses present in the catalog (the classic Metadata columns).
  const cameras = useMemo(
    () => [...new Set(images.map((i) => i.cameraModel).filter(Boolean))].sort() as string[],
    [images]
  );
  const lenses = useMemo(
    () => [...new Set(images.map((i) => i.lens).filter(Boolean))].sort() as string[],
    [images]
  );

  return (
    <div className="filterbar">
      <span className="filterbar-title">Library Filter:</span>

      <input
        type="search"
        className="filter-text"
        placeholder="Search name / camera / lens…"
        value={filter.text}
        onChange={(e) => setFilter({ text: e.target.value })}
      />

      <div className="seg">
        {FLAGS.map((f) => (
          <button
            key={f.key}
            className={filter.flag === f.key ? "active" : ""}
            onClick={() => setFilter({ flag: f.key })}
            title={f.title}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rating-filter" title="Minimum rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={`star ${n <= filter.minRating ? "on" : ""}`}
            // Click the active threshold again to clear it.
            onClick={() => setFilter({ minRating: filter.minRating === n ? 0 : n })}
          >
            ★
          </span>
        ))}
        {filter.minRating > 0 && <span className="suffix">+</span>}
      </div>

      <div className="label-filter" title="Color label">
        {LABELS.map((l) => (
          <span
            key={l}
            className={`swatch swatch-${l} ${filter.label === l ? "on" : ""}`}
            onClick={() => setFilter({ label: filter.label === l ? null : l })}
          />
        ))}
      </div>

      {cameras.length > 1 && (
        <select
          value={filter.camera ?? ""}
          onChange={(e) => setFilter({ camera: e.target.value || null })}
          title="Filter by camera"
        >
          <option value="">All cameras</option>
          {cameras.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      {lenses.length > 1 && (
        <select
          value={filter.lens ?? ""}
          onChange={(e) => setFilter({ lens: e.target.value || null })}
          title="Filter by lens"
        >
          <option value="">All lenses</option>
          {lenses.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}

      {filter.keyword && (
        <span className="chip">
          {filter.keyword.name}
          <button className="chip-x" onClick={() => void setKeywordFilter(null)} title="Clear keyword filter">
            ✕
          </button>
        </span>
      )}

      <div className="spacer" />
      <span className="count">
        {visibleCount} of {totalCount}
      </span>
    </div>
  );
}
