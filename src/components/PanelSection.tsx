import { useState } from "react";

interface PanelSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** Optional element rendered at the right edge of the header. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * the classic editor's core panel primitive: a collapsible section with a disclosure
 * triangle, stacked inside the left/right panel groups.
 */
export function PanelSection({
  title,
  defaultOpen = true,
  headerExtra,
  children,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel-section">
      <header className="panel-header" onClick={() => setOpen((o) => !o)}>
        <span className={`tri ${open ? "open" : ""}`}>▸</span>
        <span className="panel-title">{title}</span>
        {headerExtra && (
          <span className="panel-extra" onClick={(e) => e.stopPropagation()}>
            {headerExtra}
          </span>
        )}
      </header>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
