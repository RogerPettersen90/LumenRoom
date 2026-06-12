import { create } from "zustand";

export type ZoomMode = "fit" | "fill" | number; // number = scale, 1 = 100%

interface Viewport {
  x: number; // normalized visible rect of the content (0..1)
  y: number;
  w: number;
  h: number;
}

interface ZoomStore {
  mode: ZoomMode;
  /** Effective scale + visible region, published by the active ZoomPane. */
  scale: number;
  viewport: Viewport | null;
  /** Navigator click → pane centers on this normalized point. */
  centerReq: { x: number; y: number; gen: number } | null;

  setMode: (m: ZoomMode) => void;
  publish: (scale: number, viewport: Viewport | null) => void;
  centerOn: (x: number, y: number) => void;

  /**
   * Spacebar hand tool (pro-editor convention): while Space is held,
   * overlays go pointer-transparent and dragging pans — works inside any
   * tool. A quick tap (no drag) still toggles Fit ↔ 100%.
   */
  spacePan: boolean;
  spacePanUsed: boolean; // a drag happened during this hold
  setSpacePan: (on: boolean) => void;
  markSpacePanUsed: () => void;
}

export const useZoomStore = create<ZoomStore>((set) => ({
  mode: "fit",
  scale: 1,
  viewport: null,
  centerReq: null,
  spacePan: false,
  spacePanUsed: false,

  setMode: (mode) => set({ mode }),
  publish: (scale, viewport) => set({ scale, viewport }),
  centerOn: (x, y) =>
    set((s) => ({ centerReq: { x, y, gen: (s.centerReq?.gen ?? 0) + 1 } })),
  setSpacePan: (spacePan) =>
    set((s) => ({ spacePan, spacePanUsed: spacePan ? false : s.spacePanUsed })),
  markSpacePanUsed: () => set({ spacePanUsed: true }),
}));
