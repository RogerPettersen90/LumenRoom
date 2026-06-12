import { useEffect, useRef } from "react";
import type { ColorLabel } from "@/types/models";
import { useCatalogStore } from "@/store/catalogStore";
import type { Source } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";
import { thumbUrl } from "@/api/protocol";
import { onImageContextMenu } from "./menus";

const LABELS: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];

/**
 * The the classic editor filmstrip: a header strip (source breadcrumb on the left, a
 * compact attribute filter on the right — same filter state the Library Filter
 * bar drives) above the horizontal strip of frames. Persistent across modules.
 */
export function Filmstrip() {
  const images = useCatalogStore((s) => s.visible);
  const total = useCatalogStore((s) => s.images.length);
  const selection = useCatalogStore((s) => s.selection);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const byId = useCatalogStore((s) => s.byId);
  const filter = useCatalogStore((s) => s.filter);
  const setFilter = useCatalogStore((s) => s.setFilter);
  const select = useCatalogStore((s) => s.select);
  const mode = useUiStore((s) => s.mode);
  const openDevelop = useDevelopStore((s) => s.open);

  const selRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedId]);

  const pick = (id: string) => {
    select(id);
    if (mode === "develop") void openDevelop(id);
  };

  const primary = selectedId ? byId[selectedId] : null;
  const crumb = [
    sourceName(filter.source),
    `${images.length} of ${total} photos`,
    selection.length > 1 ? `${selection.length} selected` : primary?.filename ?? "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  const setFocusContext = useUiStore((s) => s.setFocusContext);

  return (
    <div className="filmstrip-zone" onPointerDown={() => setFocusContext("filmstrip")}>
      <div className="filmstrip-header">
        <span className="crumb" title={crumb}>
          {crumb}
        </span>
        <div className="spacer" />
        <span className="fs-label">Filter:</span>
        <button
          className={`fs-flag ${filter.flag === "pick" ? "on" : ""}`}
          title="Show picks only"
          onClick={() => setFilter({ flag: filter.flag === "pick" ? "all" : "pick" })}
        >
          <span className="flag pick">⚑</span>
        </button>
        <button
          className={`fs-flag ${filter.flag === "reject" ? "on" : ""}`}
          title="Show rejects only"
          onClick={() => setFilter({ flag: filter.flag === "reject" ? "all" : "reject" })}
        >
          <span className="flag reject">⚑</span>
        </button>
        <span className="rating-filter sm" title="Minimum rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`star ${n <= filter.minRating ? "on" : ""}`}
              onClick={() => setFilter({ minRating: filter.minRating === n ? 0 : n })}
            >
              ★
            </span>
          ))}
        </span>
        <span className="label-filter">
          {LABELS.map((l) => (
            <span
              key={l}
              className={`swatch sm swatch-${l} ${filter.label === l ? "on" : ""}`}
              onClick={() => setFilter({ label: filter.label === l ? null : l })}
            />
          ))}
        </span>
      </div>

      <div className="filmstrip">
        {images.map((img) => (
          <div
            key={img.id}
            ref={img.id === selectedId ? selRef : undefined}
            className={`film-cell ${
              img.id === selectedId || selection.includes(img.id) ? "selected" : ""
            } ${img.id === selectedId ? "primary" : ""} ${
              img.flag === -1 ? "rejected" : ""
            } ${img.colorLabel ? `label-${img.colorLabel}` : ""}`}
            onClick={() => pick(img.id)}
            onContextMenu={(e) => onImageContextMenu(e, img.id)}
            title={img.filename}
          >
            {img.thumbReady ? (
              <img src={thumbUrl(img.id)} loading="lazy" alt={img.filename} />
            ) : (
              <div className="noimg">{img.format}</div>
            )}
            {img.flag === 1 && <span className="flag pick">⚑</span>}
            {img.flag === -1 && <span className="flag reject">⚑</span>}
            {img.rating > 0 && <span className="film-stars">{"★".repeat(img.rating)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function sourceName(source: Source): string {
  switch (source.kind) {
    case "all":
      return "All Photographs";
    case "previousImport":
      return "Previous Import";
    case "folder":
      return source.path.split("/").pop() || source.path;
    case "collection":
      return source.name;
    case "smart":
      return `⚙ ${source.name}`;
  }
}
