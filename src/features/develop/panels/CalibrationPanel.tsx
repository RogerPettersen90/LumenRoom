import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";
import type { NumericEditKey } from "@/types/models";
import { calibrationIsIdentity } from "../calibration";

const PRIMARIES: { name: string; hue: NumericEditKey; sat: NumericEditKey; chip: string }[] = [
  { name: "Red Primary", hue: "calRedHue", sat: "calRedSat", chip: "#e5484d" },
  { name: "Green Primary", hue: "calGreenHue", sat: "calGreenSat", chip: "#3ecf6a" },
  { name: "Blue Primary", hue: "calBlueHue", sat: "calBlueSat", chip: "#4a9eff" },
];

/**
 * Calibration (the classic deepest color panel): remap how the sensor's RGB
 * primaries read, in linear light before everything else. Shifting the blue
 * primary's hue toward teal is the classic cinematic look.
 */
export function CalibrationPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);

  const reset = () => {
    setMany({
      calRedHue: 0,
      calRedSat: 0,
      calGreenHue: 0,
      calGreenSat: 0,
      calBlueHue: 0,
      calBlueSat: 0,
    });
    void commit("Calibration Reset");
  };

  return (
    <PanelSection title="Calibration" defaultOpen={false}>
      {PRIMARIES.map((p) => (
        <div className="subgroup" key={p.name}>
          <h4>
            {p.name}
            <span className="grade-chip" style={{ background: p.chip }} />
          </h4>
          <Slider
            label="Hue"
            value={params[p.hue]}
            min={-100}
            max={100}
            onChange={(v) => setParam(p.hue, v)}
            onCommit={() => commit(`${p.name} Hue ${Math.round(params[p.hue])}`)}
          />
          <Slider
            label="Saturation"
            value={params[p.sat]}
            min={-100}
            max={100}
            onChange={(v) => setParam(p.sat, v)}
            onCommit={() => commit(`${p.name} Sat ${Math.round(params[p.sat])}`)}
          />
        </div>
      ))}
      <div className="actions">
        <button onClick={reset} disabled={calibrationIsIdentity(params)}>
          Reset
        </button>
      </div>
    </PanelSection>
  );
}
