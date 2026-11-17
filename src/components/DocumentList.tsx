import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, List } from "lucide-react";
import type { TreeEntry } from "../lib/transport";

type Props = {
  entries: TreeEntry[];
  selected: string | null;
  onOpen: (entry: TreeEntry) => void;
};

const ROW_HEIGHT = 28;

/** A flat, naturally sorted list of the folder's Markdown files (VIEW-03). */
export function DocumentList({ entries, selected, onOpen }: Props) {
  const files = useMemo(() => {
    const names = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.isDir) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
    }
    return entries
      .filter((entry) => !entry.isDir)
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true, sensitivity: "base" }))
      .map((entry) => ({ entry, duplicate: (names.get(entry.name) ?? 0) > 1 }));
  }, [entries]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="doc-list-pane">
      <div className="side-head">文档列表</div>
      {files.length === 0 ? (
        <div className="side-empty">
          <List aria-hidden="true" />
          此目录下未找到 Markdown 文件
        </div>
      ) : (
        <div className="doc-list-scroll" ref={scrollRef} role="list" aria-label="文档列表">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = files[item.index];
              if (!row) return null;
              return (
                <button
                  key={row.entry.path}
                  type="button"
                  role="listitem"
                  className={`doc-row${row.entry.path === selected ? " sel" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                  title={row.entry.path}
                  onClick={() => onOpen(row.entry)}
                >
                  <FileText aria-hidden="true" />
                  <span className="nm">{row.entry.name}</span>
                  {row.duplicate && <span className="rel">{row.entry.path}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
