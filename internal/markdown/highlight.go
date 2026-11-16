package markdown

import (
	"bytes"
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
)

// highlighter turns a fenced block into chroma's HTML with classes, so the
// page's stylesheet decides the colours from its own tokens (DESIGN.md §2.5).
type highlighter struct {
	formatter *chromahtml.Formatter
}

func newHighlighter() *highlighter {
	return &highlighter{formatter: chromahtml.New(chromahtml.WithClasses(true))}
}

// highlight returns the HTML of one code block, or "" when chroma cannot
// handle the language, in which case the block is shown as plain code.
func (h *highlighter) highlight(language, code string) string {
	lexer := lexers.Get(language)
	if lexer == nil {
		// A language nobody knows is still code: show it as text, not as an
		// error (PRD FR-04).
		lexer = lexers.Fallback
	}
	lexer = chroma.Coalesce(lexer)
	iterator, err := lexer.Tokenise(nil, code)
	if err != nil {
		return ""
	}
	var buf bytes.Buffer
	if err := h.formatter.Format(&buf, styles.Fallback, iterator); err != nil {
		return ""
	}
	return strings.TrimSpace(buf.String())
}
