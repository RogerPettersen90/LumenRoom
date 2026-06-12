// workflow-faithful right-click menus. Built fresh on each open so item
// state (clipboard, collections, current flags) is live.

import type { MenuItem } from "@/components/ContextMenu";
import type { ColorLabel } from "@/types/models";
import { mergePreset, stripGeometry } from "@/types/models";
import {
  addToCollection,
  createVirtualCopy,
  exportSidecar,
  getEditParams,
  importSidecar,
  listCollections,
  moveFolder,
  removeFolderFromCatalog,
  removeFromCatalog,
  renameFolder,
  revealFile,
  saveEditParams,
} from "@/api/commands";
import { useCatalogStore } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";

const LABELS: (ColorLabel | null)[] = ["red", "yellow", "green", "blue", "purple", null];

/** Right-clicked photo joins the selection if it wasn't in it (classic behaviour). */
function ensureSelected(id: string): string[] {
  const s = useCatalogStore.getState();
  if (!s.selection.includes(id)) {
    s.select(id);
    return [id];
  }
  return s.selection;
}

/** Build the context menu for a photo (grid cell, filmstrip frame, survey). */
export async function buildImageMenu(imageId: string): Promise<MenuItem[]> {
  const targets = ensureSelected(imageId);
  const catalog = useCatalogStore.getState();
  const develop = useDevelopStore.getState();
  const ui = useUiStore.getState();
  const image = catalog.byId[imageId];
  const many = targets.length > 1;
  const suffix = many ? ` (${targets.length})` : "";

  const collections = await listCollections().catch(() => []);

  return [
    {
      label: "Develop",
      action: () => {
        catalog.select(imageId);
        void develop.open(imageId);
        ui.setMode("develop");
      },
    },
    { separator: true },
    { label: `Flag as Pick${suffix}`, action: () => void catalog.cullMany(targets, null, 1) },
    { label: `Flag as Reject${suffix}`, action: () => void catalog.cullMany(targets, null, -1) },
    { label: `Remove Flag${suffix}`, action: () => void catalog.cullMany(targets, null, 0) },
    {
      label: "Set Rating",
      children: [0, 1, 2, 3, 4, 5].map((n) => ({
        label: n === 0 ? "None" : "★".repeat(n),
        action: () => void catalog.cullMany(targets, n, null),
      })),
    },
    {
      label: "Set Color Label",
      children: LABELS.map((l) => ({
        label: l ? l[0].toUpperCase() + l.slice(1) : "None",
        action: () => void catalog.labelMany(targets, l),
      })),
    },
    { separator: true },
    {
      label: "Develop Settings",
      children: [
        {
          label: "Copy Settings",
          action: () => {
            void getEditParams(imageId).then((p) =>
              useDevelopStore.setState({ clipboard: stripGeometry(p) })
            );
          },
        },
        {
          label: `Paste Settings${suffix}`,
          disabled: develop.clipboard === null,
          action: () => {
            const clip = useDevelopStore.getState().clipboard;
            if (!clip) return;
            void Promise.all(
              targets.map(async (id) => {
                const cur = await getEditParams(id);
                await saveEditParams(id, mergePreset(cur, clip), "Paste Settings");
              })
            );
          },
        },
        {
          label: `Write XMP${suffix}`,
          action: () => void Promise.all(targets.map((id) => exportSidecar(id))),
        },
        {
          label: `Read XMP${suffix}`,
          action: () => void Promise.all(targets.map((id) => importSidecar(id).catch(() => null))),
        },
      ],
    },
    {
      label: "Add to Collection",
      disabled: collections.length === 0,
      children: collections.map((c) => ({
        label: c.name,
        action: () => {
          void addToCollection(c.id, targets).then(() => catalog.refreshCollectionMembers());
        },
      })),
    },
    {
      label: "Stacking",
      children: [
        {
          label: `Group into Stack${suffix}`,
          disabled: targets.length < 2,
          action: () => void catalog.groupSelection(),
        },
        {
          label: "Unstack",
          disabled: !image?.stackId,
          action: () => image?.stackId && void catalog.dissolveStack(image.stackId),
        },
        {
          label: "Set as Stack Top",
          disabled: !image?.stackId,
          action: () => void catalog.promoteStackTop(imageId),
        },
        {
          label: image?.stackId && catalog.expandedStacks.includes(image.stackId)
            ? "Collapse Stack"
            : "Expand Stack",
          disabled: !image?.stackId,
          action: () => image?.stackId && catalog.toggleStackExpand(image.stackId),
        },
      ],
    },
    { separator: true },
    {
      label: "Create Virtual Copy",
      action: () => {
        void createVirtualCopy(imageId).then(() => catalog.load());
      },
    },
    {
      label: `Remove from Catalog${suffix}`,
      action: () => {
        void Promise.all(targets.map((id) => removeFromCatalog(id))).then(() => {
          catalog.deselectAll();
          return catalog.load();
        });
      },
    },
    { separator: true },
    { label: `Export${suffix}…`, action: () => ui.setExportOpen(true) },
    {
      label: `Export with Previous${suffix}`,
      action: () => {
        void import("@/api/commands").then(({ getPrefs }) =>
          getPrefs().then((p) => {
            if (!p.lastExport) return;
            return import("./exportRunner").then(({ runExport }) =>
              runExport(targets, JSON.parse(p.lastExport!))
            );
          })
        );
      },
    },
    {
      label: "Show in File Manager",
      disabled: !image,
      action: () => image && void revealFile(image.path),
    },
  ];
}

/** Context menu for a folder row. */
export function buildFolderMenu(path: string): MenuItem[] {
  const catalog = useCatalogStore.getState();
  const afterFolderChange = (newPath: string) => {
    // Keep the browse source pointing at the folder under its new path.
    const src = catalog.filter.source;
    if (src.kind === "folder" && (src.path === path || src.path.startsWith(path + "/"))) {
      catalog.setFilter({ source: { kind: "folder", path: newPath } });
    }
    void catalog.load();
  };

  return [
    {
      label: "Rename Folder…",
      action: () => {
        const base = path.slice(path.lastIndexOf("/") + 1);
        const name = window.prompt(`Rename "${base}" to:`, base);
        if (!name || name === base) return;
        renameFolder(path, name).then(afterFolderChange, (err) => window.alert(String(err)));
      },
    },
    {
      label: "Move Folder…",
      action: () => {
        void import("@tauri-apps/plugin-dialog").then(({ open }) =>
          open({ directory: true, multiple: false, title: "Move folder into…" }).then(
            (dir) => {
              if (typeof dir !== "string") return;
              moveFolder(path, dir).then(afterFolderChange, (err) =>
                window.alert(String(err))
              );
            }
          )
        );
      },
    },
    { separator: true },
    {
      label: "Remove from Catalog…",
      action: () => {
        const base = path.slice(path.lastIndexOf("/") + 1);
        if (
          !window.confirm(
            `Remove "${base}" and all photos inside it from the catalog?\n\n` +
              "Files on disk are NOT touched — this only makes LumenRoom forget them."
          )
        )
          return;
        void removeFolderFromCatalog(path).then(() => {
          const src = catalog.filter.source;
          if (src.kind === "folder" && (src.path === path || src.path.startsWith(path + "/"))) {
            catalog.setFilter({ source: { kind: "all" } });
          }
          catalog.deselectAll();
          return catalog.load();
        });
      },
    },
    { separator: true },
    {
      label: "Show in File Manager",
      // Reveal expects a file path; pointing at the folder itself opens it.
      action: () => void revealFile(path + "/."),
    },
  ];
}

/** Context menu for the Develop canvas. */
export function buildCanvasMenu(): MenuItem[] {
  const develop = useDevelopStore.getState();
  return [
    { label: "Copy Settings", action: () => develop.copySettings() },
    {
      label: "Paste Settings",
      disabled: develop.clipboard === null,
      action: () => void develop.pasteSettings(),
    },
    { separator: true },
    { label: "Before / After", action: () => develop.toggleBefore() },
    { label: "Crop & Straighten", action: () => develop.toggleCropMode() },
    { separator: true },
    {
      label: "Write XMP",
      disabled: !develop.imageId,
      action: () => develop.imageId && void exportSidecar(develop.imageId),
    },
  ];
}

/** Open a context menu for a photo at the event position. */
export function onImageContextMenu(e: React.MouseEvent, imageId: string): void {
  e.preventDefault();
  e.stopPropagation();
  const { clientX, clientY } = e;
  void buildImageMenu(imageId).then((items) =>
    useUiStore.getState().openContextMenu(clientX, clientY, items)
  );
}
