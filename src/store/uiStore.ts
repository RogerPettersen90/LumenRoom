import { create } from "zustand";
import type { MenuItem } from "@/components/ContextMenu";

export type Mode = "library" | "develop";
// Library, in the classic layout: Grid (G), Loupe (E), Compare (C), Survey (N).
export type LibraryView = "grid" | "loupe" | "compare" | "survey";

interface UiState {
  mode: Mode;
  libraryView: LibraryView;
  setMode: (mode: Mode) => void;
  setLibraryView: (view: LibraryView) => void;

  /**
   * Compare view's pinned "Select" image. The Candidate is the catalog's
   * regular active selection, so arrows/culling keys drive it for free.
   */
  compareSelectId: string | null;
  setCompareSelect: (id: string | null) => void;

  shortcutsOpen: boolean;
  toggleShortcuts: () => void;
  settingsOpen: boolean;
  toggleSettings: () => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;

  /** Which region last received pointer focus — keyboard shortcuts that are
   * context-sensitive (Ctrl+A) consult this. */
  focusContext: "library" | "develop" | "filmstrip";
  setFocusContext: (ctx: "library" | "develop" | "filmstrip") => void;

  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  openContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeContextMenu: () => void;

  // classic-style chrome: collapsible side panel groups + filmstrip.
  leftPanelOpen: boolean;   // F7
  rightPanelOpen: boolean;  // F8
  filmstripOpen: boolean;   // F6
  toolbarOpen: boolean;     // T
  /** Tab = side panels; Shift+Tab = panels + filmstrip together. */
  togglePanels: (includeFilmstrip: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleFilmstrip: () => void;
  toggleToolbar: () => void;

  /** Lights Out (L): 0 normal · 1 dim chrome · 2 black out chrome. */
  lightsOut: number;
  cycleLightsOut: () => void;

  /** Info overlay (I) in Loupe/Develop. */
  infoOverlay: boolean;
  toggleInfoOverlay: () => void;

  // Grid thumbnail size (toolbar slider), in px of the cell's minimum width.
  thumbSize: number;
  setThumbSize: (px: number) => void;

  /**
   * Painter tool (the classic spray can, grid only): while armed, clicking a thumb
   * applies the payload instead of selecting. value: rating "1".."5",
   * flag "pick"|"reject", label color name, or keyword text.
   */
  painter: { kind: "rating" | "flag" | "label" | "keyword"; value: string } | null;
  setPainter: (p: UiState["painter"]) => void;

  // Scan progress banner state.
  scanning: boolean;
  scanDone: number;
  scanTotal: number;
  setScan: (s: { scanning: boolean; done?: number; total?: number }) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "library",
  libraryView: "grid",
  setMode: (mode) => set({ mode }),
  setLibraryView: (libraryView) => set({ libraryView, mode: "library" }),

  compareSelectId: null,
  setCompareSelect: (compareSelectId) => set({ compareSelectId }),

  shortcutsOpen: false,
  toggleShortcuts: () => set((s) => ({ shortcutsOpen: !s.shortcutsOpen })),
  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  importOpen: false,
  setImportOpen: (importOpen) => set({ importOpen }),

  focusContext: "library",
  setFocusContext: (focusContext) => set({ focusContext }),

  contextMenu: null,
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),

  leftPanelOpen: true,
  rightPanelOpen: true,
  filmstripOpen: true,
  toolbarOpen: true,
  togglePanels: (includeFilmstrip) =>
    set((s) => {
      const open = !(s.leftPanelOpen || s.rightPanelOpen);
      return {
        leftPanelOpen: open,
        rightPanelOpen: open,
        filmstripOpen: includeFilmstrip ? open : s.filmstripOpen,
      };
    }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleFilmstrip: () => set((s) => ({ filmstripOpen: !s.filmstripOpen })),
  toggleToolbar: () => set((s) => ({ toolbarOpen: !s.toolbarOpen })),

  lightsOut: 0,
  cycleLightsOut: () => set((s) => ({ lightsOut: (s.lightsOut + 1) % 3 })),

  infoOverlay: false,
  toggleInfoOverlay: () => set((s) => ({ infoOverlay: !s.infoOverlay })),

  thumbSize: 180,
  setThumbSize: (thumbSize) => set({ thumbSize }),

  painter: null,
  setPainter: (painter) => set({ painter }),

  scanning: false,
  scanDone: 0,
  scanTotal: 0,
  setScan: ({ scanning, done, total }) =>
    set((s) => ({
      scanning,
      scanDone: done ?? s.scanDone,
      scanTotal: total ?? s.scanTotal,
    })),
}));
