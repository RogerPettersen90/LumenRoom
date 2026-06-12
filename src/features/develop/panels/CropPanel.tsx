import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";
import { geometryIsIdentity } from "@/types/models";

/**
 * Crop & Straighten (R). Toggling the tool shows the overlay on the canvas
 * (full straightened frame); Done commits one history step. The angle slider
 * live-rotates with auto-zoom, exactly matching the export pipeline.
 */
export function CropPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const setMany = useDevelopStore((s) => s.setMany);
  const commit = useDevelopStore((s) => s.commit);
  const cropMode = useDevelopStore((s) => s.cropMode);
  const toggleCropMode = useDevelopStore((s) => s.toggleCropMode);
  const cropRatio = useDevelopStore((s) => s.cropRatio);
  const setCropRatio = useDevelopStore((s) => s.setCropRatio);

  const done = async () => {
    await commit("Crop & Straighten");
    if (cropMode) toggleCropMode();
  };

  const reset = () => {
    setMany({ cropX: 0, cropY: 0, cropW: 1, cropH: 1, angle: 0 });
  };

  return (
    <PanelSection title="Crop & Straighten">
      <div className="actions" style={{ marginTop: 0, marginBottom: 10 }}>
        <button className={cropMode ? "tool-active" : ""} onClick={toggleCropMode} title="Toggle crop tool (R)">
          {cropMode ? "◻ Cropping…" : "◻ Crop"}
        </button>
        {cropMode && <button onClick={() => void done()}>Done</button>}
        <button onClick={reset} disabled={geometryIsIdentity(params)}>
          Reset
        </button>
      </div>
      <div className="profile-row">
        <span>Aspect</span>
        <select
          value={cropRatio ?? "free"}
          onChange={(e) => setCropRatio(e.target.value === "free" ? null : e.target.value)}
        >
          <option value="free">Free</option>
          <option value="original">Original</option>
          <option value="1:1">1 : 1</option>
          <option value="5:4">5 : 4</option>
          <option value="4:3">4 : 3</option>
          <option value="3:2">3 : 2</option>
          <option value="16:9">16 : 9</option>
        </select>
      </div>
      <Slider
        label="Angle"
        value={params.angle}
        min={-45}
        max={45}
        step={0.1}
        onChange={(v) => setParam("angle", v)}
        onCommit={() => commit(`Straighten ${params.angle >= 0 ? "+" : ""}${params.angle.toFixed(1)}°`)}
      />
      <div className="subgroup">
        <h4>Transform</h4>
        <Slider
          label="Vertical"
          value={params.perspV}
          min={-100}
          max={100}
          onChange={(v) => setParam("perspV", v)}
          onCommit={() => commit(`Perspective V ${Math.round(params.perspV)}`)}
        />
        <Slider
          label="Horizontal"
          value={params.perspH}
          min={-100}
          max={100}
          onChange={(v) => setParam("perspH", v)}
          onCommit={() => commit(`Perspective H ${Math.round(params.perspH)}`)}
        />
      </div>
    </PanelSection>
  );
}
