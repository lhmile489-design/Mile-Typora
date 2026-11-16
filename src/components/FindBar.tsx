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
};

/**
 * The find bar (DESIGN.md §8.5): floats at the top right of the reader, shows
 * "3 / 12", and says so when nothing matches. Enter steps forward, Shift+Enter
 * back, Escape closes (PRD FR-05).
 */
export function FindBar({ query, count, index, onChange, onStep, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div className="find-bar" role="search">
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
  );
}
