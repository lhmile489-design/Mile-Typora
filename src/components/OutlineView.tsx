import { ListTree } from "lucide-react";
import type { OutlineHeading } from "../lib/transport";

type Props = {
  headings: OutlineHeading[];
  truncated?: boolean;
  onGo: (heading: OutlineHeading, index: number) => void;
};

/** The current document's heading list (M5-2 VIEW-02). */
export function OutlineView({ headings, truncated, onGo }: Props) {
  return (
    <div className="outline-pane">
      <div className="side-head">大纲</div>
      {headings.length === 0 ? (
        <div className="side-empty">
          <ListTree aria-hidden="true" />
          当前文档没有标题
        </div>
      ) : (
        <div className="outline-list" role="tree" aria-label="文档大纲">
          {headings.map((heading, index) => (
            <button
              className="outline-row"
              type="button"
              role="treeitem"
              key={`${heading.line}-${index}`}
              style={{ paddingLeft: `calc(var(--sp-2) + var(--tree-indent) * ${Math.max(0, heading.level - 1)})` }}
              title={heading.text}
              onClick={() => onGo(heading, index)}
            >
              <span className="nm">{heading.text || "（无标题）"}</span>
            </button>
          ))}
        </div>
      )}
      {truncated && <div className="side-note">标题过多，仅显示前 500 个</div>}
    </div>
  );
}
