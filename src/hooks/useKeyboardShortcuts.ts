import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCatalogStore } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";
import { useZoomStore } from "@/store/zoomStore";
import { enterCompare } from "@/features/library/enterCompare";
import { createVirtualCopy, exportSidecar, removeFromCatalog } from "@/api/commands";
import { remapKey } from "@/hooks/keymap";

/**
 * Global keyboard shortcuts modelled on the classic editor's:
 *
 *   G / E / C / N  Library Grid / Loupe / Compare / Survey
 *   D          Develop the selected image
 *   ← / →      Previous / next image (follows you into Develop)
 *   P / X / U  Flag pick / reject / unflag (applies to the whole selection)
 *   0–5        Star rating, 0 clears (applies to the whole selection)
 *   6–9        Color label red/yellow/green/blue (same key again clears)
 *   Tab        Hide/show side panels; Shift+Tab also hides the filmstrip
 *   Caps Lock  Auto-advance to the next photo after flagging/rating/labelling
 *
 * Reads stores imperatively (getState) so the listener is installed once and
 * never goes stale.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in form fields.
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;

      // ── Ctrl/Cmd combos (classic editor key bindings) ──
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const ui0 = useUiStore.getState();
        const cat0 = useCatalogStore.getState();
        const dev0 = useDevelopStore.getState();
        const sel0 = cat0.selectedId;
        const targets0 = cat0.selection.length > 0 ? cat0.selection : sel0 ? [sel0] : [];
        const inSelectableContext = ui0.mode === "library" || ui0.focusContext === "filmstrip";

        switch (e.key.toLowerCase()) {
          case ",": // Preferences
            e.preventDefault();
            ui0.toggleSettings();
            return;
          case "z": // Undo (Develop)
            e.preventDefault();
            if (ui0.mode === "develop") dev0.undo();
            return;
          case "y": // Redo (Develop)
            e.preventDefault();
            if (ui0.mode === "develop") dev0.redo();
            return;
          case "'": // Create Virtual Copy
            e.preventDefault();
            if (sel0) void createVirtualCopy(sel0).then(() => cat0.load());
            return;
          case "s": // Save metadata to file (write XMP)
            e.preventDefault();
            void Promise.all(targets0.map((id) => exportSidecar(id)));
            return;
          case "l": // Enable/disable library filters
            e.preventDefault();
            cat0.toggleFiltersEnabled();
            return;
          case "=":
          case "+": // Zoom in
            e.preventDefault();
            useZoomStore.getState().setMode(Math.min(8, useZoomStore.getState().scale * 1.25));
            return;
          case "-": // Zoom out
            e.preventDefault();
            useZoomStore.getState().setMode(Math.max(0.05, useZoomStore.getState().scale / 1.25));
            return;
          case "a": // Select all (Library / filmstrip context)
            if (inSelectableContext) {
              e.preventDefault();
              cat0.selectAll();
            }
            return;
          case "d": // Deselect all
            if (inSelectableContext) {
              e.preventDefault();
              cat0.deselectAll();
            }
            return;
          case "g": // Group into stack
            if (inSelectableContext) {
              e.preventDefault();
              void cat0.groupSelection();
            }
            return;
        }
      }

      // Ctrl/Cmd+Shift combos: copy/paste settings + alternate redo.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        const dev = useDevelopStore.getState();
        if (e.key === "C" || e.key === "c") {
          e.preventDefault();
          dev.copySettings();
          return;
        }
        if (e.key === "V" || e.key === "v") {
          e.preventDefault();
          void dev.pasteSettings();
          return;
        }
        if (e.key === "Z" || e.key === "z") {
          e.preventDefault();
          if (useUiStore.getState().mode === "develop") dev.redo();
          return;
        }
        if (e.key === "G" || e.key === "g") {
          // Unstack the active photo's stack.
          e.preventDefault();
          const cat = useCatalogStore.getState();
          const img = cat.selectedId ? cat.byId[cat.selectedId] : null;
          if (img?.stackId) void cat.dissolveStack(img.stackId);
          return;
        }
        if (e.key === "E" || e.key === "e") {
          // Export dialog (the classic Ctrl+Shift+E) — works in Library AND Develop.
          e.preventDefault();
          useUiStore.getState().setExportOpen(true);
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const ui = useUiStore.getState();
      const catalog = useCatalogStore.getState();
      const develop = useDevelopStore.getState();
      const sel = catalog.selectedId;
      // Cull actions target the multi-selection when one exists.
      const targets = catalog.selection.length > 0 ? catalog.selection : sel ? [sel] : [];

      const goTo = (id: string | null) => {
        if (!id) return;
        if (ui.mode === "develop") void develop.open(id);
      };

      // the classic editor's Caps Lock auto-advance: after a cull action, move to the
      // next photo (only sensible when culling a single photo, not a batch).
      const advance = () => {
        if (e.getModifierState("CapsLock") && catalog.selection.length <= 1) {
          goTo(catalog.step(1));
        }
      };

      // User remaps (Settings → Shortcuts): translate a custom binding back
      // to its action's default key; remapped-away defaults go inert.
      let key = e.key;
      if (key.length === 1 && /[a-z]/i.test(key)) {
        const t = remapKey(key.toLowerCase());
        if (t === "") return;
        key = t === key.toLowerCase() ? e.key : t;
      }

      switch (key) {
        case "?":
          ui.toggleShortcuts();
          return;
        case "Escape":
          if (ui.shortcutsOpen) ui.toggleShortcuts();
          else if (ui.settingsOpen) ui.toggleSettings();
          else if (ui.painter) ui.setPainter(null);
          else if (develop.maskDraft) develop.setMaskDraft(null);
          else if (develop.spotTool) develop.setSpotTool(false);
          else if (ui.mode === "library" && ui.libraryView !== "grid") ui.setLibraryView("grid");
          return;
        case "Enter":
          // Grid → Loupe on the active photo (classic behaviour).
          if (ui.mode === "library" && ui.libraryView === "grid" && sel) {
            ui.setLibraryView("loupe");
          }
          return;
        case "Home":
          e.preventDefault();
          if (catalog.visible.length > 0) goTo(catalog.step(-catalog.visible.length));
          return;
        case "End":
          e.preventDefault();
          if (catalog.visible.length > 0) goTo(catalog.step(catalog.visible.length));
          return;
        case "z":
        case "Z":
          // Toggle Fit ↔ 100% (Z, the classic loupe zoom toggle).
          if (ui.mode === "develop" || ui.libraryView === "loupe") {
            e.preventDefault();
            const zs = useZoomStore.getState();
            zs.setMode(zs.scale < 0.999 ? 1 : "fit");
          }
          return;
        case " ":
          // HOLD Space = hand tool (drag pans through any active tool, the
          // pro-editor convention). A quick TAP still toggles Fit ↔ 100%
          // — resolved on keyup so the two don't fight.
          if (ui.mode === "develop" || ui.libraryView === "loupe") {
            e.preventDefault();
            if (!e.repeat) useZoomStore.getState().setSpacePan(true);
          }
          return;
        case "\\":
          // Before/After (the classic backslash), alias of Y.
          if (ui.mode === "develop") develop.toggleBefore();
          return;
        case "o":
        case "O":
          // Toggle the mask overlay on the photo (the classic O).
          if (ui.mode === "develop") develop.setMaskOverlay(!develop.maskOverlay);
          return;
        case "f":
        case "F":
          // Full-screen window toggle.
          void getCurrentWindow()
            .isFullscreen()
            .then((fs) => getCurrentWindow().setFullscreen(!fs))
            .catch(() => undefined);
          return;
        case "l":
        case "L":
          // Lights Out cycle: normal → dim → blackout.
          ui.cycleLightsOut();
          return;
        case "i":
        case "I":
          // Info overlay in Loupe/Develop.
          ui.toggleInfoOverlay();
          return;
        case "t":
        case "T":
          ui.toggleToolbar();
          return;
        case "F11": // Second window (second-monitor toggle)
          e.preventDefault();
          void import("@/features/library/SecondWindow").then(({ toggleSecondWindow }) =>
            toggleSecondWindow()
          );
          return;
        case "F6":
          e.preventDefault();
          ui.toggleFilmstrip();
          return;
        case "F7":
          e.preventDefault();
          ui.toggleLeftPanel();
          return;
        case "F8":
          e.preventDefault();
          ui.toggleRightPanel();
          return;
        case "Delete":
        case "Backspace": {
          // Remove from catalog (disk untouched), with LR-style confirmation.
          if (targets.length === 0 || ui.focusContext === "develop") return;
          e.preventDefault();
          const n = targets.length;
          if (window.confirm(`Remove ${n} photo${n === 1 ? "" : "s"} from the catalog?\n(Files on disk are not touched.)`)) {
            void Promise.all(targets.map((id) => removeFromCatalog(id))).then(() => {
              catalog.deselectAll();
              return catalog.load();
            });
          }
          return;
        }
        case "Tab":
          e.preventDefault();
          ui.togglePanels(e.shiftKey);
          return;
        case "g":
        case "G":
          ui.setLibraryView("grid");
          return;
        case "e":
        case "E":
          ui.setLibraryView("loupe");
          return;
        case "n":
        case "N":
          ui.setLibraryView("survey");
          return;
        case "c":
        case "C":
          enterCompare();
          return;
        case "d":
        case "D":
          if (sel) {
            void develop.open(sel);
            ui.setMode("develop");
          }
          return;
        case "r":
        case "R":
          // Crop & straighten tool (Develop only).
          if (ui.mode === "develop") develop.toggleCropMode();
          return;
        case "y":
        case "Y":
          // Before/After toggle (Develop only).
          if (ui.mode === "develop") develop.toggleBefore();
          return;
        case "b":
        case "B":
          // Toggle the selection in/out of the Quick Collection.
          void catalog.toggleQuickCollection(targets);
          return;
        case "j":
        case "J":
          // Clipping overlay (Develop only).
          if (ui.mode === "develop") develop.toggleClipping();
          return;

        case "ArrowRight":
          e.preventDefault();
          goTo(catalog.step(1));
          return;
        case "ArrowLeft":
          e.preventDefault();
          goTo(catalog.step(-1));
          return;

        case "p":
        case "P":
          void catalog.cullMany(targets, null, 1);
          advance();
          return;
        case "x":
        case "X":
          void catalog.cullMany(targets, null, -1);
          advance();
          return;
        case "u":
        case "U":
          void catalog.cullMany(targets, null, 0);
          advance();
          return;
      }

      // Ratings 0–5.
      if (e.key >= "0" && e.key <= "5") {
        void catalog.cullMany(targets, parseInt(e.key, 10), null);
        advance();
        return;
      }

      // Color labels 6–9 (red/yellow/green/blue), toggling like the classic editors.
      const labelKeys = { "6": "red", "7": "yellow", "8": "green", "9": "blue" } as const;
      const label = labelKeys[e.key as keyof typeof labelKeys];
      if (label && targets.length > 0) {
        const current = sel ? catalog.byId[sel]?.colorLabel : null;
        void catalog.labelMany(targets, current === label ? null : label);
        advance();
      }
    };

    // Space release ends the hand tool; a quick tap with no drag falls back
    // to the classic Fit ↔ 100% toggle.
    let spaceDownAt = 0;
    const onKeyDownTime = (e: KeyboardEvent) => {
      if (e.key === " " && !e.repeat) spaceDownAt = performance.now();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const zs = useZoomStore.getState();
      if (!zs.spacePan) return;
      zs.setSpacePan(false);
      const quickTap = performance.now() - spaceDownAt < 250 && !zs.spacePanUsed;
      if (quickTap) zs.setMode(zs.scale < 0.999 ? 1 : "fit");
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyDownTime);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyDownTime);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
