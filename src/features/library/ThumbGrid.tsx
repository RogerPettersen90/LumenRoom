import { memo, useCallback } from "react";
import type { ImageMeta } from "@/types/models";
import { thumbUrl } from "@/api/protocol";
import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import { onImageContextMenu } from "./menus";
import { paintImage } from "./painter";

interface ThumbCellProps {
  image: ImageMeta;
  index: number; // 1-based position in the visible set (grid cell number)
  selected: boolean;
  coSelected: boolean;
  onClick: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
}

// Memoised so re-rendering the grid during a scan only touches changed cells.
const ThumbCell = memo(function ThumbCell({
  image,
  index,
  selected,
  coSelected,
  onClick,
  onOpen,
}: ThumbCellProps) {
  // Stack badge: member count + expanded state (the classic grid stack chip).
  const stackCount = useCatalogStore((s) =>
    image.stackId ? (s.stackCounts[image.stackId] ?? 0) : 0
  );
  const stackExpanded = useCatalogStore(
    (s) => !!image.stackId && s.expandedStacks.includes(image.stackId)
  );
  const toggleStackExpand = useCatalogStore((s) => s.toggleStackExpand);

  return (
    <div
      className={`thumb ${selected ? "selected" : ""} ${
        coSelected && !selected ? "co-selected" : ""
      } ${image.flag === -1 ? "rejected" : ""} ${
        image.colorLabel ? `label-${image.colorLabel}` : ""
      }`}
      onClick={(e) => onClick(image.id, e)}
      onDoubleClick={() => onOpen(image.id)}
      onContextMenu={(e) => onImageContextMenu(e, image.id)}
      title={image.filename}
    >
      {image.thumbReady ? (
        // The webview fetches + decodes this natively. No bytes via IPC.
        <img src={thumbUrl(image.id)} loading="lazy" alt={image.filename} />
      ) : (
        <div className="noimg">{image.format || "raw"}</div>
      )}

      <span className="cell-index">{index}</span>
      {image.flag === 1 && <span className="flag pick corner">⚑</span>}
      {image.flag === -1 && <span className="flag reject corner">⚑</span>}
      {image.copyOf && (
        <span className="vc-badge" title="Virtual copy">
          ⧉
        </span>
      )}
      {image.stackId && stackCount > 1 && (
        <button
          className={`stack-badge ${stackExpanded ? "open" : ""}`}
          title={stackExpanded ? "Collapse stack" : `Expand stack (${stackCount})`}
          onClick={(e) => {
            e.stopPropagation();
            toggleStackExpand(image.stackId!);
          }}
        >
          {stackExpanded ? `${image.stackPos + 1}/${stackCount}` : stackCount}
        </button>
      )}

      <div className="meta">
        <span className="fname">{image.filename}</span>
        {image.rating > 0 && <span className="stars">{"★".repeat(image.rating)}</span>}
      </div>
    </div>
  );
});

interface ThumbGridProps {
  images: ImageMeta[];
  selectedId: string | null;
  selection: string[];
  onSelect: (id: string) => void;
  /** Ctrl/Cmd-click: add/remove from the multi-selection. */
  onToggle: (id: string) => void;
  /** Shift-click: select the range from the primary to here. */
  onRange: (id: string) => void;
  onOpen: (id: string) => void;
}

export function ThumbGrid({
  images,
  selectedId,
  selection,
  onSelect,
  onToggle,
  onRange,
  onOpen,
}: ThumbGridProps) {
  const thumbSize = useUiStore((s) => s.thumbSize);
  const painterArmed = useUiStore((s) => s.painter !== null);

  // classic-style click semantics: plain = select, Ctrl/Cmd = toggle into
  // the multi-selection, Shift = range from the active image. An armed
  // painter intercepts the click and sprays its payload instead.
  const handleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (painterArmed && paintImage(id)) return;
      if (e.metaKey || e.ctrlKey) onToggle(id);
      else if (e.shiftKey) onRange(id);
      else onSelect(id);
    },
    [onSelect, onToggle, onRange, painterArmed]
  );

  const selectionSet = new Set(selection);

  return (
    <div
      className={`grid ${painterArmed ? "painting" : ""}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}
    >
      {images.map((img, i) => (
        <ThumbCell
          key={img.id}
          image={img}
          index={i + 1}
          selected={img.id === selectedId}
          coSelected={selectionSet.has(img.id)}
          onClick={handleClick}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
