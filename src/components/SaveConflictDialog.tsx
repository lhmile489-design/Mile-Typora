import { useEffect, useRef } from "react";

type Props = {
  /** "conflict": the disk changed; "missing": the file was deleted. */
  kind: "conflict" | "missing";
  message: string;
  saving: boolean;
  error?: string | null;
  onSaveAs: () => void;
  /** Overwrite the changed file, or recreate the deleted one. */
  onForce: () => void;
  onCancel: () => void;
};

/**
 * The save conflict prompt (PRD 10.3, P1-AC-07/08). Saving elsewhere is the
 * default; overwriting takes a second, explicit choice and is never silent.
 */
export function SaveConflictDialog({
  kind,
  message,
  saving,
  error,
  onSaveAs,
  onForce,
  onCancel,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Tab" && panel.current) {
      const list = Array.from(panel.current.querySelectorAll<HTMLElement>("button"));
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && index <= 0) {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (!e.shiftKey && index === list.length - 1) {
        e.preventDefault();
        list[0]?.focus();
      }
    }
  };

  const title = kind === "missing" ? "文件已不存在" : "文件已被修改";
  const forceLabel = kind === "missing" ? "重新创建" : "覆盖磁盘";

  return (
    <div className="dialog-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <h2>{title}</h2>
        <p className="dialog-text">{message}</p>
        <p className="dialog-text">另存为不会覆盖磁盘上的版本。</p>
        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn secondary" type="button" ref={cancel} onClick={onCancel}>
            取消
          </button>
          <button className="btn secondary" type="button" onClick={onForce} disabled={saving}>
            {forceLabel}
          </button>
          <button className="btn primary" type="button" onClick={onSaveAs} aria-disabled={saving || undefined}>
            另存为
          </button>
        </div>
      </div>
    </div>
  );
}
