import { useEffect, useRef, useState } from "react";

type Props = {
  address: string;
  /** Reference links edit their definition, so the hint says where it lives. */
  reference: boolean;
  onSave: (address: string) => void;
  onCancel: () => void;
};

/** Edits the target of the link under the cursor (M5-4 FORMAT-08). */
export function LinkDialog({ address, reference, onSave, onCancel }: Props) {
  const [value, setValue] = useState(address);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = () => {
    const next = value.trim();
    if (next === "") return;
    onSave(next);
  };

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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="编辑链接地址">
        <h2>编辑链接地址</h2>
        <p className="dialog-text">
          {reference ? "引用式链接只修改文末的定义行，所有引用点保持不变。" : "只修改目标地址，链接文字与标题保持不变。"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="dialog-field">
            <span>地址</span>
            <input
              ref={input}
              className="dialog-input"
              type="text"
              value={value}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button className="btn secondary" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="btn primary" type="submit" disabled={value.trim() === ""}>
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
