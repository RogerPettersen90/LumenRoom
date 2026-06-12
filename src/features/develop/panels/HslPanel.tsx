import { useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";
import { hslIsIdentity, NEUTRAL_EDIT } from "@/types/models";
import { HSL_BANDS } from "../hsl";

type Tab = "hslHue" | "hslSat" | "hslLum";

const TABS: { key: Tab; label: string }[] = [
  { key: "hslHue", label: "Hue" },
  { key: "hslSat", label: "Saturation" },
  { key: "hslLum", label: "Luminance" },
];

/**
 * HSL / Color Mixer (the classic HSL panel): 8 color bands × Hue/Sat/Luminance,
 * tabbed like the classic editors. Slider changes update live (shader LUT re-bake);
 * release commits one history step.
 */
export function HslPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const [tab, setTab] = useState<Tab>("hslSat");

  const values = params[tab];
  const tabLabel = TABS.find((t) => t.key === tab)!.label;

  const setBand = (i: number, v: number) => {
    const next = [...values];
    next[i] = v;
    setParam(tab, next);
  };

  const reset = () => {
    setParam("hslHue", [...NEUTRAL_EDIT.hslHue]);
    setParam("hslSat", [...NEUTRAL_EDIT.hslSat]);
    setParam("hslLum", [...NEUTRAL_EDIT.hslLum]);
    void commit("Color Mixer Reset");
  };

  return (
    <PanelSection title="Color Mixer" defaultOpen={false}>
      <div className="seg hsl-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {HSL_BANDS.map((band, i) => (
        <div className="hsl-row" key={band.name}>
          <span className="band-chip" style={{ background: band.color }} title={band.name} />
          <div className="hsl-slider">
            <Slider
              label={band.name}
              value={values[i]}
              min={-100}
              max={100}
              onChange={(v) => setBand(i, v)}
              onCommit={() =>
                commit(`${band.name} ${tabLabel} ${values[i] > 0 ? "+" : ""}${Math.round(values[i])}`)
              }
            />
          </div>
        </div>
      ))}

      <div className="actions">
        <button onClick={reset} disabled={hslIsIdentity(params)}>
          Reset All
        </button>
      </div>
    </PanelSection>
  );
}
