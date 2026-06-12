import { useDevelopStore } from "@/store/developStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Opens the full Export dialog (same one as the Library — formats, color
 * space, sizing, watermark, presets) for the photo open in Develop.
 * The old quick single-JPEG save is gone: one export surface everywhere.
 */
export function ExportButton() {
  const imageId = useDevelopStore((s) => s.imageId);
  const setExportOpen = useUiStore((s) => s.setExportOpen);

  if (!imageId) return null;

  return (
    <button onClick={() => setExportOpen(true)} title="Export with full settings (Ctrl+Shift+E)">
      Export…
    </button>
  );
}
