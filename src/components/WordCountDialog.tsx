type Props = {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  paragraphs: number;
  onClose: () => void;
};

/** Read-only statistics window from VIEW-10. */
export function WordCountDialog({ characters, charactersNoSpaces, words, paragraphs, onClose }: Props) {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="字数统计">
        <h2>字数统计</h2>
        <dl className="props-list">
          <div className="props-row">
            <dt>字符数</dt>
            <dd>{characters}</dd>
          </div>
          <div className="props-row">
            <dt>不含空白</dt>
            <dd>{charactersNoSpaces}</dd>
          </div>
          <div className="props-row">
            <dt>词数</dt>
            <dd>{words}</dd>
          </div>
          <div className="props-row">
            <dt>段落数</dt>
            <dd>{paragraphs}</dd>
          </div>
        </dl>
        <p className="dialog-text">有选区时统计选区，否则统计全文；不包含 YAML 元信息与注释。</p>
        <div className="dialog-actions">
          <button className="btn primary" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
