package markdown

import (
	"context"
	"html"
	"strings"
	"unicode"

	"github.com/microcosm-cc/bluemonday"
	xhtml "golang.org/x/net/html"
)

// Fragment is one selection as clipboard HTML plus its plain-text fallback
// (P2 §7.3, §7.4). Both are sanitized; the text is derived from the cleaned
// markup so the two representations always describe the same content.
type Fragment struct {
	HTML string
	Text string
}

// PlainText renders Markdown and returns only the readable text (P2 §7.2):
// Markdown marks are gone, tables become tab-separated rows, code keeps its
// text, and images keep their alternative text.
func (r *Renderer) PlainText(ctx context.Context, src []byte) (string, *Failure) {
	result, failure := r.Render(ctx, src, func(string) (string, string) {
		// Keep <img alt> for the text walk; the URL itself never reaches the
		// clipboard because the clipboard policy removes images.
		return "fragment-image", ""
	})
	if failure != nil {
		return "", failure
	}
	return htmlToText(result.HTML), nil
}

// ClipboardFragment prepares a selection for the clipboard. FromSource parses
// Markdown selected in the source editor; otherwise content is already an HTML
// fragment selected in the reading view. Simplified applies the P2 §7.4
// keep-list and drops tables and images entirely.
func (r *Renderer) ClipboardFragment(ctx context.Context, content []byte, fromSource, simplified bool) (Fragment, *Failure) {
	raw := string(content)
	if fromSource {
		result, failure := r.Render(ctx, content, func(string) (string, string) {
			return "fragment-image", ""
		})
		if failure != nil {
			return Fragment{}, failure
		}
		raw = result.HTML
	}
	cleaned := r.clipboard.Sanitize(raw)
	text := htmlToText(raw)
	if simplified {
		cleaned = simplifyHTML(cleaned)
		cleaned = r.simplified.Sanitize(cleaned)
		text = htmlToText(cleaned)
	}
	return Fragment{HTML: cleaned, Text: text}, nil
}

// newClipboardPolicy allows the document structure worth copying, without
// scripts, events, styles, classes, ids, remote images or the app's resource
// URLs. Images are omitted on purpose (P2 §7.3).
func newClipboardPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.AllowElements(
		"p", "h1", "h2", "h3", "h4", "h5", "h6",
		"a", "strong", "em", "del", "code", "pre",
		"blockquote", "ul", "ol", "li",
		"table", "thead", "tbody", "tr", "th", "td",
		"hr", "br", "sup", "u",
	)
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https", "mailto")
	p.AllowRelativeURLs(true)
	return p
}

// newSimplifiedPolicy is the closed keep-list of P2 §7.4.
func newSimplifiedPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "strong", "em", "ul", "ol", "li", "blockquote", "code", "a")
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https", "mailto")
	p.AllowRelativeURLs(true)
	return p
}

var simplifiedKeep = map[string]bool{
	"p": true, "br": true, "strong": true, "em": true,
	"ul": true, "ol": true, "li": true, "blockquote": true,
	"code": true, "a": true,
}

// simplifyHTML rewrites sanitized HTML into the narrow keep-list: headings
// become bold paragraphs, tables and images are removed, and every other
// element unwraps to its children.
func simplifyHTML(markup string) string {
	root, err := xhtml.Parse(strings.NewReader(markup))
	if err != nil {
		return ""
	}
	var out strings.Builder
	writeSimplified(&out, root)
	return out.String()
}

func writeSimplified(out *strings.Builder, node *xhtml.Node) {
	switch node.Type {
	case xhtml.TextNode:
		out.WriteString(html.EscapeString(node.Data))
		return
	case xhtml.CommentNode, xhtml.DoctypeNode:
		return
	case xhtml.ElementNode:
		switch node.Data {
		case "script", "style", "head", "title", "meta", "link", "table", "img", "svg":
			return
		case "h1", "h2", "h3", "h4", "h5", "h6":
			out.WriteString("<p><strong>")
			writeSimplifiedChildren(out, node)
			out.WriteString("</strong></p>")
			return
		case "br":
			out.WriteString("<br>")
			return
		case "a":
			href := ""
			for _, attr := range node.Attr {
				if strings.EqualFold(attr.Key, "href") {
					href = attr.Val
					break
				}
			}
			if !safeHref(href) {
				writeSimplifiedChildren(out, node)
				return
			}
			out.WriteString(`<a href="`)
			out.WriteString(html.EscapeString(href))
			out.WriteString(`">`)
			writeSimplifiedChildren(out, node)
			out.WriteString("</a>")
			return
		}
		if simplifiedKeep[node.Data] {
			out.WriteString("<")
			out.WriteString(node.Data)
			out.WriteString(">")
			writeSimplifiedChildren(out, node)
			out.WriteString("</")
			out.WriteString(node.Data)
			out.WriteString(">")
			return
		}
	}
	writeSimplifiedChildren(out, node)
}

func writeSimplifiedChildren(out *strings.Builder, node *xhtml.Node) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		writeSimplified(out, child)
	}
}

// safeHref keeps the protocols the simplified clipboard allows: web, mail and
// relative document links. A stripped scheme means no anchor at all.
func safeHref(href string) bool {
	href = strings.TrimSpace(href)
	if href == "" {
		return false
	}
	colon := strings.Index(href, ":")
	if colon <= 0 {
		return true
	}
	for i := range colon {
		c := href[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '+' || c == '-' || c == '.') {
			return true // a colon after a path character is not a scheme
		}
	}
	switch strings.ToLower(href[:colon]) {
	case "http", "https", "mailto":
		return true
	default:
		return false
	}
}

// htmlToText is the readable-text view of sanitized HTML. Tables keep their
// shape as tab-separated cells; code keeps line breaks; images contribute
// their alternative text.
func htmlToText(markup string) string {
	root, err := xhtml.Parse(strings.NewReader(markup))
	if err != nil {
		return ""
	}
	var out strings.Builder
	writeText(&out, root, false)
	return normalizeText(out.String())
}

func writeText(out *strings.Builder, node *xhtml.Node, inPre bool) {
	switch node.Type {
	case xhtml.TextNode:
		if inPre {
			out.WriteString(node.Data)
		} else {
			writeCollapsed(out, node.Data)
		}
		return
	case xhtml.CommentNode, xhtml.DoctypeNode:
		return
	case xhtml.ElementNode:
		switch node.Data {
		case "script", "style", "head", "title", "meta", "link", "input", "svg":
			return
		case "table":
			writeTableText(out, node)
			return
		case "img":
			writeCollapsed(out, attrValue(node, "alt"))
			return
		case "br":
			out.WriteString("\n")
			return
		case "pre":
			ensureNewline(out, 2)
			writePre(out, node)
			ensureNewline(out, 2)
			return
		case "p", "div", "section", "article", "blockquote",
			"h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol":
			ensureNewline(out, 2)
			writeTextChildren(out, node, inPre)
			ensureNewline(out, 2)
			return
		case "li", "tr":
			ensureNewline(out, 1)
			writeTextChildren(out, node, inPre)
			ensureNewline(out, 1)
			return
		case "td", "th":
			writeTextChildren(out, node, inPre)
			return
		}
	}
	writeTextChildren(out, node, inPre)
}

func writeTextChildren(out *strings.Builder, node *xhtml.Node, inPre bool) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		writeText(out, child, inPre)
	}
}

func writePre(out *strings.Builder, node *xhtml.Node) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		switch child.Type {
		case xhtml.TextNode:
			out.WriteString(child.Data)
		case xhtml.ElementNode:
			if child.Data == "code" {
				writePre(out, child)
			} else {
				writeText(out, child, true)
			}
		}
	}
}

// writeTableText emits one line per row with a tab between cells (P2 §7.2).
func writeTableText(out *strings.Builder, table *xhtml.Node) {
	ensureNewline(out, 2)
	var rows []*xhtml.Node
	var collectRows func(*xhtml.Node)
	collectRows = func(node *xhtml.Node) {
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if child.Type != xhtml.ElementNode {
				continue
			}
			switch child.Data {
			case "tr":
				rows = append(rows, child)
			case "thead", "tbody", "tfoot":
				collectRows(child)
			}
		}
	}
	collectRows(table)
	for _, row := range rows {
		var cells []string
		for child := row.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == xhtml.ElementNode && (child.Data == "td" || child.Data == "th") {
				cells = append(cells, inlineText(child))
			}
		}
		out.WriteString(strings.Join(cells, "\t"))
		out.WriteString("\n")
	}
	ensureNewline(out, 2)
}

func inlineText(node *xhtml.Node) string {
	var out strings.Builder
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		switch n.Type {
		case xhtml.TextNode:
			writeCollapsed(&out, n.Data)
		case xhtml.ElementNode:
			switch n.Data {
			case "script", "style", "input":
				return
			case "img":
				writeCollapsed(&out, attrValue(n, "alt"))
				return
			case "br":
				out.WriteString(" ")
				return
			}
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				walk(child)
			}
		}
	}
	walk(node)
	return strings.TrimSpace(out.String())
}

func attrValue(node *xhtml.Node, key string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, key) {
			return attr.Val
		}
	}
	return ""
}

// writeCollapsed writes text with whitespace runs reduced to one space,
// keeping the leading or trailing space that separates neighbouring inline
// nodes.
func writeCollapsed(out *strings.Builder, text string) {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return
	}
	runes := []rune(text)
	if unicode.IsSpace(runes[0]) && out.Len() > 0 && !endsWithSpace(out.String()) {
		out.WriteByte(' ')
	}
	out.WriteString(strings.Join(fields, " "))
	if unicode.IsSpace(runes[len(runes)-1]) {
		out.WriteByte(' ')
	}
}

func endsWithSpace(text string) bool {
	if text == "" {
		return false
	}
	runes := []rune(text)
	return unicode.IsSpace(runes[len(runes)-1])
}

func ensureNewline(out *strings.Builder, count int) {
	current := 0
	text := out.String()
	for i := len(text) - 1; i >= 0 && text[i] == '\n'; i-- {
		current++
	}
	for current < count {
		out.WriteByte('\n')
		current++
	}
}

func normalizeText(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var out []string
	blank := 0
	for _, line := range lines {
		line = strings.TrimRight(line, " \t")
		if strings.TrimSpace(line) == "" {
			blank++
			if blank > 1 || len(out) == 0 {
				continue
			}
			out = append(out, "")
			continue
		}
		blank = 0
		out = append(out, line)
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
