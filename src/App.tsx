import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ImageMeta } from "@/types/models";
import { useCatalogStore } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { LibraryView } from "@/features/library/LibraryView";
import { LibraryLeftPanels } from "@/features/library/LibraryLeftPanels";
import { LibraryRightPanels } from "@/features/library/LibraryRightPanels";
import { DevelopView } from "@/features/develop/DevelopView";
import { DevelopLeftPanels } from "@/features/develop/DevelopLeftPanels";
import { DevelopRightPanels } from "@/features/develop/DevelopRightPanels";
import { Filmstrip } from "@/features/library/Filmstrip";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { ContextMenu } from "@/components/ContextMenu";
import { SettingsModal } from "@/components/SettingsModal";
import { ExportDialog } from "@/features/library/ExportDialog";
import { ImportDialog } from "@/features/library/ImportDialog";
import {
  broadcastToSecond,
  rememberBroadcast,
  SecondWindowView,
} from "@/features/library/SecondWindow";

/**
 * The the classic editor five-zone shell:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ identity plate            …    module picker │
 *   ├────────┬───────────────────────────┬─────────┤
 *   │ left   │     center work area      │ right   │
 *   │ panels │  (per-module content)     │ panels  │
 *   ├────────┴───────────────────────────┴─────────┤
 *   │ filmstrip (persistent across all modules)    │
 *   └──────────────────────────────────────────────┘
 *
 * Tab toggles the side panel groups; Shift+Tab also toggles the filmstrip.
 */
// Booted with ?second=1 this webview IS the second window: a clean Loupe
// driven entirely by events from the main window (no shared JS state).
const IS_SECOND_WINDOW = new URLSearchParams(window.location.search).has("second");

export default function App() {
  if (IS_SECOND_WINDOW) return <SecondWindowView />;
  return <MainApp />;
}

function MainApp() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const leftPanelOpen = useUiStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const filmstripOpen = useUiStore((s) => s.filmstripOpen);
  const lightsOut = useUiStore((s) => s.lightsOut);
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  const toggleShortcuts = useUiStore((s) => s.toggleShortcuts);
  const contextMenu = useUiStore((s) => s.contextMenu);
  const closeContextMenu = useUiStore((s) => s.closeContextMenu);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const toggleSettings = useUiStore((s) => s.toggleSettings);
  const exportOpen = useUiStore((s) => s.exportOpen);
  const setExportOpen = useUiStore((s) => s.setExportOpen);
  const importOpen = useUiStore((s) => s.importOpen);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const scanning = useUiStore((s) => s.scanning);
  const scanDone = useUiStore((s) => s.scanDone);
  const scanTotal = useUiStore((s) => s.scanTotal);

  const load = useCatalogStore((s) => s.load);
  const hasImages = useCatalogStore((s) => s.images.length > 0);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const openDevelop = useDevelopStore((s) => s.open);

  useKeyboardShortcuts();

  // Hydrate the catalog from SQLite on launch (+ seed the RAW decode mode
  // so 1:1 preview URLs reflect the active pref).
  useEffect(() => {
    void load();
    void import("@/api/commands").then(({ getPrefs }) =>
      getPrefs().then((p) =>
        import("@/api/protocol").then(({ setRawDecodeMode }) =>
          setRawDecodeMode(p.rawDecode)
        )
      )
    ).catch(() => undefined);
  }, [load]);

  // Neighbor prefetch: pre-bake develop proxies around the selection so
  // arrow-stepping never waits on preview generation (debounced).
  useEffect(() => {
    if (!selectedId) return;
    const t = window.setTimeout(() => {
      const { visible } = useCatalogStore.getState();
      const idx = visible.findIndex((i) => i.id === selectedId);
      if (idx < 0) return;
      const around = [idx + 1, idx - 1, idx + 2, idx - 2]
        .filter((i) => i >= 0 && i < visible.length)
        .map((i) => visible[i].id);
      around.push(selectedId);
      void import("@/api/commands").then(({ prefetchPreviews }) => prefetchPreviews(around));
    }, 250);
    return () => window.clearTimeout(t);
  }, [selectedId]);

  // Auto-Import: photos dropped into the watched folder stream in live.
  useEffect(() => {
    const un = listen<ImageMeta>("auto-import", (e) => {
      useCatalogStore.getState().addImported(e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Second window follows the active photo (F11 toggles the window).
  useEffect(() => {
    const img = selectedId ? useCatalogStore.getState().byId[selectedId] : null;
    const payload = img ? { id: img.id, filename: img.filename } : null;
    rememberBroadcast(payload);
    broadcastToSecond(payload);
  }, [selectedId]);

  const enterDevelop = () => {
    if (selectedId) {
      void openDevelop(selectedId);
      setMode("develop");
    }
  };

  const pct = scanTotal > 0 ? Math.round((scanDone / scanTotal) * 100) : 0;

  return (
    <div
      className={`app ${lightsOut === 1 ? "lights-dim" : lightsOut === 2 ? "lights-off" : ""}`}
      // Custom menus only — never the webview's default.
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="topbar">
        <span className="brand">LumenRoom</span>

        <div className="spacer" />

        {scanning && (
          <div className="scanbar">
            <span>
              Importing {scanDone}/{scanTotal}
            </span>
            <div className="track">
              <div className="fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <button className="gear" onClick={toggleSettings} title="Preferences (Ctrl+,)">
          ⚙
        </button>

        {/* Module picker, top-right like the classic editors. */}
        <nav className="module-picker">
          <button
            className={mode === "library" ? "active" : ""}
            onClick={() => setMode("library")}
            title="Library (G)"
          >
            Library
          </button>
          <button
            className={mode === "develop" ? "active" : ""}
            onClick={enterDevelop}
            disabled={!selectedId}
            title="Develop (D)"
          >
            Develop
          </button>
        </nav>
      </header>

      <div className="main-row">
        {leftPanelOpen && (
          <aside className="panel-group left">
            {mode === "library" ? <LibraryLeftPanels /> : <DevelopLeftPanels />}
          </aside>
        )}

        <main
          className="center"
          onPointerDown={() =>
            useUiStore.getState().setFocusContext(mode === "library" ? "library" : "develop")
          }
        >
          {mode === "library" ? <LibraryView /> : <DevelopView />}
        </main>

        {rightPanelOpen && (
          <aside className="panel-group right">
            {mode === "library" ? <LibraryRightPanels /> : <DevelopRightPanels />}
          </aside>
        )}
      </div>

      {filmstripOpen && hasImages && <Filmstrip />}
      {shortcutsOpen && <ShortcutsOverlay onClose={toggleShortcuts} />}
      {settingsOpen && <SettingsModal onClose={toggleSettings} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
