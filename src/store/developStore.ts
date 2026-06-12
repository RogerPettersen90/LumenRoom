import { create } from "zustand";
import type { EditParams, HistoryStep } from "@/types/models";
import { mergePreset, NEUTRAL_EDIT, stripGeometry } from "@/types/models";
import { getEditParams, getHistory, saveEditParams, saveMaskRaster } from "@/api/commands";

/**
 * Develop state with an in-memory undo/redo stack layered over the persisted
 * backend history.
 *
 *   - `params`  : the live edit being displayed.
 *   - `past`    : snapshots we can undo back to.
 *   - `future`  : snapshots redo can move forward to.
 *
 * `setParam` updates live (cheap, for slider dragging). `commit` pushes a
 * history entry + persists to SQLite (call on slider release).
 */
interface DevelopState {
  imageId: string | null;
  params: EditParams;
  past: EditParams[];
  future: EditParams[];
  history: HistoryStep[];

  /** Crop tool overlay active (R). */
  cropMode: boolean;
  toggleCropMode: () => void;
  /** Crop aspect lock: "original", "w:h" (e.g. "3:2"), or null = free. */
  cropRatio: string | null;
  setCropRatio: (r: string | null) => void;

  /** Before/After (Y): render the unedited original (geometry kept). */
  showBefore: boolean;
  toggleBefore: () => void;

  /** Clipping overlay (J): paint blown highlights red, crushed shadows blue. */
  showClipping: boolean;
  toggleClipping: () => void;

  /** Mask placement: armed type — next drag on the canvas creates the mask. */
  maskDraft: "linear" | "radial" | "brush" | null;
  setMaskDraft: (d: "linear" | "radial" | "brush" | null) => void;
  /** Brush painting session: eraser mode + size (frame-unit radius). */
  brushErase: boolean;
  setBrushErase: (on: boolean) => void;
  brushSize: number;
  setBrushSize: (r: number) => void;
  brushFeather: number;
  setBrushFeather: (f: number) => void;
  /**
   * Live raster weight map being painted (data URL of the offscreen canvas).
   * ImageCanvas uploads it as the preview texture; Apply persists it as a
   * PNG via save_mask_raster and stamps the mask's rasterId.
   */
  rasterDraft: { dataUrl: string; version: number } | null;
  setRasterDraft: (d: { dataUrl: string; version: number } | null) => void;
  /** Apply the mask session: persists a painted draft (if any), dismisses
   * the overlay, commits one history step. Used by Apply + double-click. */
  applyMaskSession: () => Promise<void>;
  /** Which mask the panel + canvas overlay are editing. */
  activeMaskIndex: number;
  setActiveMaskIndex: (i: number) => void;
  /** Canvas mask handles visible. */
  maskOverlay: boolean;
  setMaskOverlay: (on: boolean) => void;

  /** Heal/clone tool: overlay visible; click places a spot. */
  spotTool: boolean;
  setSpotTool: (on: boolean) => void;
  /** Which variant new spots use — Heal and Clone are separate tools. */
  spotMode: "heal" | "clone";
  setSpotMode: (m: "heal" | "clone") => void;
  activeSpotIndex: number;
  setActiveSpotIndex: (i: number) => void;

  /** Copy/Paste settings (Ctrl+Shift+C/V) — looks only, geometry excluded. */
  clipboard: EditParams | null;
  copySettings: () => void;
  pasteSettings: () => Promise<void>;

  open: (imageId: string) => Promise<void>;
  setParam: <K extends keyof EditParams>(key: K, value: EditParams[K]) => void;
  /** Live multi-key update (crop drags touch x/y/w/h together). */
  setMany: (patch: Partial<EditParams>) => void;
  commit: (label: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
  reset: () => Promise<void>;

  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useDevelopStore = create<DevelopState>((set, get) => ({
  imageId: null,
  params: { ...NEUTRAL_EDIT },
  past: [],
  future: [],
  history: [],
  cropMode: false,
  toggleCropMode: () => set((s) => ({ cropMode: !s.cropMode })),
  cropRatio: null,
  setCropRatio: (cropRatio) => set({ cropRatio }),
  brushErase: false,
  setBrushErase: (brushErase) => set({ brushErase }),
  brushSize: 0.05,
  setBrushSize: (brushSize) => set({ brushSize }),
  brushFeather: 0.5,
  setBrushFeather: (brushFeather) => set({ brushFeather }),
  rasterDraft: null,
  setRasterDraft: (rasterDraft) => set({ rasterDraft }),

  applyMaskSession: async () => {
    const s = get();
    if (s.rasterDraft && s.imageId) {
      const idx = s.params.masks.findIndex((m) => m.kind === "raster" && m.rasterId === "");
      if (idx >= 0) {
        try {
          const id = await saveMaskRaster(s.imageId, s.rasterDraft.dataUrl);
          const masks = get().params.masks.map((m, i) =>
            i === idx ? { ...m, rasterId: id } : m
          );
          set({ params: { ...get().params, masks }, rasterDraft: null });
        } catch (e) {
          console.error("saving brush mask failed:", e);
        }
      } else {
        set({ rasterDraft: null });
      }
    }
    set({ maskDraft: null, maskOverlay: false, brushErase: false });
    await get().commit("Mask applied");
  },

  showBefore: false,
  toggleBefore: () => set((s) => ({ showBefore: !s.showBefore })),

  showClipping: false,
  toggleClipping: () => set((s) => ({ showClipping: !s.showClipping })),

  maskDraft: null,
  setMaskDraft: (maskDraft) => set({ maskDraft, maskOverlay: maskDraft !== null ? true : get().maskOverlay }),
  activeMaskIndex: 0,
  setActiveMaskIndex: (activeMaskIndex) => set({ activeMaskIndex }),
  maskOverlay: false,
  setMaskOverlay: (maskOverlay) => set({ maskOverlay }),

  spotTool: false,
  spotMode: "heal",
  setSpotMode: (spotMode) => set({ spotMode }),
  setSpotTool: (spotTool) => set({ spotTool }),
  activeSpotIndex: 0,
  setActiveSpotIndex: (activeSpotIndex) => set({ activeSpotIndex }),

  clipboard: null,
  copySettings: () => set((s) => ({ clipboard: stripGeometry(s.params) })),
  pasteSettings: async () => {
    const { clipboard, params, imageId } = get();
    if (!clipboard || !imageId) return;
    set({ params: mergePreset(params, clipboard) });
    await get().commit("Paste Settings");
  },

  open: async (imageId) => {
    const [params, history] = await Promise.all([
      getEditParams(imageId),
      getHistory(imageId),
    ]);
    set({ imageId, params, history, past: [], future: [], cropMode: false, showBefore: false });
  },

  // Live update — no history push, no persistence. Drives the canvas at 60fps.
  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: value } })),

  setMany: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),

  // Snapshot the prior state, persist, and refresh the history panel.
  commit: async (label) => {
    const { imageId, params, history } = get();
    if (!imageId) return;

    set((s) => ({ past: [...s.past, s.params], future: [] }));
    await saveEditParams(imageId, params, label);

    // Optimistically append; keep authoritative order from the backend.
    const fresh = await getHistory(imageId).catch(() => history);
    set({ history: fresh });
  },

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return {
        params: previous,
        past: s.past.slice(0, -1),
        future: [s.params, ...s.future],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        params: next,
        past: [...s.past, s.params],
        future: s.future.slice(1),
      };
    }),

  reset: async () => {
    const { imageId } = get();
    set((s) => ({
      params: { ...NEUTRAL_EDIT },
      past: [...s.past, s.params],
      future: [],
    }));
    if (imageId) await saveEditParams(imageId, NEUTRAL_EDIT, "Reset");
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
