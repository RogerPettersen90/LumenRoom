import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import { ThumbGrid } from "./ThumbGrid";
import { LoupeView } from "./LoupeView";
import { CompareView } from "./CompareView";
import { SurveyView } from "./SurveyView";
import { FilterBar } from "./FilterBar";
import { Toolbar } from "./Toolbar";
import { importFolder } from "./importFolder";

/**
 * Library module, center work area: Filter bar (grid view) + Grid/Loupe/Survey
 * + the toolbar strip. The side panel groups and filmstrip live in the shell.
 */
export function LibraryView() {
  const images = useCatalogStore((s) => s.images);
  const visible = useCatalogStore((s) => s.visible);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const selection = useCatalogStore((s) => s.selection);
  const select = useCatalogStore((s) => s.select);
  const toggleSelect = useCatalogStore((s) => s.toggleSelect);
  const rangeSelect = useCatalogStore((s) => s.rangeSelect);
  const libraryView = useUiStore((s) => s.libraryView);
  const setLibraryView = useUiStore((s) => s.setLibraryView);
  const toolbarOpen = useUiStore((s) => s.toolbarOpen);

  if (images.length === 0) {
    return (
      <div className="center-empty">
        <div className="empty">
          <p>Your catalog is empty.</p>
          <button onClick={() => void importFolder()}>Import a folder…</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {libraryView === "grid" && <FilterBar />}
      <div className="work-area">
        {libraryView === "loupe" ? (
          <LoupeView />
        ) : libraryView === "compare" ? (
          <CompareView />
        ) : libraryView === "survey" ? (
          <SurveyView />
        ) : (
          <div className="library">
            {visible.length === 0 ? (
              <div className="empty">
                <p>No photos match the current filter.</p>
              </div>
            ) : (
              <ThumbGrid
                images={visible}
                selectedId={selectedId}
                selection={selection}
                onSelect={select}
                onToggle={toggleSelect}
                onRange={rangeSelect}
                onOpen={(id) => {
                  select(id);
                  setLibraryView("loupe");
                }}
              />
            )}
          </div>
        )}
      </div>
      {toolbarOpen && <Toolbar />}
    </>
  );
}
