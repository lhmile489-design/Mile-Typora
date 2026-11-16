import { useEffect, useRef } from "react";
import { SHORTCUT_HINT, type Command } from "../lib/shortcuts";

type Props = {
  kind: "shortcuts" | "about";
  version: string;
  onClose: () => void;
};

const ORDER: Array<[Command, string]> = [
  ["new-document", "新建"],
  ["open-file", "打开文件"],
  ["open-folder", "打开目录"],
  ["save-blocked", "保存"],
  ["save-as", "另存为"],
  ["toggle-source", "源码 / 预览"],
  ["find", "查找"],
  ["close-window", "关闭窗口"],
  ["settings", "设置"],
  ["toggle-left", "显示 / 隐藏左侧栏"],
  ["heading-1", "标题 1"],
  ["paragraph", "普通段落"],
  ["quote", "引用"],
  ["formula-block", "公式块"],
  ["code-block", "代码块"],
  ["ordered-list", "有序列表"],
  ["unordered-list", "无序列表"],
  ["task-list", "任务列表"],
  ["bold", "加粗"],
  ["italic", "斜体"],
  ["inline-code", "行内代码"],
  ["strikethrough", "删除线"],
  ["link", "链接"],
  ["clear-format", "清除样式"],
  ["move-line-up", "上移行"],
  ["move-line-down", "下移行"],
];

/** Help → shortcuts / about. */
export function HelpDialog({ kind, version, onClose }: Props) {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={kind === "about" ? "关于" : "快捷键说明"}>
        <h2>{kind === "about" ? "关于 Mile Typora" : "快捷键说明"}</h2>
        {kind === "about" ? (
          <>
            <p className="dialog-text">本地 Markdown 阅读与源码编辑器，所有渲染离线完成。</p>
            <p className="dialog-text">版本 {version || "未知"}</p>
          </>
        ) : (
          <ul className="shortcut-list">
            {ORDER.map(([command, label]) => (
              <li key={command}>
                <span>{label}</span>
                <kbd>{SHORTCUT_HINT[command]}</kbd>
              </li>
            ))}
            <li>
              <span>撤销 / 重做</span>
              <kbd>Ctrl+Z / Ctrl+Y</kbd>
            </li>
            <li>
              <span>复制 / 剪切 / 粘贴</span>
              <kbd>Ctrl+C / Ctrl+X / Ctrl+V</kbd>
            </li>
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
