import { useCatalogStore } from "@/store/catalogStore";
import { useUiStore } from "@/store/uiStore";

/** Loupe/Develop info overlay (I): filename + key capture settings. */
export function InfoOverlay() {
  const enabled = useUiStore((s) => s.infoOverlay);
  const image = useCatalogStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));

  if (!enabled || !image) return null;

  const lines = [
    image.filename,
    [
      image.iso != null ? `ISO ${image.iso}` : null,
      image.focalLength != null ? `${Math.round(image.focalLength)} mm` : null,
      image.aperture != null ? `f/${image.aperture}` : null,
      image.shutter ? `${image.shutter} sec` : null,
    ]
      .filter(Boolean)
      .join("  ·  "),
    image.capturedAt ? new Date(image.capturedAt * 1000).toLocaleString() : null,
  ].filter(Boolean) as string[];

  return (
    <div className="info-overlay">
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "info-primary" : ""}>
          {l}
        </div>
      ))}
    </div>
  );
}
