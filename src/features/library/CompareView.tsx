import type { ImageMeta } from "@/types/models";
import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import { previewUrl } from "@/api/protocol";

/**
 * Compare view (C), in the classic layout: the pinned "Select" on the left, the
 * "Candidate" on the right. The Candidate is the catalog's active selection,
 * so ←/→ steps it through the visible set and P/X/U/0–9 cull it directly.
 *
 *   Swap         exchange Select and Candidate
 *   Make Select  promote the Candidate, then advance to the next photo
 */
export function CompareView() {
  const byId = useCatalogStore((s) => s.byId);
  const candidateId = useCatalogStore((s) => s.selectedId);
  const select = useCatalogStore((s) => s.select);
  const step = useCatalogStore((s) => s.step);
  const compareSelectId = useUiStore((s) => s.compareSelectId);
  const setCompareSelect = useUiStore((s) => s.setCompareSelect);
  const setLibraryView = useUiStore((s) => s.setLibraryView);

  const selectImg = compareSelectId ? (byId[compareSelectId] ?? null) : null;
  const candidateImg = candidateId ? (byId[candidateId] ?? null) : null;

  const swap = () => {
    if (!compareSelectId || !candidateId || compareSelectId === candidateId) return;
    setCompareSelect(candidateId);
    select(compareSelectId);
  };

  const makeSelect = () => {
    if (!candidateId) return;
    setCompareSelect(candidateId);
    step(1);
  };

  return (
    <div className="compare">
      <div className="compare-controls">
        <button onClick={swap} title="Swap Select and Candidate">
          ⇄ Swap
        </button>
        <button onClick={makeSelect} title="Promote the Candidate to Select and advance">
          Make Select
        </button>
        <div className="spacer" />
        <button onClick={() => setLibraryView("grid")} title="Back to Grid (G)">
          Done
        </button>
      </div>
      <div className="compare-panes">
        <Pane image={selectImg} role="Select" active={false} onClick={swap} />
        <Pane image={candidateImg} role="Candidate" active onClick={undefined} />
      </div>
    </div>
  );
}

function Pane({
  image,
  role,
  active,
  onClick,
}: {
  image: ImageMeta | null;
  role: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`compare-pane ${active ? "active" : ""}`}
      onClick={onClick}
      title={onClick ? "Click to swap" : undefined}
    >
      <span className="pane-role">{role}</span>
      <div className="pane-img">
        {image && image.thumbReady ? (
          <img src={previewUrl(image.id)} alt={image.filename} />
        ) : (
          <div className="empty">{image ? `No preview (${image.format})` : "—"}</div>
        )}
      </div>
      {image && (
        <div className="pane-meta">
          <span className="fname">{image.filename}</span>
          {image.rating > 0 && <span className="stars">{"★".repeat(image.rating)}</span>}
          {image.flag === 1 && <span className="flag pick">⚑</span>}
          {image.flag === -1 && <span className="flag reject">⚑</span>}
          {image.colorLabel && <span className={`swatch swatch-${image.colorLabel} on sm`} />}
        </div>
      )}
    </div>
  );
}
