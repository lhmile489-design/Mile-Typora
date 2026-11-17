import { useEffect, useRef } from "react";

type Props = {
  name: string;
  warnings: string[];
  onClose: () => void;
};

/** Lists the parts an import could not preserve (M6-1 FILE-15). */
export function ImportNoticeDialog({ name, warnings, onClose }: Props) {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="导入完成">
        <h2>导入完成</h2>
        <p className="dialog-text">已生成新文档“{name}”，原文件未修改。</p>
        {warnings.length > 0 ? (
          <>
            <p className="dialog-text">以下内容未能完整保留：</p>
            <ul className="export-warnings">
              {warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="dialog-text">未发现格式损失。</p>
        )}
        <div className="dialog-actions">
          <button className="btn primary" type="button" ref={close} onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
