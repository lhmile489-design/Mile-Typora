import { useEffect, useRef } from "react";
import type { FileProperties } from "../lib/transport";
import { formatBytes } from "../lib/errors";

type Props = {
  properties: FileProperties;
  unsaved?: boolean;
  onClose: () => void;
};

function modifiedText(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

/** The read-only file properties dialog (M5-1 FILE-11). */
export function FilePropertiesDialog({ properties, unsaved = false, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  const rows: Array<[string, string]> = unsaved
    ? [
        ["名称", properties.name || "未命名"],
        ["位置", "尚未保存"],
        ["大小", "—"],
        ["编码", "—"],
        ["换行", "—"],
        ["修改时间", "—"],
        ["只读", "—"],
      ]
    : [
        ["名称", properties.name],
        ["位置", properties.path],
        ["大小", formatBytes(properties.size)],
        ["编码", properties.encoding || "未知"],
        ["换行", properties.lineEnding || "未知"],
        ["修改时间", modifiedText(properties.modified)],
        ["只读", properties.readOnly ? "是" : "否"],
      ];

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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="文件属性">
        <h2>文件属性</h2>
        <dl className="props-list">
          {rows.map(([label, value]) => (
            <div className="props-row" key={label}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button className="btn secondary" type="button" ref={close} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
