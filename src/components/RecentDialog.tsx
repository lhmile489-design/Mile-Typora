import { useEffect, useRef } from "react";
import type { RecentEntry } from "../lib/transport";

type Props = {
  entries: RecentEntry[];
  onOpen: (path: string) => void;
  onClose: () => void;
};

/** The File → Recent submenu, shown as a small modal for keyboard access. */
export function RecentDialog({ entries, onOpen, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="最近打开">
        <h2>最近打开</h2>
        {entries.length === 0 ? (
          <p className="dialog-text">还没有最近记录。</p>
        ) : (
          <ul className="save-all-list recent-dialog-list">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  className="recent-row"
                  type="button"
                  title={entry.path}
                  onClick={() => onOpen(entry.path)}
                >
                  <span className="txt">
                    <span className="nm">{entry.name}</span>
                    <span className="path">{entry.isDir ? "文件夹" : entry.path}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="btn secondary" type="button" ref={close} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
