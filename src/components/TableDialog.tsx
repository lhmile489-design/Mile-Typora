import { useEffect, useRef, useState } from "react";

type Props = {
  onInsert: (rows: number, columns: number) => void;
  onCancel: () => void;
};

/** Small row/column picker for the table command (M5-3 PARA-05). */
export function TableDialog({ onInsert, onCancel }: Props) {
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  const clamp = (value: number) => Math.max(1, Math.min(20, Number.isFinite(value) ? Math.trunc(value) : 1));

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="插入表格">
        <h2>插入表格</h2>
        <p className="dialog-text">选择行数与列数，最多 20。</p>
        <div className="table-size">
          <label>
            行
            <input
              ref={first}
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(clamp(Number(e.target.value)))}
            />
          </label>
          <label>
            列
            <input
              type="number"
              min={1}
              max={20}
              value={columns}
              onChange={(e) => setColumns(clamp(Number(e.target.value)))}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="btn secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={() => onInsert(rows, columns)}>
            插入
          </button>
        </div>
      </div>
    </div>
  );
}
