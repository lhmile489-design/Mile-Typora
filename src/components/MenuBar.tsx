import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind: "separator" }
  | {
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      reason?: string;
    };

export type MenuGroup = {
  id: string;
  label: string;
  items: MenuItem[];
};

type Props = {
  menus: MenuGroup[];
  onCommand: (id: string) => void;
};

/**
 * The P1 menu bar (PRD §15, P1 §8). A menu item and its shortcut call the same
 * command in App; disabled items keep their reason in the tooltip.
 */
export function MenuBar({ menus, onCommand }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const tops = useRef<Array<HTMLButtonElement | null>>([]);
  const items = useRef<Array<Array<HTMLButtonElement | null>>>([]);
  const focusFirst = useRef(false);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open === null || !focusFirst.current) return;
    const list = items.current[open] ?? [];
    list.find((item) => item && !item.getAttribute("aria-disabled"))?.focus();
    focusFirst.current = false;
  }, [open]);

  const openMenu = (index: number, focus = false) => {
    focusFirst.current = focus;
    setOpen(index);
  };

  const activate = (index: number) => {
    const button = tops.current[index];
    if (!button) return;
    openMenu(index, true);
    button.focus();
  };

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (open === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(null);
      tops.current[open]?.focus();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (open + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length;
      activate(next);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = (items.current[open] ?? []).filter(
        (item): item is HTMLButtonElement => Boolean(item) && item?.getAttribute("aria-disabled") !== "true",
      );
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = current < 0 ? (step > 0 ? 0 : list.length - 1) : (current + step + list.length) % list.length;
      list[next]?.focus();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      const list = (items.current[open] ?? []).filter(
        (item): item is HTMLButtonElement => Boolean(item) && item?.getAttribute("aria-disabled") !== "true",
      );
      if (list.length > 0) {
        e.preventDefault();
        (e.key === "Home" ? list[0] : list[list.length - 1])?.focus();
      }
    }
  };

  return (
    <div className="menubar" role="menubar" aria-label="菜单栏" ref={root} onKeyDown={onRootKeyDown}>
      {menus.map((menu, index) => (
        <div className="menu-root" key={menu.id}>
          <button
            className="menu-title"
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === index}
            ref={(node) => {
              tops.current[index] = node;
            }}
            onClick={() => (open === index ? setOpen(null) : openMenu(index))}
            onMouseEnter={() => {
              if (open !== null) openMenu(index);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openMenu(index, true);
              }
            }}
          >
            {menu.label}
          </button>
          {open === index && (
            <div className="menu-pop" role="menu" aria-label={menu.label}>
              {menu.items.map((item, itemIndex) => {
                if ("kind" in item) return <div className="menu-sep" role="separator" key={`sep-${itemIndex}`} />;
                const disabled = item.disabled === true;
                return (
                  <button
                    className="menu-item"
                    type="button"
                    role="menuitem"
                    key={item.id}
                    aria-disabled={disabled || undefined}
                    title={disabled ? item.reason : undefined}
                    ref={(node) => {
                      items.current[index] ??= [];
                      items.current[index][itemIndex] = node;
                    }}
                    onClick={() => {
                      if (disabled) return;
                      setOpen(null);
                      onCommand(item.id);
                    }}
                  >
                    <span className="label">{item.label}</span>
                    {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
