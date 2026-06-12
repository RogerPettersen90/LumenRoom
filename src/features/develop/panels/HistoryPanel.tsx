import { PanelSection } from "@/components/PanelSection";
import { useDevelopStore } from "@/store/developStore";

export function HistoryPanel() {
  const history = useDevelopStore((s) => s.history);
  const undo = useDevelopStore((s) => s.undo);
  const redo = useDevelopStore((s) => s.redo);
  const reset = useDevelopStore((s) => s.reset);
  const canUndo = useDevelopStore((s) => s.canUndo());
  const canRedo = useDevelopStore((s) => s.canRedo());

  return (
    <PanelSection title="History">
      {history.length === 0 ? (
        <p className="panel-muted">No edits yet.</p>
      ) : (
        <ul className="history-list">
          {[...history].reverse().map((step) => (
            <li key={step.seq}>{step.label}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button onClick={undo} disabled={!canUndo}>
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo}>
          Redo
        </button>
        <button onClick={() => void reset()}>Reset</button>
      </div>
    </PanelSection>
  );
}
