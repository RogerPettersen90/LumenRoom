import { useMemo } from "react";
import type { ImageMeta } from "@/types/models";
import { useCatalogStore } from "@/store/catalogStore";
import { previewUrl } from "@/api/protocol";

/**
 * Survey view (N), in the classic layout: lay the candidate photos out together so
 * you can compare and narrow them down. The candidate set is the current
 * multi-selection (if you've selected 2+), otherwise the whole visible set.
 * Click a photo to make it active; ✕ drops it from the running (removes it
 * from the selection, like the classic editors — it is NOT rejected or altered).
 */
export function SurveyView() {
  const selection = useCatalogStore((s) => s.selection);
  const visible = useCatalogStore((s) => s.visible);
  const byId = useCatalogStore((s) => s.byId);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const setPrimary = useCatalogStore((s) => s.setPrimary);
  const setSelection = useCatalogStore((s) => s.setSelection);

  const candidates = useMemo<ImageMeta[]>(() => {
    if (selection.length >= 2) {
      return selection.map((id) => byId[id]).filter(Boolean) as ImageMeta[];
    }
    return visible;
  }, [selection, visible, byId]);

  // Choose a tile count per row that keeps cells reasonably large.
  const cols = Math.min(candidates.length || 1, Math.ceil(Math.sqrt(candidates.length || 1)));

  return (
    <div
      className="survey"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, 1fr)` }}
    >
      {candidates.map((img) => (
        <div
          key={img.id}
          className={`survey-cell ${img.id === selectedId ? "active" : ""} ${
            img.flag === -1 ? "rejected" : ""
          }`}
          onClick={() => setPrimary(img.id)}
        >
          {img.thumbReady ? (
            <img src={previewUrl(img.id)} alt={img.filename} loading="lazy" />
          ) : (
            <div className="empty">{img.format}</div>
          )}

          <button
            className="survey-reject"
            title="Remove from Survey"
            onClick={(e) => {
              e.stopPropagation();
              // classic-editor semantics: narrow the candidate set, leave the photo as-is.
              setSelection(candidates.filter((c) => c.id !== img.id).map((c) => c.id));
            }}
          >
            ✕
          </button>

          <div className="survey-meta">
            <span className="fname">{img.filename}</span>
            {img.rating > 0 && <span className="stars">{"★".repeat(img.rating)}</span>}
            {img.flag === 1 && <span className="flag pick">⚑</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
