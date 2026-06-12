import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";

/**
 * Effects (the classic Effects panel): post-crop vignette + film grain. Applied at
 * the very end of both pipelines, in output space.
 */
export function EffectsPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);

  return (
    <PanelSection title="Effects" defaultOpen={false}>
      <div className="subgroup">
        <h4>Post-Crop Vignetting</h4>
        <Slider
          label="Amount"
          value={params.vignetteAmount}
          min={-100}
          max={100}
          onChange={(v) => setParam("vignetteAmount", v)}
          onCommit={() => commit(`Vignette ${Math.round(params.vignetteAmount)}`)}
        />
        <Slider
          label="Midpoint"
          value={params.vignetteMidpoint}
          min={0}
          max={100}
          onChange={(v) => setParam("vignetteMidpoint", v)}
          onCommit={() => commit(`Vignette Midpoint ${Math.round(params.vignetteMidpoint)}`)}
        />
      </div>
      <div className="subgroup">
        <h4>Grain</h4>
        <Slider
          label="Amount"
          value={params.grainAmount}
          min={0}
          max={100}
          onChange={(v) => setParam("grainAmount", v)}
          onCommit={() => commit(`Grain ${Math.round(params.grainAmount)}`)}
        />
      </div>
    </PanelSection>
  );
}
