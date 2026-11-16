import { useEffect, useRef } from "react";

type Props = {
  /** "resume" or "blank" (PRD FR-10.1). */
  startup: string;
  onChangeStartup: (startup: string) => void;
  /** "system", "light" or "dark" (PRD FR-10.12). */
  appearance: string;
  onChangeAppearance: (appearance: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  /** "本次设置未保存" and the like, shown above the buttons. */
  error?: string | null;
};

const APPEARANCES = [
  { value: "system", label: "跟随系统", hint: "跟着 Windows 的外观切换。" },
  { value: "light", label: "浅色", hint: "始终使用浅色阅读界面。" },
  { value: "dark", label: "深色", hint: "始终使用深色阅读界面。" },
];

const OPTIONS = [
  {
    value: "resume",
    label: "恢复上一份文档",
    hint: "启动时打开上次在前台窗口阅读的文档或其所在目录。",
  },
  {
    value: "blank",
    label: "打开新的空白页",
    hint: "启动时显示空白页与最近打开，不自动打开任何文档。",
  },
];

/**
 * The settings dialog (DESIGN.md §8.13): a left group list with only 常规 for
 * P0, the startup choice, and buttons that never claim success they did not
 * get. Escape cancels, focus goes in and comes back.
 */
export function SettingsDialog({
  startup,
  onChangeStartup,
  appearance,
  onChangeAppearance,
  onCancel,
  onSave,
  saving,
  error,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus enters the dialog and returns to whatever opened it
    // (DESIGN.md §8.12).
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Keep the focus inside the dialog while it is open.
    if (e.key === "Tab" && panel.current) {
      const focusable = panel.current.querySelectorAll<HTMLElement>("button, input");
      const list = Array.from(focusable);
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
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="设置" ref={panel}>
        <h2>设置</h2>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分组">
            <span className="current">常规</span>
          </nav>
          <div className="settings-content">
            <fieldset className="settings-group">
              <legend>启动时</legend>
              {OPTIONS.map((option, i) => (
                <label key={option.value} className="radio-row">
                  <input
                    ref={i === 0 ? first : undefined}
                    type="radio"
                    name="startup"
                    value={option.value}
                    checked={startup === option.value}
                    onChange={() => onChangeStartup(option.value)}
                  />
                  <span className="txt">
                    <span className="label">{option.label}</span>
                    <span className="hint">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="settings-group">
              <legend>外观</legend>
              {APPEARANCES.map((option) => (
                <label key={option.value} className="radio-row">
                  <input
                    type="radio"
                    name="appearance"
                    value={option.value}
                    checked={appearance === option.value}
                    onChange={() => onChangeAppearance(option.value)}
                  />
                  <span className="txt">
                    <span className="label">{option.label}</span>
                    <span className="hint">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </div>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="btn secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={onSave} aria-disabled={saving || undefined}>
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
