import { useEffect, useRef } from "react";

type Props = {
  title: string;
  path: string;
  warnings: string[];
  onClose: () => void;
};

/** Lists the images an export had to leave out (M5-6 §9.1). */
export function ExportNoticeDialog({ title, path, warnings, onClose }: Props) {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {path !== "" && <p className="dialog-text">已写入 {path}</p>}
        {warnings.length > 0 && (
          <>
            <p className="dialog-text">以下内容未能完整嵌入，已在导出文件中省略：</p>
            <ul className="export-warnings">
              {warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </>
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
