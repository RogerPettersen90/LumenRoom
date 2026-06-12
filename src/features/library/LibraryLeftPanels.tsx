import { NavigatorPanel } from "./panels/NavigatorPanel";
import { CatalogPanel } from "./panels/CatalogPanel";
import { CollectionsPanel } from "./panels/CollectionsPanel";
import { SmartCollectionsPanel } from "./panels/SmartCollectionsPanel";
import { FoldersPanel } from "./FoldersPanel";
import { importFolder } from "./importFolder";
import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Library module, left panel group (classic order): Navigator · Catalog · Folders ·
 * Collections, with Import…/Export… pinned at the bottom. Export opens the
 * full Export dialog for the current selection.
 */
export function LibraryLeftPanels() {
  const hasSelection = useCatalogStore((s) => s.selection.length > 0 || s.selectedId !== null);
  const setExportOpen = useUiStore((s) => s.setExportOpen);

  return (
    <>
      <div className="panel-scroll">
        <NavigatorPanel />
        <CatalogPanel />
        <FoldersPanel />
        <CollectionsPanel />
        <SmartCollectionsPanel />
      </div>
      <div className="panel-footer">
        <button onClick={() => void importFolder()}>Import…</button>
        <button
          onClick={() => setExportOpen(true)}
          disabled={!hasSelection}
          title="Export the selected photos with their edits"
        >
          Export…
        </button>
      </div>
    </>
  );
}
