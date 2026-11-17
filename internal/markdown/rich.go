package markdown

import (
	"bytes"
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Custom node kinds for the P2 syntax (M5-3). The renderer emits their markup;
// a document can never spell these elements itself.
var (
	KindAlert = ast.NewNodeKind("Alert")
	KindTOC   = ast.NewNodeKind("TOC")
)

type alertNode struct {
	ast.BaseBlock
	AlertType string
}

func (n *alertNode) Kind() ast.NodeKind { return KindAlert }

func (n *alertNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Type": n.AlertType}, nil)
}

type tocEntry struct {
	Level int
	ID    string
	Text  string
}

type tocNode struct {
	ast.BaseBlock
	Entries []tocEntry
}

func (n *tocNode) Kind() ast.NodeKind { return KindTOC }

func (n *tocNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

var alertTypes = map[string]string{
	"NOTE":      "注意",
	"TIP":       "提示",
	"IMPORTANT": "重要",
	"WARNING":   "警告",
	"CAUTION":   "小心",
}

// alertTransformer turns a blockquote whose first line is [!TYPE] into an
// alert node. Unknown types stay ordinary blockquotes.
type alertTransformer struct{}

func (*alertTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		quote, ok := node.(*ast.Blockquote)
		if !ok {
			return ast.WalkContinue, nil
		}
		paragraph, ok := quote.FirstChild().(*ast.Paragraph)
		if !ok {
			return ast.WalkContinue, nil
		}
		raw := strings.TrimSpace(string(paragraph.Text(source)))
		if !strings.HasPrefix(raw, "[!") {
			return ast.WalkContinue, nil
		}
		end := strings.Index(raw, "]")
		if end < 0 {
			return ast.WalkContinue, nil
		}
		kind := strings.ToUpper(raw[2:end])
		if _, known := alertTypes[kind]; !known {
			return ast.WalkContinue, nil
		}
		stripAlertMarker(paragraph, source)
		alert := &alertNode{AlertType: strings.ToLower(kind)}
		for child := quote.FirstChild(); child != nil; {
			next := child.NextSibling()
			quote.RemoveChild(quote, child)
			alert.AppendChild(alert, child)
			child = next
		}
		parent := quote.Parent()
		parent.ReplaceChild(parent, quote, alert)
		return ast.WalkContinue, nil
	})
}

// stripAlertMarker removes the [!TYPE] prefix from the paragraph's first
// line, including the newline after it, by editing the text-segment offsets.
func stripAlertMarker(paragraph *ast.Paragraph, source []byte) {
	if paragraph.Lines().Len() == 0 {
		return
	}
	lineStart := paragraph.Lines().At(0).Start
	if lineStart < 0 || lineStart >= len(source) {
		return
	}
	close := bytes.Index(source[lineStart:], []byte("]"))
	if close < 0 {
		return
	}
	end := lineStart + close + 1
	for end < len(source) && (source[end] == '\n' || source[end] == '\r' || source[end] == ' ' || source[end] == '\t') {
		end++
	}
	for child := paragraph.FirstChild(); child != nil; {
		next := child.NextSibling()
		if segment, ok := child.(*ast.Text); ok {
			switch {
			case segment.Segment.Stop <= end:
				paragraph.RemoveChild(paragraph, child)
			case segment.Segment.Start < end:
				segment.Segment = text.NewSegment(end, segment.Segment.Stop)
			}
		}
		child = next
	}
}

// tocTransformer replaces a paragraph that is exactly [TOC] with a node that
// renders the document's headings. Headings are collected first, so a TOC
// before the first heading still works.
type tocTransformer struct{}

func (*tocTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	var entries []tocEntry
	ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		heading, ok := node.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		if len(entries) >= MaxOutlineHeadings {
			return ast.WalkStop, nil
		}
		id := ""
		if value, ok := heading.AttributeString("id"); ok {
			id = string(value.([]byte))
		}
		entries = append(entries, tocEntry{
			Level: int(heading.Level),
			ID:    id,
			Text:  strings.TrimSpace(headingText(heading, source)),
		})
		return ast.WalkContinue, nil
	})
	ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		paragraph, ok := node.(*ast.Paragraph)
		if !ok {
			return ast.WalkContinue, nil
		}
		if strings.TrimSpace(string(paragraph.Text(source))) != "[TOC]" {
			return ast.WalkContinue, nil
		}
		toc := &tocNode{Entries: entries}
		parent := paragraph.Parent()
		parent.ReplaceChild(parent, paragraph, toc)
		return ast.WalkContinue, nil
	})
}

// renderAlert writes the fixed alert structure. Type is an enum value chosen
// by the transformer, never document text.
func (r *Renderer) renderAlert(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	alert, ok := node.(*alertNode)
	if !ok {
		return ast.WalkContinue, nil
	}
	if !entering {
		_, _ = w.WriteString("</div>\n")
		return ast.WalkContinue, nil
	}
	label := alertTypes[strings.ToUpper(alert.AlertType)]
	_, _ = w.WriteString(`<div class="alert alert-`)
	_, _ = w.WriteString(alert.AlertType)
	_, _ = w.WriteString(`" data-type="`)
	_, _ = w.WriteString(alert.AlertType)
	_, _ = w.WriteString(`"><p class="alert-title">`)
	_, _ = w.Write(util.EscapeHTML([]byte(label)))
	_, _ = w.WriteString("</p>\n")
	return ast.WalkContinue, nil
}

// renderTOC writes a flat list with level classes. The CSS indents by class;
// every link points at an id the heading renderer generated.
func (r *Renderer) renderTOC(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	toc, ok := node.(*tocNode)
	if !ok {
		return ast.WalkContinue, nil
	}
	if !entering {
		return ast.WalkContinue, nil
	}
	if len(toc.Entries) == 0 {
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<nav class="toc"><ol class="toc-list">`)
	for _, entry := range toc.Entries {
		level := entry.Level
		if level < 1 {
			level = 1
		}
		if level > 6 {
			level = 6
		}
		_, _ = w.WriteString(`<li class="toc-item toc-level-`)
		_, _ = w.WriteString(string(rune('0' + level)))
		_, _ = w.WriteString(`"><a class="toc-link" href="#`)
		_, _ = w.Write(util.EscapeHTML([]byte(entry.ID)))
		_, _ = w.WriteString(`">`)
		_, _ = w.Write(util.EscapeHTML([]byte(entry.Text)))
		_, _ = w.WriteString(`</a></li>`)
	}
	_, _ = w.WriteString("</ol></nav>\n")
	return ast.WalkContinue, nil
}

var commentOnly = regexp.MustCompile(`(?s)^\s*(?:<!--.*?-->\s*)+$`)
var inlineComment = regexp.MustCompile(`(?s)^\s*<!--.*-->\s*$`)
var footnoteBacklink = regexp.MustCompile(`(?s)<a([^>]*class="footnote-backref"[^>]*)>.*?</a>`)

func isCommentBlock(source []byte, block *ast.HTMLBlock) bool {
	var raw strings.Builder
	for i := 0; i < block.Lines().Len(); i++ {
		line := block.Lines().At(i)
		raw.Write(line.Value(source))
	}
	return commentOnly.MatchString(raw.String())
}

func underlineTag(value string) bool {
	trimmed := strings.TrimSpace(value)
	return strings.EqualFold(trimmed, "<u>") || strings.EqualFold(trimmed, "</u>")
}
