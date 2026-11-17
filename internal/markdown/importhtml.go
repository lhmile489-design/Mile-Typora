package markdown

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	xhtml "golang.org/x/net/html"
)

// ImportedDoc is the Markdown text and the format-loss warnings an import
// produced. It is never written to disk by the converter.
type ImportedDoc struct {
	Text     string
	Warnings []string
}

// ImportHTML converts the readable parts of an HTML document to Markdown.
// Scripts, styles, frames and form controls are dropped, never executed.
func ImportHTML(ctx context.Context, src []byte) (ImportedDoc, error) {
	root, err := xhtml.Parse(bytes.NewReader(src))
	if err != nil {
		return ImportedDoc{}, fmt.Errorf("html: %w", err)
	}
	st := &htmlImporter{ctx: ctx, seen: map[string]bool{}}
	var b strings.Builder
	if err := st.renderChildren(root, &b, false); err != nil {
		return ImportedDoc{}, err
	}
	return ImportedDoc{Text: cleanupImported(b.String()), Warnings: st.warnings}, nil
}

type htmlImporter struct {
	ctx      context.Context
	warnings []string
	seen     map[string]bool
}

func (s *htmlImporter) warn(message string) {
	if s.seen[message] {
		return
	}
	s.seen[message] = true
	s.warnings = append(s.warnings, message)
}

func (s *htmlImporter) check() error {
	if err := s.ctx.Err(); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	return nil
}

func (s *htmlImporter) renderChildren(n *xhtml.Node, b *strings.Builder, raw bool) error {
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if err := s.renderNode(child, b, raw); err != nil {
			return err
		}
	}
	return nil
}

func (s *htmlImporter) renderNode(n *xhtml.Node, b *strings.Builder, raw bool) error {
	if err := s.check(); err != nil {
		return err
	}
	if n.Type == xhtml.TextNode {
		if raw {
			b.WriteString(n.Data)
			return nil
		}
		text := collapseSpace(n.Data)
		if text != "" {
			if b.Len() > 0 && !htmlEndsWithSpace(b.String()) {
				b.WriteByte(' ')
			}
			b.WriteString(text)
		}
		return nil
	}
	if n.Type != xhtml.ElementNode {
		return nil
	}
	tag := strings.ToLower(n.Data)
	switch tag {
	case "script", "style", "iframe", "object", "embed", "template", "form", "input", "select", "textarea", "noscript", "head":
		s.warn("已忽略脚本、样式、表单或嵌入内容")
		return nil
	case "html", "body", "main", "article", "section", "header", "footer", "nav", "span", "font", "center":
		return s.renderChildren(n, b, raw)
	case "p", "div":
		inner := s.inline(n)
		s.block(b, inner)
		return nil
	case "h1", "h2", "h3", "h4", "h5", "h6":
		inner := s.inline(n)
		if inner == "" {
			return nil
		}
		s.block(b, strings.Repeat("#", int(tag[1]-'0'))+" "+inner)
		return nil
	case "br":
		b.WriteString("  \n")
		return nil
	case "strong", "b":
		s.inlineWrap(n, b, "**")
		return nil
	case "em", "i":
		s.inlineWrap(n, b, "*")
		return nil
	case "del", "s", "strike":
		s.inlineWrap(n, b, "~~")
		return nil
	case "code":
		if n.Parent != nil && strings.EqualFold(n.Parent.Data, "pre") {
			b.WriteString(htmlText(n))
			return nil
		}
		text := htmlText(n)
		if text != "" {
			b.WriteString("`" + strings.ReplaceAll(text, "`", "\\`") + "`")
		}
		return nil
	case "pre":
		code := firstElement(n, "code")
		target := n
		if code != nil {
			target = code
		}
		text := htmlText(target)
		if text == "" {
			return nil
		}
		language := ""
		if code != nil {
			language = codeLanguage(code)
		}
		s.block(b, "```"+language+"\n"+strings.TrimRight(text, "\n")+"\n```")
		return nil
	case "blockquote":
		inner := s.capture(n)
		if inner == "" {
			return nil
		}
		lines := strings.Split(inner, "\n")
		for i, line := range lines {
			if line != "" {
				lines[i] = "> " + line
			} else {
				lines[i] = ">"
			}
		}
		s.block(b, strings.Join(lines, "\n"))
		return nil
	case "ul", "ol":
		s.block(b, s.list(n, tag == "ol", 0))
		return nil
	case "li":
		return s.renderChildren(n, b, raw)
	case "table":
		s.block(b, s.table(n))
		return nil
	case "a":
		href := strings.TrimSpace(htmlAttr(n, "href"))
		text := s.inline(n)
		if text == "" {
			return nil
		}
		if safeImportURL(href, true) {
			b.WriteString("[" + text + "](" + href + ")")
		} else {
			b.WriteString(text)
			if href != "" {
				s.warn("已移除不支持的链接协议")
			}
		}
		return nil
	case "img":
		alt := strings.TrimSpace(htmlAttr(n, "alt"))
		src := strings.TrimSpace(htmlAttr(n, "src"))
		if safeImportURL(src, false) {
			if alt == "" {
				alt = "图片"
			}
			b.WriteString("![" + strings.ReplaceAll(alt, "]", "\\]") + "](" + src + ")")
		} else if alt != "" {
			b.WriteString(alt)
			s.warn("本地或内嵌图片未导入，只保留替代文字")
		} else {
			s.warn("本地或内嵌图片未导入")
		}
		return nil
	case "hr":
		s.block(b, "---")
		return nil
	default:
		return s.renderChildren(n, b, raw)
	}
}

func (s *htmlImporter) inline(n *xhtml.Node) string {
	var b strings.Builder
	_ = s.renderChildren(n, &b, false)
	return strings.TrimSpace(b.String())
}

func (s *htmlImporter) inlineWrap(n *xhtml.Node, b *strings.Builder, marker string) {
	inner := s.inline(n)
	if inner != "" {
		b.WriteString(marker + inner + marker)
	}
}

func (s *htmlImporter) capture(n *xhtml.Node) string {
	var b strings.Builder
	if err := s.renderChildren(n, &b, false); err != nil {
		return ""
	}
	return strings.TrimSpace(b.String())
}

func (s *htmlImporter) block(b *strings.Builder, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if b.Len() > 0 {
		current := b.String()
		if !strings.HasSuffix(current, "\n\n") {
			if strings.HasSuffix(current, "\n") {
				b.WriteByte('\n')
			} else {
				b.WriteString("\n\n")
			}
		}
	}
	b.WriteString(text)
	b.WriteString("\n")
}

func (s *htmlImporter) list(n *xhtml.Node, ordered bool, depth int) string {
	var lines []string
	index := 0
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != xhtml.ElementNode || !strings.EqualFold(child.Data, "li") {
			continue
		}
		index++
		var inline strings.Builder
		var nested []string
		for item := child.FirstChild; item != nil; item = item.NextSibling {
			if item.Type == xhtml.ElementNode && (strings.EqualFold(item.Data, "ul") || strings.EqualFold(item.Data, "ol")) {
				nested = append(nested, s.list(item, strings.EqualFold(item.Data, "ol"), depth+1))
				continue
			}
			_ = s.renderNode(item, &inline, false)
		}
		text := strings.TrimSpace(collapseSpace(inline.String()))
		marker := "- "
		if ordered {
			marker = fmt.Sprintf("%d. ", index)
		}
		if text == "" {
			text = ""
		}
		prefix := strings.Repeat("  ", depth)
		lines = append(lines, prefix+marker+text)
		for _, block := range nested {
			for _, line := range strings.Split(block, "\n") {
				if line != "" {
					lines = append(lines, line)
				}
			}
		}
	}
	return strings.Join(lines, "\n")
}

func (s *htmlImporter) table(n *xhtml.Node) string {
	var rows [][]string
	var walkRows func(*xhtml.Node)
	walkRows = func(node *xhtml.Node) {
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if child.Type != xhtml.ElementNode {
				continue
			}
			tag := strings.ToLower(child.Data)
			if tag == "tr" {
				var cells []string
				for cell := child.FirstChild; cell != nil; cell = cell.NextSibling {
					if cell.Type != xhtml.ElementNode || (!strings.EqualFold(cell.Data, "td") && !strings.EqualFold(cell.Data, "th")) {
						continue
					}
					text := strings.TrimSpace(collapseSpace(s.inline(cell)))
					text = strings.ReplaceAll(text, "|", "\\|")
					text = strings.ReplaceAll(text, "\n", " ")
					cells = append(cells, text)
				}
				if len(cells) > 0 {
					rows = append(rows, cells)
				}
				continue
			}
			if tag == "tbody" || tag == "thead" || tag == "tfoot" {
				walkRows(child)
			}
		}
	}
	walkRows(n)
	if len(rows) == 0 {
		return ""
	}
	columns := len(rows[0])
	for i := range rows {
		for len(rows[i]) < columns {
			rows[i] = append(rows[i], "")
		}
	}
	var b strings.Builder
	b.WriteString("| " + strings.Join(rows[0], " | ") + " |\n")
	separator := make([]string, columns)
	for i := range separator {
		separator[i] = "---"
	}
	b.WriteString("| " + strings.Join(separator, " | ") + " |\n")
	for _, row := range rows[1:] {
		b.WriteString("| " + strings.Join(row[:columns], " | ") + " |\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func htmlAttr(n *xhtml.Node, name string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, name) {
			return a.Val
		}
	}
	return ""
}

func firstElement(n *xhtml.Node, tag string) *xhtml.Node {
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == xhtml.ElementNode && strings.EqualFold(child.Data, tag) {
			return child
		}
	}
	return nil
}

func htmlText(n *xhtml.Node) string {
	var b strings.Builder
	var walk func(*xhtml.Node)
	walk = func(node *xhtml.Node) {
		if node.Type == xhtml.TextNode {
			b.WriteString(node.Data)
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return b.String()
}

func codeLanguage(n *xhtml.Node) string {
	className := htmlAttr(n, "class")
	for _, field := range strings.Fields(className) {
		if strings.HasPrefix(field, "language-") {
			return strings.TrimPrefix(field, "language-")
		}
	}
	if language := htmlAttr(n, "data-language"); language != "" {
		return language
	}
	return ""
}

func collapseSpace(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func htmlEndsWithSpace(text string) bool {
	if text == "" {
		return false
	}
	last := text[len(text)-1]
	return last == ' ' || last == '\n' || last == '\t'
}

func safeImportURL(raw string, allowMail bool) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
		return true
	}
	return allowMail && strings.HasPrefix(value, "mailto:")
}

func cleanupImported(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	var out []string
	blank := 0
	fenced := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			fenced = !fenced
		}
		if !fenced && trimmed == "" {
			blank++
			if blank > 2 {
				continue
			}
			out = append(out, "")
		} else {
			blank = 0
			if fenced {
				out = append(out, line)
			} else {
				out = append(out, strings.TrimRight(line, " \t"))
			}
		}
	}
	for len(out) > 0 && strings.TrimSpace(out[0]) == "" {
		out = out[1:]
	}
	for len(out) > 0 && strings.TrimSpace(out[len(out)-1]) == "" {
		out = out[:len(out)-1]
	}
	if len(out) == 0 {
		return ""
	}
	return strings.Join(out, "\n") + "\n"
}
