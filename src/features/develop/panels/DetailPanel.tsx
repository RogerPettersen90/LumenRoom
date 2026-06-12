import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";

/**
 * Detail (the classic Detail panel): sharpening for now; noise reduction lands with
 * the heavier convolution work later.
 */
export function DetailPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);

  return (
    <PanelSection title="Detail" defaultOpen={false}>
      <div className="subgroup">
        <h4>Sharpening</h4>
        <Slider
          label="Amount"
          value={params.sharpenAmount}
          min={0}
          max={100}
          onChange={(v) => setParam("sharpenAmount", v)}
          onCommit={() => commit(`Sharpen ${Math.round(params.sharpenAmount)}`)}
        />
        <Slider
          label="Masking"
          value={params.sharpenMasking}
          min={0}
          max={100}
          onChange={(v) => setParam("sharpenMasking", v)}
          onCommit={() => commit(`Sharpen Masking ${Math.round(params.sharpenMasking)}`)}
        />
      </div>
      <div className="subgroup">
        <h4>Noise Reduction</h4>
        <Slider
          label="Luminance"
          value={params.noiseLuminance}
          min={0}
          max={100}
          onChange={(v) => setParam("noiseLuminance", v)}
          onCommit={() => commit(`NR Luminance ${Math.round(params.noiseLuminance)}`)}
        />
        <Slider
          label="Color"
          value={params.noiseColor}
          min={0}
          max={100}
          onChange={(v) => setParam("noiseColor", v)}
          onCommit={() => commit(`NR Color ${Math.round(params.noiseColor)}`)}
        />
      </div>
    </PanelSection>
  );
}
