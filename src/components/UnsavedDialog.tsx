import { useEffect, useRef } from "react";

type Props = {
  /** What the window was about to do: close or open something else. */
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * The unsaved-changes prompt (PRD 10.2, P1-AC-06). Focus starts on Cancel;
 * Escape cancels; Save reports its own failure without closing the prompt.
 */
export function UnsavedDialog({ saving, error, onSave, onDiscard, onCancel }: Props) {
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

  return (
    <div className="dialog-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="未保存的修改" ref={panel}>
        <h2>未保存的修改</h2>
        <p className="dialog-text">当前文档有尚未保存的修改。要先保存吗？</p>
        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn secondary" type="button" ref={cancel} onClick={onCancel}>
            取消
          </button>
          <button className="btn secondary" type="button" onClick={onDiscard} disabled={saving}>
            放弃修改
          </button>
          <button className="btn primary" type="button" onClick={onSave} aria-disabled={saving || undefined}>
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
