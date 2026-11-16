import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

type Props = {
  query: string;
  /** Number of matches, 0 when the query finds nothing. */
  count: number;
  /** Index of the current match, 0-based. */
  index: number;
  onChange: (query: string) => void;
  onStep: (backwards: boolean) => void;
  onClose: () => void;
  /** Source editing adds the replace row (P1 EDIT-22). */
  editing?: boolean;
  replacement?: string;
  onReplacementChange?: (value: string) => void;
  onReplace?: () => void;
  onReplaceAll?: () => void;
};

/**
 * The find bar (DESIGN.md §8.5): floats at the top right of the reader, shows
 * "3 / 12", and says so when nothing matches. Enter steps forward, Shift+Enter
 * back, Escape closes (PRD FR-05). In source editing it grows a replace row;
 * the reader and preview keep the single row.
 */
export function FindBar({
  query,
  count,
  index,
  onChange,
  onStep,
  onClose,
  editing = false,
  replacement = "",
  onReplacementChange,
  onReplace,
  onReplaceAll,
}: Props) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A candidate window owns Enter and Escape while an input method
    // composes; the bar must not close or jump under it (PRD FR-09).
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onStep(e.shiftKey);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const canReplace = query !== "" && count > 0;

  return (
    <div className={editing ? "find-bar editing" : "find-bar"} role="search">
      <div className="find-row">
        <input
          ref={input}
          type="text"
          value={query}
          placeholder="在文中查找"
          aria-label="在文中查找"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className={count === 0 && query !== "" ? "find-count st-danger" : "find-count"}>
          {query === "" ? "" : count === 0 ? "未找到匹配内容" : `${index + 1} / ${count}`}
        </span>
        <button
          className="tb"
          type="button"
          aria-label="上一个"
          aria-disabled={count === 0 || undefined}
          onClick={() => onStep(true)}
        >
          <ChevronUp strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          className="tb"
          type="button"
          aria-label="下一个"
          aria-disabled={count === 0 || undefined}
          onClick={() => onStep(false)}
        >
          <ChevronDown strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button className="tb" type="button" aria-label="关闭查找" onClick={onClose}>
          <X strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {editing && (
        <div className="replace-row">
          <input
            type="text"
            value={replacement}
            placeholder="替换为"
            aria-label="替换为"
            onChange={(e) => onReplacementChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <button
            className="btn secondary find-action"
            type="button"
            aria-disabled={!canReplace || undefined}
            onClick={() => {
              if (canReplace) onReplace?.();
            }}
          >
            替换
          </button>
          <button
            className="btn secondary find-action"
            type="button"
            aria-disabled={!canReplace || undefined}
            onClick={() => {
              if (canReplace) onReplaceAll?.();
            }}
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
}
