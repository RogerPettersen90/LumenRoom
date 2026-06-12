import { create } from "zustand";
import type { Collection, ColorLabel, ImageMeta, Keyword, ScanEvent } from "@/types/models";
import {
  addToCollection,
  collectionMembers,
  createCollection,
  keywordMembers,
  listImages,
  removeFromCollection,
  scanDirectory,
  setCull,
  setLabel,
  setStackTop,
  stackImages,
  unstack,
} from "@/api/commands";

export const QUICK_COLLECTION = "Quick Collection";
import { useUiStore } from "@/store/uiStore";

export type FlagFilter = "all" | "pick" | "reject" | "unflagged";
export type SortKey = "captured" | "filename" | "rating";

/** Rule set for a smart collection (all set fields must match). */
export interface SmartRules {
  minRating?: number;
  flag?: "pick" | "reject" | "unflagged";
  label?: ColorLabel;
  camera?: string;
  lens?: string;
  textContains?: string;
}

export function smartRulesMatch(rules: SmartRules, i: ImageMeta): boolean {
  if (rules.minRating !== undefined && i.rating < rules.minRating) return false;
  if (rules.flag === "pick" && i.flag !== 1) return false;
  if (rules.flag === "reject" && i.flag !== -1) return false;
  if (rules.flag === "unflagged" && i.flag !== 0) return false;
  if (rules.label && i.colorLabel !== rules.label) return false;
  if (rules.camera && i.cameraModel !== rules.camera) return false;
  if (rules.lens && i.lens !== rules.lens) return false;
  if (rules.textContains) {
    const hay = `${i.filename} ${i.cameraModel ?? ""} ${i.lens ?? ""}`.toLowerCase();
    if (!hay.includes(rules.textContains.toLowerCase())) return false;
  }
  return true;
}

/** What the grid is browsing — the classic editor's Catalog/Folders/Collections sources. */
export type Source =
  | { kind: "all" }
  | { kind: "folder"; path: string } // the folder and everything below it
  | { kind: "previousImport" }
  | { kind: "collection"; id: number; name: string }
  // Smart collections carry their rules inline — membership is evaluated live
  // in applyFilter, so culling updates it instantly.
  | { kind: "smart"; id: number; name: string; rules: SmartRules };

export interface Filter {
  source: Source;
  text: string; // matches filename / camera / lens, case-insensitive
  flag: FlagFilter;
  minRating: number; // 0..5
  label: ColorLabel | null;
  keyword: { id: number; name: string } | null;
  camera: string | null; // exact cameraModel match
  lens: string | null; // exact lens match
  sort: SortKey;
}

const DEFAULT_FILTER: Filter = {
  source: { kind: "all" },
  text: "",
  flag: "all",
  minRating: 0,
  label: null,
  keyword: null,
  camera: null,
  lens: null,
  sort: "captured",
};

/** Async-loaded membership sets backing collection/keyword filtering. */
interface MemberCtx {
  lastImportIds: string[];
  collectionMembers: string[] | null;
  keywordMembers: string[] | null;
  filtersEnabled?: boolean;
  expandedStacks?: string[];
}

/** Absolute parent directory of a file path (Linux-style separators). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

interface CatalogState {
  images: ImageMeta[]; // everything imported
  byId: Record<string, ImageMeta>;
  visible: ImageMeta[]; // images after the active filter + sort
  filter: Filter;
  selectedId: string | null; // the active ("primary") selection
  selection: string[]; // all selected ids (includes the primary)
  lastImportIds: string[]; // ids from the most recent scan (session-only)
  collectionMembers: string[] | null; // when source is a collection
  keywordMembers: string[] | null; // when a keyword filter is active
  /** Ctrl+L: temporarily bypass attribute filters (source stays). */
  filtersEnabled: boolean;
  toggleFiltersEnabled: () => void;

  /** Stacks currently shown expanded (collapsed is the default). */
  expandedStacks: string[];
  /** Members per stack id (over the whole catalog, not just visible). */
  stackCounts: Record<string, number>;
  toggleStackExpand: (stackId: string) => void;
  /** Group the current selection into a stack (Ctrl+G). */
  groupSelection: () => Promise<void>;
  /** Dissolve a stack (Ctrl+Shift+G). */
  dissolveStack: (stackId: string) => Promise<void>;
  /** Promote an image to its stack's top (collapsed face). */
  promoteStackTop: (id: string) => Promise<void>;

  /** Browse a collection (loads membership, then filters). */
  selectCollection: (c: Collection) => Promise<void>;
  /** Filter by keyword (null clears). */
  setKeywordFilter: (k: Keyword | null) => Promise<void>;
  /** Reload the active collection's membership after add/remove. */
  refreshCollectionMembers: () => Promise<void>;
  /** Toggle ids in/out of the Quick Collection (B), LR-style. */
  toggleQuickCollection: (ids: string[]) => Promise<void>;
  /** A photo arrived via Auto-Import (backend event). */
  addImported: (image: ImageMeta) => void;

  load: () => Promise<void>;
  importDirectory: (
    dir: string,
    recursive: boolean,
    mode?: "add" | "copy" | "move",
    dest?: string
  ) => Promise<void>;
  select: (id: string | null) => void;
  /** Set the active image without changing the multi-selection. */
  setPrimary: (id: string) => void;
  /** Ctrl/Cmd-click: add/remove `id` from the multi-selection. */
  toggleSelect: (id: string) => void;
  /** Shift-click: select the visible range from the primary to `id`. */
  rangeSelect: (id: string) => void;
  /** Select every photo in the current visible set (Ctrl+A). */
  selectAll: () => void;
  /** Replace the multi-selection wholesale (Survey ✕, painter ranges). */
  setSelection: (ids: string[]) => void;
  /** Clear the selection (Ctrl+D). */
  deselectAll: () => void;
  /** Move selection by `delta` positions within the *visible* set. */
  step: (delta: number) => string | null;
  cull: (id: string, rating: number | null, flag: number | null) => Promise<void>;
  /** Apply a rating/flag to every id (e.g. the whole selection). */
  cullMany: (ids: string[], rating: number | null, flag: number | null) => Promise<void>;
  /** Apply (or clear) a color label across ids. */
  labelMany: (ids: string[], label: ColorLabel | null) => Promise<void>;
  setFilter: (patch: Partial<Filter>) => void;
}

function index(images: ImageMeta[]): Record<string, ImageMeta> {
  return Object.fromEntries(images.map((i) => [i.id, i]));
}

/** Build the membership context from store state. */
function ctxOf(s: {
  lastImportIds: string[];
  collectionMembers: string[] | null;
  keywordMembers: string[] | null;
  filtersEnabled: boolean;
  expandedStacks: string[];
}): MemberCtx {
  return {
    lastImportIds: s.lastImportIds,
    collectionMembers: s.collectionMembers,
    keywordMembers: s.keywordMembers,
    filtersEnabled: s.filtersEnabled,
    expandedStacks: s.expandedStacks,
  };
}

/**
 * Collapse stacks: a collapsed stack contributes only its best member (lowest
 * stackPos surviving the filter); expanded stacks show everyone. Keeps the
 * representative at its sorted position.
 */
function collapseStacks(sorted: ImageMeta[], expanded: Set<string>): ImageMeta[] {
  const face = new Map<string, ImageMeta>();
  for (const i of sorted) {
    if (!i.stackId || expanded.has(i.stackId)) continue;
    const cur = face.get(i.stackId);
    if (!cur || i.stackPos < cur.stackPos) face.set(i.stackId, i);
  }
  return sorted.filter(
    (i) => !i.stackId || expanded.has(i.stackId) || face.get(i.stackId) === i
  );
}

function applyFilter(images: ImageMeta[], f: Filter, ctx: MemberCtx): ImageMeta[] {
  const lastImport = f.source.kind === "previousImport" ? new Set(ctx.lastImportIds) : null;
  const inCollection =
    f.source.kind === "collection" && ctx.collectionMembers
      ? new Set(ctx.collectionMembers)
      : null;
  const hasKeyword = f.keyword && ctx.keywordMembers ? new Set(ctx.keywordMembers) : null;

  const filtered = images.filter((i) => {
    if (f.source.kind === "folder") {
      const p = f.source.path;
      if (!(i.path.startsWith(p + "/") || parentDir(i.path) === p)) return false;
    }
    if (lastImport && !lastImport.has(i.id)) return false;
    if (f.source.kind === "collection" && !inCollection?.has(i.id)) return false;
    if (f.source.kind === "smart" && !smartRulesMatch(f.source.rules, i)) return false;
    // Ctrl+L bypass: the SOURCE always applies; attribute filters drop out.
    if (ctx.filtersEnabled === false) return true;
    if (hasKeyword && !hasKeyword.has(i.id)) return false;
    if (f.text) {
      const q = f.text.toLowerCase();
      const hay = `${i.filename} ${i.cameraModel ?? ""} ${i.lens ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.flag === "pick" && i.flag !== 1) return false;
    if (f.flag === "reject" && i.flag !== -1) return false;
    if (f.flag === "unflagged" && i.flag !== 0) return false;
    if (i.rating < f.minRating) return false;
    if (f.label && i.colorLabel !== f.label) return false;
    if (f.camera && i.cameraModel !== f.camera) return false;
    if (f.lens && i.lens !== f.lens) return false;
    return true;
  });

  const cmp: Record<SortKey, (a: ImageMeta, b: ImageMeta) => number> = {
    captured: (a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0),
    filename: (a, b) => a.filename.localeCompare(b.filename),
    rating: (a, b) => b.rating - a.rating || (b.capturedAt ?? 0) - (a.capturedAt ?? 0),
  };
  const sorted = [...filtered].sort(cmp[f.sort]);
  return collapseStacks(sorted, new Set(ctx.expandedStacks ?? []));
}

/** Members per stack id over the whole catalog (badge counts). */
function countStacks(images: ImageMeta[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of images) {
    if (i.stackId) counts[i.stackId] = (counts[i.stackId] ?? 0) + 1;
  }
  return counts;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  images: [],
  byId: {},
  visible: [],
  filter: DEFAULT_FILTER,
  selectedId: null,
  selection: [],
  lastImportIds: [],
  collectionMembers: null,
  keywordMembers: null,
  filtersEnabled: true,
  expandedStacks: [],
  stackCounts: {},

  toggleFiltersEnabled: () =>
    set((s) => {
      const filtersEnabled = !s.filtersEnabled;
      const next = { ...s, filtersEnabled };
      return { filtersEnabled, visible: applyFilter(s.images, s.filter, ctxOf(next)) };
    }),

  selectCollection: async (c) => {
    const members = await collectionMembers(c.id);
    set((s) => {
      const filter: Filter = {
        ...s.filter,
        source: { kind: "collection", id: c.id, name: c.name },
      };
      const next = { ...s, filter, collectionMembers: members };
      return { filter, collectionMembers: members, visible: applyFilter(s.images, filter, ctxOf(next)) };
    });
  },

  setKeywordFilter: async (k) => {
    const members = k ? await keywordMembers(k.id) : null;
    set((s) => {
      const filter: Filter = { ...s.filter, keyword: k ? { id: k.id, name: k.name } : null };
      const next = { ...s, filter, keywordMembers: members };
      return { filter, keywordMembers: members, visible: applyFilter(s.images, filter, ctxOf(next)) };
    });
  },

  refreshCollectionMembers: async () => {
    const src = get().filter.source;
    if (src.kind !== "collection") return;
    const members = await collectionMembers(src.id);
    set((s) => {
      const next = { ...s, collectionMembers: members };
      return { collectionMembers: members, visible: applyFilter(s.images, s.filter, ctxOf(next)) };
    });
  },

  toggleQuickCollection: async (ids) => {
    if (ids.length === 0) return;
    // Find-or-create the reserved collection (create is an upsert by name).
    const qc = await createCollection(QUICK_COLLECTION);
    const members = new Set(await collectionMembers(qc.id));
    // classic-editor semantics: if the primary is already in, the toggle removes all.
    if (members.has(ids[0])) {
      await removeFromCollection(qc.id, ids);
    } else {
      await addToCollection(qc.id, ids);
    }
    await get().refreshCollectionMembers();
  },

  addImported: (image) =>
    set((s) => {
      const images = [image, ...s.images.filter((i) => i.id !== image.id)];
      const next = { ...s, images };
      return { images, byId: index(images), visible: applyFilter(images, s.filter, ctxOf(next)) };
    }),

  load: async () => {
    const images = await listImages();
    set((s) => ({
      images,
      byId: index(images),
      stackCounts: countStacks(images),
      visible: applyFilter(images, s.filter, ctxOf(s)),
    }));
  },

  toggleStackExpand: (stackId) =>
    set((s) => {
      const expandedStacks = s.expandedStacks.includes(stackId)
        ? s.expandedStacks.filter((x) => x !== stackId)
        : [...s.expandedStacks, stackId];
      const next = { ...s, expandedStacks };
      return { expandedStacks, visible: applyFilter(s.images, s.filter, ctxOf(next)) };
    }),

  groupSelection: async () => {
    const s = get();
    // Stack in visible order so the top is the first as you see them.
    const ids = s.visible.filter((i) => s.selection.includes(i.id)).map((i) => i.id);
    if (ids.length < 2) return;
    await stackImages(ids);
    await get().load();
  },

  dissolveStack: async (stackId) => {
    await unstack(stackId);
    set((s) => ({ expandedStacks: s.expandedStacks.filter((x) => x !== stackId) }));
    await get().load();
  },

  promoteStackTop: async (id) => {
    await setStackTop(id);
    await get().load();
  },

  importDirectory: async (dir, recursive, mode = "add", dest = undefined) => {
    const ui = useUiStore.getState();
    ui.setScan({ scanning: true, done: 0, total: 0 });
    const importedIds: string[] = [];

    // Buffer streamed imports and flush in batches to avoid re-rendering the
    // grid on every single image during a large scan.
    let pending: ImageMeta[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      set((s) => {
        // Replace any re-imported rows, then prepend the genuinely new ones.
        const batchIds = new Set(batch.map((b) => b.id));
        const kept = s.images.filter((i) => !batchIds.has(i.id));
        const images = [...batch, ...kept];
        return {
          images,
          byId: index(images),
          visible: applyFilter(images, s.filter, ctxOf(s)),
        };
      });
    };
    const interval = window.setInterval(flush, 120);

    const onEvent = (e: ScanEvent) => {
      switch (e.type) {
        case "started":
          useUiStore.getState().setScan({ scanning: true, done: 0, total: e.total });
          break;
        case "imported":
          importedIds.push(e.image.id);
          pending.push(e.image);
          break;
        case "progress":
          useUiStore.getState().setScan({ scanning: true, done: e.done, total: e.total });
          break;
        case "finished":
          useUiStore.getState().setScan({ scanning: false });
          break;
        case "failed":
          console.warn(`Import failed: ${e.path} — ${e.error}`);
          break;
      }
    };

    try {
      await scanDirectory(dir, recursive, mode, dest, onEvent);
    } finally {
      window.clearInterval(interval);
      flush();
      set({ lastImportIds: importedIds });
      useUiStore.getState().setScan({ scanning: false });
    }
  },

  select: (id) => set({ selectedId: id, selection: id ? [id] : [] }),

  setSelection: (ids) =>
    set((s) => ({
      selection: ids,
      selectedId:
        s.selectedId && ids.includes(s.selectedId) ? s.selectedId : (ids.at(-1) ?? null),
    })),

  setPrimary: (id) => set({ selectedId: id }),

  toggleSelect: (id) =>
    set((s) => {
      if (s.selection.includes(id)) {
        const selection = s.selection.filter((x) => x !== id);
        const selectedId = s.selectedId === id ? (selection.at(-1) ?? null) : s.selectedId;
        return { selection, selectedId };
      }
      return { selection: [...s.selection, id], selectedId: id };
    }),

  rangeSelect: (id) =>
    set((s) => {
      const order = s.visible;
      const from = order.findIndex((i) => i.id === s.selectedId);
      const to = order.findIndex((i) => i.id === id);
      if (to < 0) return s;
      if (from < 0) return { selection: [id], selectedId: id };
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const selection = order.slice(lo, hi + 1).map((i) => i.id);
      return { selection, selectedId: id };
    }),

  selectAll: () =>
    set((s) => ({
      selection: s.visible.map((i) => i.id),
      selectedId: s.selectedId ?? s.visible[0]?.id ?? null,
    })),

  deselectAll: () => set({ selection: [], selectedId: null }),

  step: (delta) => {
    const { visible, selectedId } = get();
    if (visible.length === 0) return null;
    const idx = visible.findIndex((i) => i.id === selectedId);
    const base = idx < 0 ? (delta > 0 ? -1 : 0) : idx;
    const next = Math.min(visible.length - 1, Math.max(0, base + delta));
    const id = visible[next].id;
    set({ selectedId: id, selection: [id] });
    return id;
  },

  cull: async (id, rating, flag) => {
    await setCull(id, rating, flag);
    set((s) => {
      const current = s.byId[id];
      if (!current) return s;
      const updated: ImageMeta = {
        ...current,
        rating: rating ?? current.rating,
        flag: flag ?? current.flag,
      };
      const images = s.images.map((i) => (i.id === id ? updated : i));
      return {
        images,
        byId: { ...s.byId, [id]: updated },
        visible: applyFilter(images, s.filter, ctxOf(s)),
      };
    });
  },

  cullMany: async (ids, rating, flag) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => setCull(id, rating, flag)));
    set((s) => {
      const idSet = new Set(ids);
      const images = s.images.map((i) =>
        idSet.has(i.id) ? { ...i, rating: rating ?? i.rating, flag: flag ?? i.flag } : i
      );
      return {
        images,
        byId: index(images),
        visible: applyFilter(images, s.filter, ctxOf(s)),
      };
    });
  },

  labelMany: async (ids, label) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => setLabel(id, label)));
    set((s) => {
      const idSet = new Set(ids);
      const images = s.images.map((i) =>
        idSet.has(i.id) ? { ...i, colorLabel: label } : i
      );
      return {
        images,
        byId: index(images),
        visible: applyFilter(images, s.filter, ctxOf(s)),
      };
    });
  },

  setFilter: (patch) =>
    set((s) => {
      const filter = { ...s.filter, ...patch };
      // Leaving a collection source drops its membership set.
      const collectionMembers =
        patch.source && patch.source.kind !== "collection" ? null : s.collectionMembers;
      const next = { ...s, filter, collectionMembers };
      return { filter, collectionMembers, visible: applyFilter(s.images, filter, ctxOf(next)) };
    }),
}));
