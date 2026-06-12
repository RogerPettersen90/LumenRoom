import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { PROFILES, profileLook } from "@/features/develop/profiles";
import { useDevelopStore } from "@/store/developStore";
import type { NumericEditKey } from "@/types/models";

interface Adjustment {
  key: NumericEditKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

// the classic editor's Basic panel grouping: WB → Tone → Presence.
const WB: Adjustment[] = [
  { key: "temperature", label: "Temp", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
];

const TONE: Adjustment[] = [
  { key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.01 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "whites", label: "Whites", min: -100, max: 100 },
  { key: "blacks", label: "Blacks", min: -100, max: 100 },
];

const PRESENCE: Adjustment[] = [
  { key: "texture", label: "Texture", min: -100, max: 100 },
  { key: "clarity", label: "Clarity", min: -100, max: 100 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
];

export function BasicPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);

  const setTreatment = (bw: boolean) => {
    if (params.blackWhite === bw) return;
    setParam("blackWhite", bw);
    void commit(bw ? "Black & White" : "Color");
  };

  const setProfile = (id: string) => {
    if (params.profile === id) return;
    setParam("profile", id);
    void commit(`Profile: ${profileLook(id).label}`);
  };

  const group = (title: string, items: Adjustment[]) => (
    <div className="subgroup">
      <h4>{title}</h4>
      {items.map((a) => (
        <Slider
          key={a.key}
          label={a.label}
          value={params[a.key]}
          min={a.min}
          max={a.max}
          step={a.step}
          onChange={(v) => setParam(a.key, v)}
          onCommit={() => commit(`${a.label} ${formatDelta(params[a.key])}`)}
        />
      ))}
    </div>
  );

  return (
    <PanelSection title="Basic">
      <div className="profile-row">
        <span>Profile</span>
        <select value={params.profile} onChange={(e) => setProfile(e.target.value)}>
          {PROFILES.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.label}
            </option>
          ))}
        </select>
      </div>
      <div className="seg treatment">
        <button className={!params.blackWhite ? "active" : ""} onClick={() => setTreatment(false)}>
          Color
        </button>
        <button className={params.blackWhite ? "active" : ""} onClick={() => setTreatment(true)}>
          B&amp;W
        </button>
      </div>
      {group("WB", WB)}
      {group("Tone", TONE)}
      {group("Presence", PRESENCE)}
    </PanelSection>
  );
}

function formatDelta(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}
