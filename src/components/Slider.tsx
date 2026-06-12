import { useCallback } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Live update (every frame) — drive the canvas, don't persist. */
  onChange: (value: number) => void;
  /** Commit (on release) — push history + persist. */
  onCommit?: () => void;
}

/**
 * A classic-style slider. Dragging fires `onChange` continuously; releasing
 * (mouse up / double-click reset) fires `onCommit`. Double-clicking the value
 * resets to zero.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: SliderProps) {
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value)),
    [onChange]
  );

  const reset = useCallback(() => {
    onChange(0);
    onCommit?.();
  }, [onChange, onCommit]);

  return (
    <div className="slider">
      <div className="row">
        <span className="label">{label}</span>
        <span className="value" onDoubleClick={reset} title="Double-click to reset">
          {value > 0 ? `+${formatVal(value, step)}` : formatVal(value, step)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleInput}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

function formatVal(v: number, step: number): string {
  return step < 1 ? v.toFixed(2) : Math.round(v).toString();
}
