import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  /** Submenu (opens on hover, LR-style). */
  children?: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Custom right-click menu with one level of hover submenus. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once we know our size.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [onClose]);

  return (
    <div className="ctx-backdrop" onPointerDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className="ctx-menu"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MenuList items={items} onClose={onClose} />
      </div>
    </div>
  );
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);

  return (
    <ul>
      {items.map((item, i) =>
        item.separator ? (
          <li key={i} className="ctx-sep" />
        ) : (
          <li
            key={i}
            className={`ctx-item ${item.disabled ? "disabled" : ""} ${
              item.children ? "has-sub" : ""
            }`}
            onPointerEnter={() => setOpenSub(item.children ? i : null)}
            onClick={() => {
              if (item.disabled || item.children) return;
              item.action?.();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.children && <span className="ctx-arrow">▸</span>}
            {item.children && openSub === i && (
              <div className="ctx-submenu">
                <MenuList items={item.children} onClose={onClose} />
              </div>
            )}
          </li>
        )
      )}
    </ul>
  );
}
