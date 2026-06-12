import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/components/Slider";
import { generateSubjectMask } from "@/api/commands";
import { useState } from "react";
import { useDevelopStore } from "@/store/developStore";
import type { Mask } from "@/types/models";
import { DEFAULT_RADIAL_MASK } from "@/types/models";

const MAX_MASKS = 4;

const KIND_LABEL: Record<string, string> = {
  linear: "Linear gradient",
  radial: "Radial gradient",
  brush: "Brush (legacy)",
};

/** Raster masks carry their generator in the raster id. */
function maskLabel(m: Mask): string {
  if (m.kind === "global") {
    if (m.rangeType === "luminance") return m.rangeLo >= 0.5 ? "Lights" : m.rangeHi <= 0.5 ? "Darks" : "Luminance";
    return m.rangeType === "color" ? "Color range" : "Whole photo";
  }
  if (m.kind !== "raster") return KIND_LABEL[m.kind] ?? m.kind;
  if (m.rasterId.includes("-subject-")) return "Subject";
  if (m.rasterId.includes("-lum-highlights-")) return "Lights";
  if (m.rasterId.includes("-lum-shadows-")) return "Darks";
  if (m.rasterId.includes("-lum-midtones-")) return "Midtones";
  return "Brush";
}

/**
 * Local adjustment masks (linear/radial gradients), like the classic Masking tool.
 * +Linear/+Radial arms placement: drag directly on the photo to define the
 * mask. The active mask shows draggable handles on the canvas; the sliders
 * below fine-tune geometry and carry the local adjustments.
 */
export function MaskingPanel() {
  const masks = useDevelopStore((s) => s.params.masks);
  const setParam = useDevelopStore((s) => s.setParam);
  const commit = useDevelopStore((s) => s.commit);
  const active = useDevelopStore((s) => s.activeMaskIndex);
  const setActive = useDevelopStore((s) => s.setActiveMaskIndex);
  const maskDraft = useDevelopStore((s) => s.maskDraft);
  const setMaskDraft = useDevelopStore((s) => s.setMaskDraft);
  const maskOverlay = useDevelopStore((s) => s.maskOverlay);
  const setMaskOverlay = useDevelopStore((s) => s.setMaskOverlay);
  const brushErase = useDevelopStore((s) => s.brushErase);
  const setBrushErase = useDevelopStore((s) => s.setBrushErase);
  const brushSize = useDevelopStore((s) => s.brushSize);
  const setBrushSize = useDevelopStore((s) => s.setBrushSize);
  const brushFeather = useDevelopStore((s) => s.brushFeather);
  const setBrushFeather = useDevelopStore((s) => s.setBrushFeather);

  const sel: Mask | undefined = masks[active];

  const update = (patch: Partial<Mask>, label?: string) => {
    const next = masks.map((m, i) => (i === active ? { ...m, ...patch } : m));
    setParam("masks", next);
    if (label) void commit(label);
  };

  const arm = (kind: "linear" | "radial" | "brush") => {
    setMaskDraft(maskDraft === kind ? null : kind);
  };

  const [aiBusy, setAiBusy] = useState(false);

  /** Append a generated raster mask, select it, and show the green
   * selection tint so the result is visible immediately. */
  const addRaster = (rasterId: string, label: string) => {
    const next: Mask[] = [...masks, { ...DEFAULT_RADIAL_MASK, kind: "raster", rasterId }];
    setParam("masks", next);
    setActive(next.length - 1);
    setMaskOverlay(true);
    void commit(label);
  };

  /** Luminosity mask, evaluated PER-PIXEL at full resolution (a "global"
   * mask shaped only by the luminance range refinement) — no baked map, so
   * no upsampling halos around contrasty edges. */
  const addLuminosity = (mode: "highlights" | "shadows") => {
    if (masks.length >= MAX_MASKS) return;
    const range =
      mode === "highlights"
        ? { rangeLo: 0.55, rangeHi: 1.0 }
        : { rangeLo: 0.0, rangeHi: 0.45 };
    const next: Mask[] = [
      ...masks,
      {
        ...DEFAULT_RADIAL_MASK,
        kind: "global",
        rasterId: "",
        rangeType: "luminance",
        rangeSoft: 0.15,
        ...range,
      },
    ];
    setParam("masks", next);
    setActive(next.length - 1);
    void commit(`Luminosity mask (${mode})`);
  };

  /** AI Select Subject: local U²-Net inference (model fetched on first use). */
  const addSubject = async () => {
    const imageId = useDevelopStore.getState().imageId;
    if (!imageId || masks.length >= MAX_MASKS || aiBusy) return;
    setAiBusy(true);
    try {
      addRaster(await generateSubjectMask(imageId), "Select Subject");
    } catch (e) {
      console.error("subject mask failed:", e);
      window.alert(`Select Subject failed: ${e}`);
    } finally {
      setAiBusy(false);
    }
  };

  const remove = (i: number) => {
    const next = masks.filter((_, idx) => idx !== i);
    setParam("masks", next);
    setActive(Math.max(0, Math.min(active, next.length - 1)));
    void commit("Delete mask");
  };

  const slider = (
    label: string,
    key: keyof Mask,
    min: number,
    max: number,
    step?: number
  ) =>
    sel && (
      <Slider
        label={label}
        value={sel[key] as number}
        min={min}
        max={max}
        step={step}
        onChange={(v) => update({ [key]: v })}
        onCommit={() => commit(`Mask ${label}`)}
      />
    );

  return (
    <PanelSection title="Masking" defaultOpen={false}>
      <div className="actions" style={{ marginTop: 0, marginBottom: 10 }}>
        <button
          className={maskDraft === "linear" ? "tool-active" : ""}
          onClick={() => arm("linear")}
          disabled={masks.length >= MAX_MASKS}
        >
          + Linear
        </button>
        <button
          className={maskDraft === "radial" ? "tool-active" : ""}
          onClick={() => arm("radial")}
          disabled={masks.length >= MAX_MASKS}
        >
          + Radial
        </button>
        <button
          className={maskDraft === "brush" ? "tool-active" : ""}
          onClick={() => arm("brush")}
          disabled={!maskDraft && masks.length >= MAX_MASKS}
          title="Paint a freeform mask — unlimited strokes, Erase to subtract, Apply to finish"
        >
          + Brush
        </button>
        <button
          onClick={() => void addSubject()}
          disabled={masks.length >= MAX_MASKS || masks.some((m) => m.kind === "raster") || aiBusy}
          title="AI Select Subject — local U²-Net segmentation (first use downloads a 4.6MB model). Add + Invert for a sky/background mask."
        >
          {aiBusy ? "Selecting…" : "+ Subject"}
        </button>
        <button
          onClick={() => addLuminosity("highlights")}
          disabled={masks.length >= MAX_MASKS}
          title="Per-pixel luminosity mask targeting the highlights (tune via Range)"
        >
          + Lights
        </button>
        <button
          onClick={() => addLuminosity("shadows")}
          disabled={masks.length >= MAX_MASKS}
          title="Per-pixel luminosity mask targeting the shadows (tune via Range)"
        >
          + Darks
        </button>
        <button
          className={maskOverlay ? "tool-active" : ""}
          onClick={() => setMaskOverlay(!maskOverlay)}
          title="Show mask handles on the photo"
          disabled={masks.length === 0 && !maskDraft}
        >
          ⊙
        </button>
        {(maskOverlay || maskDraft) && (
          <button
            onClick={() => void useDevelopStore.getState().applyMaskSession()}
            title="Apply the mask and dismiss the overlay (or double-click the photo)"
          >
            Apply
          </button>
        )}
      </div>
      {maskDraft === "brush" && (
        <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}>
          <div className="seg" style={{ flex: 1 }}>
            <button className={!brushErase ? "active" : ""} onClick={() => setBrushErase(false)}>
              Paint
            </button>
            <button className={brushErase ? "active" : ""} onClick={() => setBrushErase(true)}>
              Erase
            </button>
          </div>
        </div>
      )}
      {maskDraft === "brush" && (
        <>
          <Slider
            label="Brush Size"
            value={brushSize}
            min={0.01}
            max={0.2}
            step={0.005}
            onChange={(v) => setBrushSize(v)}
            onCommit={() => undefined}
          />
          <Slider
            label="Brush Feather"
            value={brushFeather}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setBrushFeather(v)}
            onCommit={() => undefined}
          />
        </>
      )}
      {maskDraft && (
        <p className="panel-muted">
          {maskDraft === "brush"
            ? "Paint freely — unlimited strokes, switch to Erase to subtract; Apply (or double-click the photo) when happy."
            : `Drag on the photo to place the ${maskDraft} mask.`}
        </p>
      )}

      {masks.length === 0 ? (
        <p className="panel-muted">No masks. Add a linear or radial gradient.</p>
      ) : (
        <ul className="named-list mask-layers">
          {masks.map((m, i) => (
            <li
              key={i}
              className={i === active ? "active" : ""}
              onClick={() => {
                // Layer click: select for editing AND show its handles —
                // every mask stays revisitable, LR-style.
                setActive(i);
                setMaskOverlay(true);
              }}
              title="Click to edit this mask (geometry, range, adjustments)"
            >
              <span className="fname">
                {i + 1} · {maskLabel(m)}
                {m.kind === "raster" && m.rasterId === "" && " (painting…)"}
              </span>
              <button
                className="row-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                title="Delete mask"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {sel && (
        <>
          <div className="subgroup">
            <h4>Geometry</h4>
            {sel.kind === "global" ? (
              <p className="panel-muted">
                Whole photo, shaped by the Range section below (per-pixel —
                no halos). Tune Range Low/High/Soft to taste.
              </p>
            ) : sel.kind === "raster" ? (
              <p className="panel-muted">
                Painted/generated weight map — re-arm + Brush to paint or erase
                more, or refine with Range below.
              </p>
            ) : sel.kind === "brush" ? (
              <>
                {slider("Brush Size", "x1", 0.01, 0.3, 0.005)}
                {slider("Feather", "feather", 0, 0.99, 0.01)}
                <p className="panel-muted">{sel.points.length} stroke points · drag on photo to move</p>
              </>
            ) : sel.kind === "radial" ? (
              <>
                {slider("Center X", "x0", 0, 1, 0.01)}
                {slider("Center Y", "y0", 0, 1, 0.01)}
                {slider("Radius X", "x1", 0.02, 1, 0.01)}
                {slider("Radius Y", "y1", 0.02, 1, 0.01)}
                {slider("Rotate", "rotation", -180, 180, 1)}
                {slider("Feather", "feather", 0, 0.99, 0.01)}
              </>
            ) : (
              <>
                {slider("Start X", "x0", 0, 1, 0.01)}
                {slider("Start Y", "y0", 0, 1, 0.01)}
                {slider("End X", "x1", 0, 1, 0.01)}
                {slider("End Y", "y1", 0, 1, 0.01)}
                {slider("Feather", "feather", 0.01, 1, 0.01)}
              </>
            )}
            <label className="mask-invert">
              <input
                type="checkbox"
                checked={sel.invert}
                onChange={(e) => update({ invert: e.target.checked }, "Mask Invert")}
              />
              Invert
            </label>
          </div>
          <div className="subgroup">
            <h4>Range</h4>
            <div className="seg hsl-tabs">
              {(["none", "luminance", "color"] as const).map((t) => (
                <button
                  key={t}
                  className={sel.rangeType === t ? "active" : ""}
                  onClick={() => update({ rangeType: t }, `Mask Range ${t}`)}
                >
                  {t === "none" ? "Off" : t === "luminance" ? "Lum" : "Color"}
                </button>
              ))}
            </div>
            {sel.rangeType === "luminance" && (
              <>
                {slider("Range Low", "rangeLo", 0, 1, 0.01)}
                {slider("Range High", "rangeHi", 0, 1, 0.01)}
                {slider("Softness", "rangeSoft", 0.01, 0.5, 0.01)}
              </>
            )}
            {sel.rangeType === "color" && (
              <>
                {slider("Hue", "rangeHue", 0, 360, 1)}
                {slider("Tolerance", "rangeTol", 0.05, 1, 0.01)}
              </>
            )}
          </div>
          <div className="subgroup">
            <h4>Adjustments</h4>
            {slider("Exposure", "exposure", -3, 3, 0.01)}
            {slider("Contrast", "contrast", -100, 100)}
            {slider("Saturation", "saturation", -100, 100)}
            {slider("Temp", "temperature", -100, 100)}
            {slider("Tint", "tint", -100, 100)}
          </div>
        </>
      )}
    </PanelSection>
  );
}
