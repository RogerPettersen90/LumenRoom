import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";
import { useZoomStore } from "@/store/zoomStore";
import { thumbUrl } from "@/api/protocol";

const MODES: { label: string; mode: "fit" | "fill" | number }[] = [
  { label: "FIT", mode: "fit" },
  { label: "FILL", mode: "fill" },
  { label: "100%", mode: 1 },
  { label: "200%", mode: 2 },
];

/**
 * the classic editor's Navigator: preview of the active photo with the visible
 * viewport rectangle when zoomed in. Click/drag the preview to pan; the
 * header buttons and slider drive the zoom of the active Loupe/Develop pane.
 */
export function NavigatorPanel() {
  const image = useCatalogStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));
  const mode = useZoomStore((s) => s.mode);
  const scale = useZoomStore((s) => s.scale);
  const viewport = useZoomStore((s) => s.viewport);
  const setMode = useZoomStore((s) => s.setMode);
  const centerOn = useZoomStore((s) => s.centerOn);

  const zoomedIn = viewport && (viewport.w < 0.999 || viewport.h < 0.999);

  const panTo = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomedIn) return;
    const r = e.currentTarget.getBoundingClientRect();
    centerOn((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  return (
    <PanelSection
      title="Navigator"
      headerExtra={
        <span className="nav-modes">
          {MODES.map((m) => (
            <button
              key={m.label}
              className={`nav-mode ${mode === m.mode ? "active" : ""}`}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </span>
      }
    >
      <div className="navigator">
        {image && image.thumbReady ? (
          <div
            className="nav-wrap"
            onPointerDown={panTo}
            onPointerMove={(e) => e.buttons === 1 && panTo(e)}
          >
            <img src={thumbUrl(image.id)} alt={image.filename} draggable={false} />
            {zoomedIn && viewport && (
              <div
                className="nav-viewport"
                style={{
                  left: `${viewport.x * 100}%`,
                  top: `${viewport.y * 100}%`,
                  width: `${Math.min(1, viewport.w) * 100}%`,
                  height: `${Math.min(1, viewport.h) * 100}%`,
                }}
              />
            )}
          </div>
        ) : (
          <div className="navigator-empty">{image ? image.format : "No photo selected"}</div>
        )}
      </div>
      <div className="nav-zoom">
        <input
          type="range"
          min={10}
          max={400}
          step={5}
          value={Math.round(Math.min(4, Math.max(0.1, scale)) * 100)}
          onChange={(e) => setMode(parseInt(e.target.value, 10) / 100)}
          title="Zoom"
        />
        <span className="nav-pct">{Math.round(scale * 100)}%</span>
      </div>
    </PanelSection>
  );
}
