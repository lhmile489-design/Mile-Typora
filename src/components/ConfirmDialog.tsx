import { useEffect, useId, useRef } from "react";

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A small destructive confirmation for reloading an external change. */
export function ConfirmDialog({ title, message, confirmLabel, danger = false, onConfirm, onCancel }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const messageId = useId();

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
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={messageId}
        ref={panel}
      >
        <h2>{title}</h2>
        <p className="dialog-text" id={messageId}>
          {message}
        </p>
        <div className="dialog-actions">
          <button className="btn secondary" type="button" ref={cancel} onClick={onCancel}>
            取消
          </button>
          <button className={danger ? "btn danger" : "btn primary"} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
