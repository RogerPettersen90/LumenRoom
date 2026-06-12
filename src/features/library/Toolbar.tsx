import { useCatalogStore } from "@/store/catalogStore";
import type { SortKey } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";
import { enterCompare } from "./enterCompare";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "captured", label: "Capture Time" },
  { key: "filename", label: "File Name" },
  { key: "rating", label: "Rating" },
];

/**
 * the classic editor's toolbar strip under the work area: view-mode buttons, sort
 * order, and the thumbnail size slider (grid view only).
 */
export function Toolbar() {
  const libraryView = useUiStore((s) => s.libraryView);
  const setLibraryView = useUiStore((s) => s.setLibraryView);
  const thumbSize = useUiStore((s) => s.thumbSize);
  const setThumbSize = useUiStore((s) => s.setThumbSize);
  const sort = useCatalogStore((s) => s.filter.sort);
  const setFilter = useCatalogStore((s) => s.setFilter);

  return (
    <div className="toolbar">
      <div className="seg">
        <button
          className={libraryView === "grid" ? "active" : ""}
          onClick={() => setLibraryView("grid")}
          title="Grid (G)"
        >
          ▦
        </button>
        <button
          className={libraryView === "loupe" ? "active" : ""}
          onClick={() => setLibraryView("loupe")}
          title="Loupe (E)"
        >
          ▢
        </button>
        <button
          className={libraryView === "compare" ? "active" : ""}
          onClick={enterCompare}
          title="Compare (C)"
        >
          XY
        </button>
        <button
          className={libraryView === "survey" ? "active" : ""}
          onClick={() => setLibraryView("survey")}
          title="Survey (N)"
        >
          ⊞
        </button>
      </div>

      <label className="sort">
        Sort:
        <select value={sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {libraryView === "grid" && <PainterControl />}

      <div className="spacer" />

      {libraryView === "grid" && (
        <label className="thumb-slider" title="Thumbnail size">
          Thumbnails
          <input
            type="range"
            min={120}
            max={320}
            step={10}
            value={thumbSize}
            onChange={(e) => setThumbSize(parseInt(e.target.value, 10))}
          />
        </label>
      )}
    </div>
  );
}

const PAINTER_KINDS = [
  { kind: "rating", label: "Rating" },
  { kind: "flag", label: "Flag" },
  { kind: "label", label: "Label" },
  { kind: "keyword", label: "Keyword" },
] as const;

const LABELS = ["red", "yellow", "green", "blue", "purple", "none"];

/** Default payload when switching the painter to a kind. */
function defaultValue(kind: string): string {
  switch (kind) {
    case "rating":
      return "3";
    case "flag":
      return "pick";
    case "label":
      return "red";
    default:
      return "";
  }
}

/**
 * the classic Painter (spray can) tool: arm it, choose a payload, then click
 * thumbnails to spray. Esc or the button disarms.
 */
function PainterControl() {
  const painter = useUiStore((s) => s.painter);
  const setPainter = useUiStore((s) => s.setPainter);

  return (
    <div className={`painter ${painter ? "armed" : ""}`}>
      <button
        className={painter ? "active" : ""}
        title="Painter — click thumbnails to apply the payload"
        onClick={() => setPainter(painter ? null : { kind: "rating", value: "3" })}
      >
        🖌
      </button>
      {painter && (
        <>
          <select
            value={painter.kind}
            onChange={(e) => {
              const kind = e.target.value as NonNullable<typeof painter>["kind"];
              setPainter({ kind, value: defaultValue(kind) });
            }}
          >
            {PAINTER_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          {painter.kind === "rating" && (
            <select
              value={painter.value}
              onChange={(e) => setPainter({ ...painter, value: e.target.value })}
            >
              {["1", "2", "3", "4", "5"].map((v) => (
                <option key={v} value={v}>
                  {"★".repeat(+v)}
                </option>
              ))}
            </select>
          )}
          {painter.kind === "flag" && (
            <select
              value={painter.value}
              onChange={(e) => setPainter({ ...painter, value: e.target.value })}
            >
              <option value="pick">⚑ Pick</option>
              <option value="reject">⚐ Reject</option>
            </select>
          )}
          {painter.kind === "label" && (
            <select
              value={painter.value}
              onChange={(e) => setPainter({ ...painter, value: e.target.value })}
            >
              {LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
          {painter.kind === "keyword" && (
            <input
              type="text"
              placeholder="keyword…"
              value={painter.value}
              onChange={(e) => setPainter({ ...painter, value: e.target.value })}
            />
          )}
        </>
      )}
    </div>
  );
}
