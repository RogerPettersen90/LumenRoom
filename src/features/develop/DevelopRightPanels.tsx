import { Histogram } from "./histogram/Histogram";
import { CropPanel } from "./panels/CropPanel";
import { BasicPanel } from "./panels/BasicPanel";
import { ToneCurvePanel } from "./panels/ToneCurvePanel";
import { HslPanel } from "./panels/HslPanel";
import { ColorGradingPanel } from "./panels/ColorGradingPanel";
import { DetailPanel } from "./panels/DetailPanel";
import { LensPanel } from "./panels/LensPanel";
import { MaskingPanel } from "./panels/MaskingPanel";
import { SpotsPanel } from "./panels/SpotsPanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { CalibrationPanel } from "./panels/CalibrationPanel";
import { ExportButton } from "./ExportButton";
import { SidecarButton } from "./SidecarButton";
import { ImportXmpButton } from "./ImportXmpButton";
import { useDevelopStore } from "@/store/developStore";

/**
 * Develop module, right panel group (classic order): Histogram · Crop · Basic ·
 * Tone Curve · Color Mixer · Color Grading · Effects, with copy/paste and
 * output actions pinned below.
 */
export function DevelopRightPanels() {
  const copySettings = useDevelopStore((s) => s.copySettings);
  const pasteSettings = useDevelopStore((s) => s.pasteSettings);
  const hasClipboard = useDevelopStore((s) => s.clipboard !== null);

  return (
    <>
      <div className="panel-scroll">
        <Histogram />
        <CropPanel />
        <BasicPanel />
        <ToneCurvePanel />
        <HslPanel />
        <ColorGradingPanel />
        <MaskingPanel />
        <SpotsPanel />
        <DetailPanel />
        <LensPanel />
        <EffectsPanel />
        <CalibrationPanel />
      </div>
      <div className="panel-footer wrap">
        <button onClick={copySettings} title="Copy settings (Ctrl+Shift+C)">
          Copy
        </button>
        <button
          onClick={() => void pasteSettings()}
          disabled={!hasClipboard}
          title="Paste settings (Ctrl+Shift+V)"
        >
          Paste
        </button>
        <SidecarButton />
        <ImportXmpButton />
        <ExportButton />
      </div>
    </>
  );
}
