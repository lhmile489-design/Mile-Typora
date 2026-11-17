import { useMemo } from "react";
import { FileText, Search, X } from "lucide-react";
import type { SearchMatch } from "../lib/transport";

type Props = {
  query: string;
  onQuery: (query: string) => void;
  results: SearchMatch[];
  searching: boolean;
  truncated: boolean;
  error: string | null;
  onOpen: (match: SearchMatch) => void;
  onCancel: () => void;
  onClose: () => void;
};

/** Directory text search across the authorized folder (M5-2 VIEW-05). */
export function SearchPanel({ query, onQuery, results, searching, truncated, error, onOpen, onCancel, onClose }: Props) {
  const groups = useMemo(() => {
    const byPath = new Map<string, { name: string; matches: SearchMatch[] }>();
    for (const match of results) {
      const group = byPath.get(match.path) ?? { name: match.name, matches: [] };
      group.matches.push(match);
      byPath.set(match.path, group);
    }
    return [...byPath.entries()];
  }, [results]);

  return (
    <div className="search-pane">
      <div className="side-head">
        <span>目录搜索</span>
        <button className="icon-btn" type="button" aria-label="关闭目录搜索" title="关闭" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="search-box">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="搜索当前目录"
          aria-label="搜索当前目录"
          onChange={(e) => onQuery(e.target.value)}
        />
        {searching && (
          <button className="btn text" type="button" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
      {error && <div className="side-error">{error}</div>}
      {truncated && <div className="side-note">结果已截断，仅显示前 500 条</div>}
      <div className="search-results">
        {groups.length === 0 && !searching && query.trim() !== "" && !error && (
          <div className="side-empty">没有匹配结果</div>
        )}
        {groups.map(([path, group]) => (
          <div className="search-group" key={path}>
            <div className="search-file" title={path}>
              <FileText aria-hidden="true" />
              <span className="nm">{group.name}</span>
              <span className="count">{group.matches.length}</span>
              <span className="rel">{path}</span>
            </div>
            {group.matches.map((match, index) => (
              <button
                className="search-hit"
                type="button"
                key={`${path}-${match.line}-${index}`}
                onClick={() => onOpen(match)}
              >
                {match.isName ? (
                  <span className="hit-name">文件名匹配</span>
                ) : (
                  <>
                    <span className="line">{match.line}</span>
                    <span className="snippet">{match.text}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
