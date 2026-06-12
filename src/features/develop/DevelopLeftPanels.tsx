import { NavigatorPanel } from "@/features/library/panels/NavigatorPanel";
import { PresetsPanel } from "./panels/PresetsPanel";
import { SnapshotsPanel } from "./panels/SnapshotsPanel";
import { HistoryPanel } from "./panels/HistoryPanel";

/**
 * Develop module, left panel group (classic order): Navigator · Presets ·
 * Snapshots · History.
 */
export function DevelopLeftPanels() {
  return (
    <div className="panel-scroll">
      <NavigatorPanel />
      <PresetsPanel />
      <SnapshotsPanel />
      <HistoryPanel />
    </div>
  );
}
