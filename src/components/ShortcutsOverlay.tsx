interface ShortcutsOverlayProps {
  onClose: () => void;
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Views & Modules",
    rows: [
      ["G", "Library Grid"],
      ["E / Enter", "Loupe"],
      ["C", "Compare"],
      ["N", "Survey"],
      ["D", "Develop selected"],
      ["Esc", "Back to Grid / cancel tool"],
      ["F", "Full screen"],
      ["L", "Lights Out (dim → off)"],
      ["I", "Info overlay"],
    ],
  },
  {
    title: "Panels",
    rows: [
      ["Tab / Shift+Tab", "Side panels / + filmstrip"],
      ["F6", "Filmstrip"],
      ["F7 / F8", "Left / right panels"],
      ["T", "Toolbar"],
    ],
  },
  {
    title: "Culling & Selection",
    rows: [
      ["← / → · Home / End", "Navigate photos"],
      ["P / X / U", "Pick / Reject / Unflag"],
      ["0–5 · 6–9", "Stars · color labels"],
      ["B", "Quick Collection"],
      ["Caps Lock", "Auto-advance"],
      ["Ctrl+A / Ctrl+D", "Select all / none"],
      ["Ctrl+L", "Filters on/off"],
      ["Ctrl+'", "Virtual copy"],
      ["Delete", "Remove from catalog"],
    ],
  },
  {
    title: "Develop & Zoom",
    rows: [
      ["R", "Crop & straighten"],
      ["O", "Mask overlay"],
      ["Y / \\", "Before / After"],
      ["J", "Clipping overlay"],
      ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
      ["Ctrl+Shift+C / V", "Copy / paste settings"],
      ["Ctrl+S", "Write XMP"],
      ["Z / Space", "Zoom Fit ↔ 100%"],
      ["Ctrl+= / Ctrl+-", "Zoom in / out"],
    ],
  },
];

/** Keyboard shortcut reference (?) — the classic pro-editor key layout. */
export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <div className="shortcuts-cols">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([key, desc]) => (
                  <div className="sc-row" key={key}>
                    <dt>
                      <kbd>{key}</kbd>
                    </dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="panel-muted">Press ? or Esc to close · Ctrl+, opens Preferences</p>
      </div>
    </div>
  );
}
