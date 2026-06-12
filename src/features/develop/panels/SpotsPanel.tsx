import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { useDevelopStore } from "@/store/developStore";

/**
 * Heal/Clone (the classic spot removal): arm the tool, click blemishes on the photo,
 * drag the dashed source circle to pick clean pixels. Heal blends tone;
 * Clone copies exactly.
 */
export function SpotsPanel() {
  const params = useDevelopStore((s) => s.params);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const spotTool = useDevelopStore((s) => s.spotTool);
  const setSpotTool = useDevelopStore((s) => s.setSpotTool);
  const spotMode = useDevelopStore((s) => s.spotMode);
  const setSpotMode = useDevelopStore((s) => s.setSpotMode);

  /** Heal and Clone arm as separate tools; clicking the active one disarms. */
  const arm = (mode: "heal" | "clone") => {
    if (spotTool && spotMode === mode) {
      setSpotTool(false);
      return;
    }
    setSpotMode(mode);
    setSpotTool(true);
  };
  const activeIdx = useDevelopStore((s) => s.activeSpotIndex);
  const setActiveIdx = useDevelopStore((s) => s.setActiveSpotIndex);

  const sel = params.spots[activeIdx];

  const update = (patch: Partial<NonNullable<typeof sel>>, label?: string) => {
    setParam(
      "spots",
      params.spots.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s))
    );
    if (label) void commit(label);
  };

  const remove = (i: number) => {
    setParam(
      "spots",
      params.spots.filter((_, idx) => idx !== i)
    );
    setActiveIdx(Math.max(0, Math.min(activeIdx, params.spots.length - 2)));
    void commit("Delete spot");
  };

  return (
    <PanelSection title="Heal / Clone" defaultOpen={false}>
      <div className="actions" style={{ marginTop: 0, marginBottom: 10 }}>
        <button
          className={spotTool && spotMode === "heal" ? "tool-active" : ""}
          onClick={() => arm("heal")}
          disabled={!spotTool && params.spots.length >= 8}
          title="Heal: replace + blend tone with the surroundings"
        >
          ◌ Heal
        </button>
        <button
          className={spotTool && spotMode === "clone" ? "tool-active" : ""}
          onClick={() => arm("clone")}
          disabled={!spotTool && params.spots.length >= 8}
          title="Clone: copy source pixels exactly"
        >
          ⧇ Clone
        </button>
        {spotTool && (
          <button
            onClick={() => {
              setSpotTool(false);
              void commit("Spots applied");
            }}
          >
            Apply
          </button>
        )}
      </div>

      {params.spots.length === 0 ? (
        <p className="panel-muted">No spots. Arm the tool, then click a blemish.</p>
      ) : (
        <ul className="named-list">
          {params.spots.map((s, i) => (
            <li key={i} className={i === activeIdx ? "active" : ""} onClick={() => setActiveIdx(i)}>
              <span className="fname">
                {i + 1}. {s.heal ? "Heal" : "Clone"}
              </span>
              <button
                className="row-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                title="Delete spot"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {sel && (
        <>
          <div className="seg hsl-tabs">
            <button className={sel.heal ? "active" : ""} onClick={() => update({ heal: true }, "Spot → Heal")}>
              Heal
            </button>
            <button className={!sel.heal ? "active" : ""} onClick={() => update({ heal: false }, "Spot → Clone")}>
              Clone
            </button>
          </div>
          <Slider
            label="Size"
            value={sel.radius}
            min={0.01}
            max={0.2}
            step={0.005}
            onChange={(v) => update({ radius: v })}
            onCommit={() => commit("Spot size")}
          />
          <Slider
            label="Feather"
            value={sel.feather}
            min={0}
            max={0.95}
            step={0.01}
            onChange={(v) => update({ feather: v })}
            onCommit={() => commit("Spot feather")}
          />
        </>
      )}
    </PanelSection>
  );
}
