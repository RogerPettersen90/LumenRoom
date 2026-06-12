import { useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore } from "@/store/catalogStore";
import { getEditParams, saveEditParams } from "@/api/commands";
import type { NumericEditKey } from "@/types/models";
import { NEUTRAL_EDIT } from "@/types/models";

interface NudgeRow {
  key: NumericEditKey;
  label: string;
  small: number;
  large: number;
  min: number;
  max: number;
}

// the classic editor's Quick Develop applies *relative* adjustments — nudge buttons,
// not absolute sliders — so one click can push a whole selection in the same
// direction without overwriting each photo's individual settings.
const ROWS: NudgeRow[] = [
  { key: "exposure", label: "Exposure", small: 1 / 3, large: 1, min: -5, max: 5 },
  { key: "contrast", label: "Contrast", small: 5, large: 20, min: -100, max: 100 },
  { key: "highlights", label: "Highlights", small: 5, large: 20, min: -100, max: 100 },
  { key: "shadows", label: "Shadows", small: 5, large: 20, min: -100, max: 100 },
  { key: "clarity", label: "Clarity", small: 5, large: 20, min: -100, max: 100 },
  { key: "vibrance", label: "Vibrance", small: 5, large: 20, min: -100, max: 100 },
];

export function QuickDevelopPanel() {
  const selection = useCatalogStore((s) => s.selection);
  const selectedId = useCatalogStore((s) => s.selectedId);
  const [busy, setBusy] = useState(false);

  const targets = selection.length > 0 ? selection : selectedId ? [selectedId] : [];

  const nudge = async (row: NudgeRow, delta: number) => {
    if (targets.length === 0 || busy) return;
    setBusy(true);
    try {
      await Promise.all(
        targets.map(async (id) => {
          const params = await getEditParams(id);
          const next = {
            ...params,
            [row.key]: clamp(params[row.key] + delta, row.min, row.max),
          };
          const sign = delta > 0 ? "+" : "";
          await saveEditParams(id, next, `Quick ${row.label} ${sign}${round2(delta)}`);
        })
      );
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    if (targets.length === 0 || busy) return;
    setBusy(true);
    try {
      await Promise.all(
        targets.map((id) => saveEditParams(id, { ...NEUTRAL_EDIT }, "Reset (Quick Develop)"))
      );
    } finally {
      setBusy(false);
    }
  };

  const disabled = targets.length === 0 || busy;

  return (
    <PanelSection title="Quick Develop" defaultOpen={false}>
      {ROWS.map((row) => (
        <div className="qd-row" key={row.key}>
          <span className="qd-label">{row.label}</span>
          <span className="qd-buttons">
            <button disabled={disabled} onClick={() => nudge(row, -row.large)} title={`−${round2(row.large)}`}>
              ◀◀
            </button>
            <button disabled={disabled} onClick={() => nudge(row, -row.small)} title={`−${round2(row.small)}`}>
              ◀
            </button>
            <button disabled={disabled} onClick={() => nudge(row, row.small)} title={`+${round2(row.small)}`}>
              ▶
            </button>
            <button disabled={disabled} onClick={() => nudge(row, row.large)} title={`+${round2(row.large)}`}>
              ▶▶
            </button>
          </span>
        </div>
      ))}
      <div className="qd-footer">
        <button disabled={disabled} onClick={resetAll}>
          Reset All
        </button>
        <span className="panel-muted">
          {targets.length > 1 ? `${targets.length} photos` : ""}
        </span>
      </div>
    </PanelSection>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
