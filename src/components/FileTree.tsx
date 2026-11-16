import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, FileText, Folder, SquarePlus } from "lucide-react";
import type { TreeEntry } from "../lib/transport";

type Props = {
  /** Name of the open folder, shown as the tree's root row. */
  rootName: string;
  /** Rows in tree order, as the scan streams them. */
  entries: TreeEntry[];
  /** Path of the selected file, or null. */
  selected: string | null;
  /** Opens a file in this window. */
  onOpen: (entry: TreeEntry) => void;
  /** Opens a file in a window of its own (PRD FR-02.4). */
  onOpenInNewWindow: (entry: TreeEntry) => void;
  /** A message about the scan itself (partial results, a bound), if any. */
  notice?: string | null;
  /** True while rows are still arriving. */
  busy?: boolean;
};

const ROW_HEIGHT = 28;

/** visible drops what a collapsed folder hides. Entries come in tree order. */
export function visibleRows(entries: TreeEntry[], collapsed: Set<string>): TreeEntry[] {
  const rows: TreeEntry[] = [];
  let hiddenUnder: string | null = null;
  for (const entry of entries) {
    if (hiddenUnder && (entry.path === hiddenUnder || entry.path.startsWith(hiddenUnder + "/"))) {
      continue;
    }
    hiddenUnder = null;
    rows.push(entry);
    if (entry.isDir && collapsed.has(entry.path)) hiddenUnder = entry.path;
  }
  return rows;
}

/** depth is how many folders lead to a row. */
export function depthOf(path: string): number {
  let depth = 0;
  for (const c of path) if (c === "/") depth += 1;
  return depth;
}

/**
 * The folder tree (DESIGN.md §8.2): 28 px rows, folders first, a virtual list
 * so ten thousand files stay smooth, and the arrow keys from PRD FR-09.
 */
export function FileTree({ rootName, entries, selected, onOpen, onOpenInNewWindow, notice, busy }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const rows = useMemo(() => visibleRows(entries, collapsed), [entries, collapsed]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    setFocusIndex(clamped);
    virtualizer.scrollToIndex(clamped, { align: "auto" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[focusIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        goTo(focusIndex + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        goTo(focusIndex - 1);
        return;
      case "Home":
        e.preventDefault();
        goTo(0);
        return;
      case "End":
        e.preventDefault();
        goTo(rows.length - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        if (!row) return;
        if (row.isDir && collapsed.has(row.path)) toggle(row.path);
        else goTo(focusIndex + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (!row) return;
        if (row.isDir && !collapsed.has(row.path)) {
          toggle(row.path);
          return;
        }
        // Up to the parent folder.
        {
          const parent = row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
          const at = rows.findIndex((candidate) => candidate.isDir && candidate.path === parent);
          goTo(at >= 0 ? at : 0);
        }
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (row && !row.isDir) onOpen(row);
        return;
    }
  };

  return (
    <div className="tree-pane">
      {busy && <div className="tree-busy">正在读取文件夹…</div>}
      {notice && <div className="tree-notice">{notice}</div>}
      <div className="tree-root" title={rootName}>
        <Folder aria-hidden="true" />
        <span className="nm">{rootName}</span>
      </div>
      <div
        ref={scrollRef}
        className="tree-scroll"
        role="tree"
        aria-label="文件树"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const isCollapsed = row.isDir && collapsed.has(row.path);
            return (
              <div
                key={row.path}
                className={[
                  "ti",
                  item.index === focusIndex ? "focus" : "",
                  row.path === selected ? "sel" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="treeitem"
                aria-level={depthOf(row.path) + 1}
                aria-selected={row.path === selected}
                aria-expanded={row.isDir ? !isCollapsed : undefined}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: `calc(var(--sp-2) + var(--tree-indent) * ${depthOf(row.path)})`,
                }}
                onMouseDown={() => {
                  setFocusIndex(item.index);
                  if (row.isDir) toggle(row.path);
                  else onOpen(row);
                }}
              >
                {row.isDir ? (
                  <ChevronRight
                    className={isCollapsed ? "chev" : "chev open"}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="chev-pad" aria-hidden="true" />
                )}
                {row.isDir ? (
                  <Folder className="ico" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <FileText className="ico" strokeWidth={1.75} aria-hidden="true" />
                )}
                <span className="nm" title={row.path}>
                  {row.name}
                </span>
                {!row.isDir && (
                  <button
                    className="ti-open-new"
                    type="button"
                    aria-label={`在新窗口打开 ${row.name}`}
                    title="在新窗口打开"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onOpenInNewWindow(row);
                    }}
                  >
                    <SquarePlus strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
