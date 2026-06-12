import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";

/**
 * the classic editor's Catalog panel: virtual sources that aren't folders.
 * "All Photographs" and "Previous Import" (this session's last scan).
 */
export function CatalogPanel() {
  const total = useCatalogStore((s) => s.images.length);
  const lastImportCount = useCatalogStore((s) => s.lastImportIds.length);
  const source = useCatalogStore((s) => s.filter.source);
  const setFilter = useCatalogStore((s) => s.setFilter);

  return (
    <PanelSection title="Catalog">
      <ul className="source-list">
        <li
          className={source.kind === "all" ? "active" : ""}
          onClick={() => setFilter({ source: { kind: "all" } })}
        >
          <span className="fname">All Photographs</span>
          <span className="fcount">{total}</span>
        </li>
        <li
          className={`${source.kind === "previousImport" ? "active" : ""} ${
            lastImportCount === 0 ? "disabled" : ""
          }`}
          onClick={() =>
            lastImportCount > 0 && setFilter({ source: { kind: "previousImport" } })
          }
        >
          <span className="fname">Previous Import</span>
          <span className="fcount">{lastImportCount}</span>
        </li>
      </ul>
    </PanelSection>
  );
}
