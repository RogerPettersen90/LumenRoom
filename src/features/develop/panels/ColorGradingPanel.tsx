import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";
import type { NumericEditKey } from "@/types/models";
import { gradeIsIdentity, NEUTRAL_EDIT } from "@/types/models";

interface Zone {
  name: string;
  hue: NumericEditKey;
  sat: NumericEditKey;
  lum: NumericEditKey;
}

const ZONES: Zone[] = [
  { name: "Shadows", hue: "gradeShadowHue", sat: "gradeShadowSat", lum: "gradeShadowLum" },
  { name: "Midtones", hue: "gradeMidHue", sat: "gradeMidSat", lum: "gradeMidLum" },
  { name: "Highlights", hue: "gradeHighHue", sat: "gradeHighSat", lum: "gradeHighLum" },
];

/**
 * Color Grading (the classic 3-way split toning): tint shadows/midtones/highlights
 * independently, with Balance shifting the shadows↔highlights pivot. The chip
 * next to each zone previews the chosen tint.
 */
export function ColorGradingPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);

  const reset = () => {
    setMany({
      gradeShadowHue: NEUTRAL_EDIT.gradeShadowHue,
      gradeShadowSat: NEUTRAL_EDIT.gradeShadowSat,
      gradeShadowLum: NEUTRAL_EDIT.gradeShadowLum,
      gradeMidHue: NEUTRAL_EDIT.gradeMidHue,
      gradeMidSat: NEUTRAL_EDIT.gradeMidSat,
      gradeMidLum: NEUTRAL_EDIT.gradeMidLum,
      gradeHighHue: NEUTRAL_EDIT.gradeHighHue,
      gradeHighSat: NEUTRAL_EDIT.gradeHighSat,
      gradeHighLum: NEUTRAL_EDIT.gradeHighLum,
      gradeBalance: NEUTRAL_EDIT.gradeBalance,
    });
    void commit("Color Grading Reset");
  };

  return (
    <PanelSection title="Color Grading" defaultOpen={false}>
      {ZONES.map((z) => (
        <div className="subgroup" key={z.name}>
          <h4>
            {z.name}
            <span
              className="grade-chip"
              style={{
                background: `hsl(${params[z.hue]}, ${Math.max(8, params[z.sat])}%, 50%)`,
                opacity: params[z.sat] > 0 ? 1 : 0.35,
              }}
            />
          </h4>
          <Slider
            label="Hue"
            value={params[z.hue]}
            min={0}
            max={360}
            onChange={(v) => setParam(z.hue, v)}
            onCommit={() => commit(`${z.name} Hue ${Math.round(params[z.hue])}°`)}
          />
          <Slider
            label="Saturation"
            value={params[z.sat]}
            min={0}
            max={100}
            onChange={(v) => setParam(z.sat, v)}
            onCommit={() => commit(`${z.name} Grade Sat ${Math.round(params[z.sat])}`)}
          />
          <Slider
            label="Luminance"
            value={params[z.lum]}
            min={-100}
            max={100}
            onChange={(v) => setParam(z.lum, v)}
            onCommit={() => commit(`${z.name} Grade Lum ${Math.round(params[z.lum])}`)}
          />
        </div>
      ))}

      <div className="subgroup">
        <h4>Blend</h4>
        <Slider
          label="Balance"
          value={params.gradeBalance}
          min={-100}
          max={100}
          onChange={(v) => setParam("gradeBalance", v)}
          onCommit={() => commit(`Grade Balance ${Math.round(params.gradeBalance)}`)}
        />
      </div>

      <div className="actions">
        <button onClick={reset} disabled={gradeIsIdentity(params)}>
          Reset
        </button>
      </div>
    </PanelSection>
  );
}
