import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { getPrefs, lookupLensProfile, setPrefs } from "@/api/commands";
import { useCatalogStore } from "@/store/catalogStore";
import { useDevelopStore } from "@/store/developStore";
import { useEffect, useState } from "react";

interface LensDefault {
  distortion: number;
  caRed: number;
  caBlue: number;
}

/**
 * Lens Corrections: manual distortion (barrel/pincushion) + lateral CA, with
 * per-lens defaults — save once for the lens on this photo, apply with one
 * click on any photo shot with it. (Automatic lensfun profiles still planned.)
 */
export function LensPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);
  const imageId = useDevelopStore((s) => s.imageId);
  const lens = useCatalogStore((s) => (imageId ? (s.byId[imageId]?.lens ?? null) : null));

  const [saved, setSaved] = useState<LensDefault | null>(null);
  const focal = useCatalogStore((s) =>
    imageId ? (s.byId[imageId]?.focalLength ?? null) : null
  );
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileMiss, setProfileMiss] = useState(false);
  const profileOn =
    params.lensA !== 0 || params.lensB !== 0 || params.lensC !== 0;

  useEffect(() => {
    setProfileName(null);
    setProfileMiss(false);
  }, [imageId]);

  /** lensfun lookup → write the cubic + CA into the edit (one history step). */
  const applyProfile = async () => {
    if (!lens) return;
    const p = await lookupLensProfile(lens, focal).catch(() => null);
    if (!p) {
      setProfileMiss(true);
      return;
    }
    setProfileName(p.matched);
    setProfileMiss(false);
    setMany({
      lensA: p.lensA,
      lensB: p.lensB,
      lensC: p.lensC,
      caRed: p.caRed,
      caBlue: p.caBlue,
    });
    void commit(`Lens profile (${p.matched})`);
  };

  const clearProfile = () => {
    setMany({ lensA: 0, lensB: 0, lensC: 0 });
    setProfileName(null);
    void commit("Lens profile off");
  };

  useEffect(() => {
    if (!lens) {
      setSaved(null);
      return;
    }
    void getPrefs()
      .then((p) => {
        const raw = p.lensDefaults?.[lens];
        setSaved(raw ? (JSON.parse(raw) as LensDefault) : null);
      })
      .catch(() => setSaved(null));
  }, [lens, imageId]);

  const saveDefault = async () => {
    if (!lens) return;
    const d: LensDefault = {
      distortion: params.distortion,
      caRed: params.caRed,
      caBlue: params.caBlue,
    };
    const p = await getPrefs();
    await setPrefs({ ...p, lensDefaults: { ...p.lensDefaults, [lens]: JSON.stringify(d) } });
    setSaved(d);
  };

  const applyDefault = () => {
    if (!saved) return;
    setMany({ distortion: saved.distortion, caRed: saved.caRed, caBlue: saved.caBlue });
    void commit(`Lens default (${lens})`);
  };

  return (
    <PanelSection title="Lens Corrections" defaultOpen={false}>
      <div className="subgroup">
        <h4>Profile</h4>
        {lens ? (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button onClick={() => void applyProfile()} title="Match this lens against the lensfun database (951 lenses) and apply its distortion + CA calibration">
                {profileOn ? "Re-match profile" : "Enable Profile Corrections"}
              </button>
              {profileOn && <button onClick={clearProfile}>Off</button>}
            </div>
            {profileName && <p className="panel-muted">✓ {profileName}</p>}
            {profileMiss && (
              <p className="panel-muted">
                No profile for “{lens}” — use the manual sliders below.
              </p>
            )}
          </>
        ) : (
          <p className="panel-muted">No lens in EXIF — manual corrections only.</p>
        )}
      </div>
      <div className="subgroup">
        <h4>Distortion</h4>
        <Slider
          label="Distortion"
          value={params.distortion}
          min={-100}
          max={100}
          onChange={(v) => setParam("distortion", v)}
          onCommit={() => commit(`Distortion ${Math.round(params.distortion)}`)}
        />
      </div>
      <div className="subgroup">
        <h4>Chromatic Aberration</h4>
        <Slider
          label="Red / Cyan"
          value={params.caRed}
          min={-100}
          max={100}
          onChange={(v) => setParam("caRed", v)}
          onCommit={() => commit(`CA Red ${Math.round(params.caRed)}`)}
        />
        <Slider
          label="Blue / Yellow"
          value={params.caBlue}
          min={-100}
          max={100}
          onChange={(v) => setParam("caBlue", v)}
          onCommit={() => commit(`CA Blue ${Math.round(params.caBlue)}`)}
        />
      </div>
      {lens ? (
        <div className="subgroup">
          <h4>Lens Defaults</h4>
          <p className="panel-muted">{lens}</p>
          <div className="actions">
            <button onClick={() => void saveDefault()}>Save for this lens</button>
            <button onClick={applyDefault} disabled={!saved}>
              Apply saved
            </button>
          </div>
        </div>
      ) : (
        <p className="panel-muted">No lens in EXIF — corrections are manual only.</p>
      )}
    </PanelSection>
  );
}
