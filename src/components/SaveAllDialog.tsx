import { useEffect, useRef } from "react";

export type SaveAllRow = {
  windowId: number;
  name: string;
  status: string;
  message?: string;
};

type Props = {
  rows: SaveAllRow[];
  saved: number;
  failed: number;
  unhandled: number;
  onClose: () => void;
};

const LABEL: Record<string, string> = {
  saved: "已保存",
  failed: "失败",
  unhandled: "未处理",
  clean: "无修改",
};

/**
 * The aggregate of a save-all run (P1 FILE-10). The summary is a report, not
 * a second save prompt: every window already handled its own conflict.
 */
export function SaveAllDialog({ rows, saved, failed, unhandled, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="保存全部">
        <h2>保存全部</h2>
        <p className="dialog-text">
          已保存 {saved} 个，失败 {failed} 个，未处理 {unhandled} 个。
        </p>
        {rows.length > 0 && (
          <ul className="save-all-list">
            {rows.map((row) => (
              <li key={`${row.windowId}-${row.name}`}>
                <span className="nm">{row.name}</span>
                <span className={`st ${row.status === "failed" ? "st-danger" : row.status === "saved" ? "st-ok" : ""}`}>
                  {LABEL[row.status] ?? row.status}
                </span>
                {row.message && <span className="msg">{row.message}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="btn primary" type="button" ref={close} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
