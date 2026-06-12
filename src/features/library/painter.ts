// Painter tool (the classic editor's spray can): while armed via the grid toolbar,
// clicking thumbnails applies the payload instead of selecting.

import { addKeyword } from "@/api/commands";
import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import type { ColorLabel } from "@/types/models";

/** Apply the armed painter payload to one image. Returns true if it painted. */
export function paintImage(id: string): boolean {
  const painter = useUiStore.getState().painter;
  if (!painter) return false;

  const cat = useCatalogStore.getState();
  switch (painter.kind) {
    case "rating":
      void cat.cull(id, parseInt(painter.value, 10) || 0, null);
      break;
    case "flag":
      void cat.cull(id, null, painter.value === "reject" ? -1 : 1);
      break;
    case "label":
      void cat.labelMany(
        [id],
        painter.value === "none" ? null : (painter.value as ColorLabel)
      );
      break;
    case "keyword": {
      const kw = painter.value.trim();
      if (kw) void addKeyword([id], kw);
      break;
    }
  }
  return true;
}
