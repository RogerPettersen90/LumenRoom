import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Enter Compare view (C), classic-style:
 *  - with 2+ photos selected, the primary becomes the Select and the next
 *    selected photo becomes the Candidate;
 *  - otherwise the active photo is the Select and the following photo in the
 *    visible order becomes the Candidate.
 */
export function enterCompare(): void {
  const catalog = useCatalogStore.getState();
  const ui = useUiStore.getState();
  const vis = catalog.visible;
  if (vis.length === 0) return;

  const sel = catalog.selectedId ?? vis[0].id;

  if (catalog.selection.length >= 2) {
    const others = catalog.selection.filter((id) => id !== sel);
    ui.setCompareSelect(sel);
    catalog.select(others[0]);
  } else {
    const idx = Math.max(0, vis.findIndex((i) => i.id === sel));
    const candidate = vis[Math.min(vis.length - 1, idx + 1)];
    ui.setCompareSelect(sel);
    catalog.select(candidate.id);
  }

  ui.setLibraryView("compare");
}
