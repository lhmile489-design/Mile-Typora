package markdown

import (
	"bytes"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// OutlineHeading is one heading the left outline shows. Line is 1-based in
// the source the page holds; front matter lines are included in the count.
type OutlineHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Line  int    `json:"line"`
}

// MaxOutlineHeadings bounds the outline and the TOC (P2 §14).
const MaxOutlineHeadings = 500

// Outline extracts the headings of a Markdown buffer without rendering it.
// It uses the same GFM and math parsing as the renderer, so fences, front
// matter and inline markup do not produce false headings.
func Outline(src []byte) ([]OutlineHeading, bool) {
	_, body := splitFrontMatter(src)
	offset := 0
	if len(body) != len(src) {
		offset = strings.Count(string(src[:len(src)-len(body)]), "\n")
	}
	// Block formulas become fences first, exactly as in Render: a "#" inside
	// $$…$$ is not a heading.
	body = preprocessMath(body)
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, Math()),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
	)
	doc := md.Parser().Parse(text.NewReader(body))
	headings := make([]OutlineHeading, 0, 16)
	truncated := false
	ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		heading, ok := node.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		if len(headings) >= MaxOutlineHeadings {
			truncated = true
			return ast.WalkStop, nil
		}
		title := strings.TrimSpace(headingText(heading, body))
		line := offset + 1
		if lines := heading.Lines(); lines.Len() > 0 {
			start := lines.At(0).Start
			if start > len(body) {
				start = len(body)
			}
			line += bytes.Count(body[:start], []byte("\n"))
		}
		headings = append(headings, OutlineHeading{
			Level: int(heading.Level),
			Text:  title,
			Line:  line,
		})
		return ast.WalkContinue, nil
	})
	return headings, truncated
}

// headingText joins the visible text of a heading's inline children without
// the deprecated Node.Text helper. Image alt text is included; formula source
// is not, because it has no plain-text equivalent here.
func headingText(heading ast.Node, source []byte) string {
	var out strings.Builder
	ast.Walk(heading, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || node == heading {
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.Text:
			out.Write(n.Segment.Value(source))
		case *ast.String:
			out.Write(n.Value)
		}
		return ast.WalkContinue, nil
	})
	return out.String()
}
