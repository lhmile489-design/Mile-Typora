package markdown

import (
	"html"
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
)

// ExportDocument is one standalone HTML export (M5-6 FILE-16).
type ExportDocument struct {
	HTML     string
	Warnings []string
}

// ExportImageResolver turns an image reference in the page-rendered body into
// a data URI. A non-empty warning means the image was left out; the exporter
// writes a placeholder in its place.
type ExportImageResolver func(src string) (dataURI string, warning string)

// BuildExportDocument wraps an already-enhanced Markdown body in the fixed
// export template and sanitizes it with the export whitelist. The body comes
// from the page after KaTeX and Mermaid ran; Go never trusts it as HTML.
func BuildExportDocument(bodyHTML, title string, resolve ExportImageResolver) (ExportDocument, *Failure) {
	root, err := xhtml.Parse(strings.NewReader("<body>" + bodyHTML + "</body>"))
	if err != nil {
		return ExportDocument{}, &Failure{Code: "export_failed", Detail: "无法解析导出内容"}
	}
	body := findExportBody(root)
	if body == nil {
		return ExportDocument{}, &Failure{Code: "export_failed", Detail: "导出内容为空"}
	}
	builder := &exportBuilder{resolve: resolve}
	builder.writeChildren(body, contextHTML)
	document := exportTemplate(title, builder.out.String())
	return ExportDocument{HTML: document, Warnings: builder.warnings}, nil
}

func findExportBody(node *xhtml.Node) *xhtml.Node {
	if node.Type == xhtml.ElementNode && node.Data == "body" {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := findExportBody(child); found != nil {
			return found
		}
	}
	return nil
}

type exportContext int

const (
	contextHTML exportContext = iota
	contextMath
	contextSVG
)

type exportBuilder struct {
	out      strings.Builder
	warnings []string
	resolve  ExportImageResolver
}

func (b *exportBuilder) writeChildren(node *xhtml.Node, context exportContext) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		b.writeNode(child, context)
	}
}

func (b *exportBuilder) writeNode(node *xhtml.Node, context exportContext) {
	switch node.Type {
	case xhtml.TextNode:
		b.out.WriteString(html.EscapeString(node.Data))
	case xhtml.CommentNode, xhtml.DoctypeNode:
		return
	case xhtml.ElementNode:
		name := strings.ToLower(node.Data)
		if name == "script" || name == "iframe" || name == "object" || name == "embed" || name == "foreignobject" {
			return
		}
		if name == "style" && context != contextSVG {
			return
		}
		if name == "details" && hasClass(node, "fm") {
			return
		}
		if name == "svg" {
			b.writeElement(node, contextSVG, exportSVGAttrs)
			return
		}
		if name == "math" {
			b.writeElement(node, contextMath, exportMathAttrs)
			return
		}
		if name == "style" {
			text := textContent(node)
			if safeStyleText(text) {
				b.out.WriteString("<style>")
				b.out.WriteString(text)
				b.out.WriteString("</style>")
			}
			return
		}
		if context == contextSVG {
			if !exportSVGElements[name] {
				return
			}
			b.writeElement(node, contextSVG, exportSVGAttrs)
			return
		}
		if context == contextMath {
			if !exportMathElements[name] {
				return
			}
			b.writeElement(node, contextMath, exportMathAttrs)
			return
		}
		if name == "img" {
			b.writeImage(node)
			return
		}
		if !exportHTMLElements[name] {
			b.writeChildren(node, contextHTML)
			return
		}
		b.writeElement(node, contextHTML, exportHTMLAttrs)
	}
}

func (b *exportBuilder) writeElement(node *xhtml.Node, context exportContext, attrs func(*xhtml.Node) []string) {
	name := strings.ToLower(node.Data)
	b.out.WriteString("<")
	b.out.WriteString(name)
	for _, attr := range attrs(node) {
		b.out.WriteString(" ")
		b.out.WriteString(attr)
	}
	b.out.WriteString(">")
	if name == "br" || name == "hr" || name == "input" {
		return
	}
	b.writeChildren(node, context)
	b.out.WriteString("</")
	b.out.WriteString(name)
	b.out.WriteString(">")
}

func (b *exportBuilder) writeImage(node *xhtml.Node) {
	alt := attr(node, "alt")
	src := attr(node, "src")
	if src == "" || b.resolve == nil {
		b.placeholder(alt, "图片未嵌入")
		return
	}
	dataURI, warning := b.resolve(src)
	if warning != "" || !validDataImage(dataURI) {
		if warning == "" {
			warning = "图片未嵌入"
		}
		b.warnings = append(b.warnings, warning)
		b.placeholder(alt, warning)
		return
	}
	b.out.WriteString(`<img src="`)
	b.out.WriteString(html.EscapeString(dataURI))
	b.out.WriteString(`" alt="`)
	b.out.WriteString(html.EscapeString(alt))
	b.out.WriteString(`">`)
}

func (b *exportBuilder) placeholder(alt, reason string) {
	b.out.WriteString(`<div class="limited" data-kind="image" data-reason="`)
	b.out.WriteString(html.EscapeString(reason))
	b.out.WriteString(`">`)
	b.out.WriteString(html.EscapeString(alt))
	b.out.WriteString(`</div>`)
}

var exportHTMLElements = map[string]bool{
	"p": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"a": true, "strong": true, "em": true, "del": true, "code": true, "pre": true,
	"blockquote": true, "ul": true, "ol": true, "li": true,
	"table": true, "thead": true, "tbody": true, "tr": true, "th": true, "td": true,
	"hr": true, "br": true, "img": true, "span": true, "div": true, "sup": true,
	"u": true, "nav": true, "input": true,
}

var exportMathElements = map[string]bool{
	"math": true, "semantics": true, "annotation": true, "annotation-xml": true,
	"mrow": true, "mi": true, "mo": true, "mn": true, "ms": true, "mtext": true,
	"mspace": true, "msub": true, "msup": true, "msubsup": true, "mfrac": true,
	"msqrt": true, "mroot": true, "mover": true, "munder": true, "munderover": true,
	"mmultiscripts": true, "mprescripts": true, "none": true, "mtable": true,
	"mtr": true, "mtd": true, "mlabeledtr": true, "mstyle": true, "mpadded": true,
	"mphantom": true, "menclose": true, "mfenced": true, "merror": true, "mglyph": true,
}

var exportSVGElements = map[string]bool{
	"svg": true, "g": true, "path": true, "rect": true, "circle": true, "ellipse": true,
	"line": true, "polyline": true, "polygon": true, "text": true, "tspan": true,
	"defs": true, "marker": true, "clippath": true, "lineargradient": true,
	"radialgradient": true, "stop": true, "pattern": true, "use": true, "title": true,
	"desc": true, "symbol": true,
}

var exportClass = regexp.MustCompile(`^(raw-html|math|math-error|mermaid-src|diagram|diagram-error|limited|code|fm|chroma|alert|alert-title|alert-note|alert-tip|alert-important|alert-warning|alert-caution|alert alert-(note|tip|important|warning|caution)|toc|toc-list|toc-item|toc-level-[1-6]|toc-link|footnotes|footnote-ref|footnote-backref)$`)
var exportTokenClass = regexp.MustCompile(`^[a-z][a-z0-9]{0,7}$`)

func exportHTMLAttrs(node *xhtml.Node) []string {
	name := strings.ToLower(node.Data)
	var out []string
	for _, attr := range node.Attr {
		key := strings.ToLower(attr.Key)
		switch key {
		case "id":
			if safeID(attr.Val) {
				out = append(out, `id="`+html.EscapeString(attr.Val)+`"`)
			}
		case "class":
			if name == "span" && exportTokenClass.MatchString(attr.Val) {
				out = append(out, `class="`+html.EscapeString(attr.Val)+`"`)
			} else if exportClass.MatchString(attr.Val) {
				out = append(out, `class="`+html.EscapeString(attr.Val)+`"`)
			}
		case "href":
			if name == "a" && safeExportHref(attr.Val) {
				out = append(out, `href="`+html.EscapeString(attr.Val)+`"`)
			}
		case "alt":
			if name == "img" {
				out = append(out, `alt="`+html.EscapeString(attr.Val)+`"`)
			}
		case "title":
			out = append(out, `title="`+html.EscapeString(attr.Val)+`"`)
		case "data-kind", "data-reason":
			if name == "div" || name == "span" {
				out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
			}
		case "data-display":
			if name == "span" || name == "div" {
				out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
			}
		case "data-lang":
			if name == "pre" || name == "div" {
				out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
			}
		case "data-type":
			if name == "div" {
				out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
			}
		case "type":
			if name == "input" && strings.EqualFold(attr.Val, "checkbox") {
				out = append(out, `type="checkbox"`)
			}
		case "checked":
			if name == "input" {
				out = append(out, "checked")
			}
		case "disabled":
			if name == "input" {
				out = append(out, "disabled")
			}
		case "colspan", "rowspan", "align":
			if name == "td" || name == "th" {
				out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
			}
		case "start":
			if name == "ol" {
				out = append(out, `start="`+html.EscapeString(attr.Val)+`"`)
			}
		}
	}
	return out
}

func exportMathAttrs(node *xhtml.Node) []string {
	var out []string
	for _, attr := range node.Attr {
		key := strings.ToLower(attr.Key)
		switch key {
		case "xmlns", "display", "encoding", "mathvariant", "mathcolor", "mathbackground",
			"width", "height", "depth", "lspace", "rspace", "stretchy", "fence",
			"separator", "symmetric", "minsize", "maxsize", "form", "linethickness",
			"columnalign", "rowspacing", "columnspacing", "displaystyle", "scriptlevel",
			"largeop", "movablelimits", "accent", "accentunder":
			out = append(out, key+"=\""+html.EscapeString(attr.Val)+`"`)
		}
	}
	return out
}

func exportSVGAttrs(node *xhtml.Node) []string {
	var out []string
	for _, attr := range node.Attr {
		key := strings.ToLower(attr.Key)
		value := attr.Val
		switch key {
		case "xmlns", "viewbox", "width", "height", "class", "id", "role",
			"aria-label", "aria-hidden", "x", "y", "x1", "y1", "x2", "y2",
			"cx", "cy", "r", "rx", "ry", "points", "d", "transform",
			"fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray",
			"stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity",
			"text-anchor", "dominant-baseline", "font-family", "font-size",
			"font-weight", "font-style", "marker-start", "marker-mid", "marker-end",
			"clip-path", "mask", "offset", "stop-color", "stop-opacity",
			"gradientunits", "gradienttransform", "patternunits", "preserveaspectratio":
			if (key == "fill" || key == "stroke" || strings.HasPrefix(key, "marker-") || key == "clip-path" || key == "mask") &&
				strings.Contains(strings.ToLower(value), "url(") && !safeStyleText(value) {
				continue
			}
			out = append(out, key+"=\""+html.EscapeString(value)+`"`)
		case "style":
			if safeStyleText(value) {
				out = append(out, `style="`+html.EscapeString(value)+`"`)
			}
		case "href", "xlink:href":
			if strings.HasPrefix(value, "#") {
				out = append(out, `href="`+html.EscapeString(value)+`"`)
			}
		}
	}
	return out
}

func safeID(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
			r == '-' || r == '_' || r == '.' || r == ':' {
			continue
		}
		if r > 127 && (r >= 0x4E00 && r <= 0x9FFF) {
			continue
		}
		return false
	}
	return true
}

func safeExportHref(href string) bool {
	href = strings.TrimSpace(href)
	if href == "" {
		return false
	}
	for _, r := range href {
		if r <= 0x20 || r == 0x7f {
			return false
		}
	}
	colon := strings.Index(href, ":")
	if colon <= 0 {
		return true
	}
	for i := range colon {
		c := href[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '+' || c == '-' || c == '.') {
			return true
		}
	}
	switch strings.ToLower(href[:colon]) {
	case "http", "https", "mailto":
		return true
	default:
		return false
	}
}

func validDataImage(url string) bool {
	lower := strings.ToLower(url)
	for _, prefix := range []string{
		"data:image/png;base64,", "data:image/jpeg;base64,",
		"data:image/gif;base64,", "data:image/webp;base64,",
	} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func safeStyleText(text string) bool {
	lower := strings.ToLower(text)
	if strings.ContainsAny(text, "<>") ||
		strings.Contains(lower, "@import") ||
		strings.Contains(lower, "expression") ||
		strings.Contains(lower, "javascript:") ||
		strings.Contains(lower, "behavior:") ||
		strings.Contains(lower, "http://") ||
		strings.Contains(lower, "https://") ||
		strings.Contains(lower, "data:") {
		return false
	}
	rest := text
	for {
		at := strings.Index(strings.ToLower(rest), "url(")
		if at < 0 {
			return true
		}
		end := strings.Index(rest[at+4:], ")")
		if end < 0 {
			return false
		}
		inner := strings.TrimSpace(rest[at+4 : at+4+end])
		if !strings.HasPrefix(inner, "#") || !safeID(strings.TrimSpace(inner[1:])) {
			return false
		}
		rest = rest[at+4+end+1:]
	}
}

func attr(node *xhtml.Node, key string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, key) {
			return attr.Val
		}
	}
	return ""
}

func hasClass(node *xhtml.Node, class string) bool {
	for name := range strings.FieldsSeq(attr(node, "class")) {
		if name == class {
			return true
		}
	}
	return false
}

func textContent(node *xhtml.Node) string {
	var out strings.Builder
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.TextNode {
			out.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return out.String()
}

// exportTemplate is a fixed document: no document-provided style or class is
// accepted outside the sanitized body (P2 §9.1).
func exportTemplate(title, body string) string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>` + html.EscapeString(title) + `</title>
<style>` + exportCSS + `</style>
</head>
<body><main class="markdown">` + body + `</main></body>
</html>`
}

const exportCSS = `
* { box-sizing: border-box; }
html { background: #FFFFFF; }
body { margin: 0; background: #FFFFFF; color: #262626;
  font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; }
.markdown { max-width: 956px; margin: 0 auto; padding: 40px 48px 60px;
  font-size: 16px; line-height: 1.75; overflow-wrap: break-word; }
.markdown > :first-child { margin-top: 0; }
.markdown p { margin: 0 0 1em; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
  font-family: "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", sans-serif;
  font-weight: 600; color: #111111; }
.markdown h1 { font-size: 2em; line-height: 1.3; margin: .8em 0 .6em; padding-bottom: .3em; border-bottom: 1px solid #E3E4E7; }
.markdown h2 { font-size: 1.5em; line-height: 1.35; margin: 1.4em 0 .6em; padding-bottom: .3em; border-bottom: 1px solid #E3E4E7; }
.markdown h3 { font-size: 1.25em; line-height: 1.4; margin: 1.3em 0 .5em; }
.markdown h4 { font-size: 1.0625em; line-height: 1.5; margin: 1.2em 0 .5em; }
.markdown h5 { font-size: 1em; line-height: 1.5; margin: 1.2em 0 .5em; }
.markdown h6 { font-size: .9375em; line-height: 1.5; margin: 1.2em 0 .5em; color: #636973; }
.markdown a { color: #1F64C8; text-decoration: none; }
.markdown strong { font-weight: 600; color: #111111; }
.markdown del { color: #636973; }
.markdown ul, .markdown ol { margin: 0 0 1em; padding-left: 1.75em; }
.markdown li { margin: .25em 0; }
.markdown li > ul, .markdown li > ol { margin: .25em 0; }
.markdown li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.2em; }
.markdown input[type="checkbox"] { margin: 0 .5em 0 0; accent-color: #1F64C8; }
.markdown blockquote { margin: 0 0 1em; padding-left: 16px; border-left: 3px solid #D0D2D6; color: #4F555D; }
.markdown blockquote > :last-child { margin-bottom: 0; }
.markdown hr { height: 0; margin: 1.5em 0; border: 0; border-top: 1px solid #E3E4E7; }
.markdown code { font-family: "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace;
  font-size: .875em; background: #F0F1F3; padding: .1em .35em; border-radius: 3px; }
.markdown pre { margin: 0 0 1em; padding: 12px 16px; background: #F6F7F8; border-radius: 6px; overflow-x: auto; }
.markdown pre code { background: none; padding: 0; font-size: .875em; line-height: 1.6; color: #262626; }
.markdown pre.raw-html, .markdown code.raw-html { color: #636973; white-space: pre-wrap; }
.markdown table { display: block; overflow-x: auto; margin: 0 0 1em; border-collapse: collapse;
  font-size: .9375em; line-height: 1.6; }
.markdown th, .markdown td { padding: 6px 12px; border: 1px solid #E3E4E7; text-align: left; }
.markdown th { background: #F6F7F8; font-weight: 600; color: #111111; }
.markdown u { text-decoration: underline; text-underline-offset: 2px; }
.markdown .alert { margin: 0 0 1em; padding: 12px 16px; border-left: 3px solid #1F64C8;
  border-radius: 4px; background: #E5EDFA; }
.markdown .alert-tip { border-left-color: #1F64C8; background: #E5EDFA; }
.markdown .alert-important, .markdown .alert-warning { border-left-color: #8A5300; background: #FFF5DC; }
.markdown .alert-caution { border-left-color: #B3261E; background: #FDEDEB; }
.markdown .alert-title { margin: 0 0 4px; font-weight: 600; color: #111111; }
.markdown .alert > :last-child { margin-bottom: 0; }
.markdown .toc { margin: 0 0 1em; padding: 8px 16px; border: 1px solid #E3E4E7;
  border-radius: 4px; background: #F6F7F8; }
.markdown .toc-list { margin: 0; padding-left: 0; list-style: none; }
.markdown .toc-item { margin: 2px 0; }
.markdown .toc-level-2 { padding-left: 1.2em; }
.markdown .toc-level-3 { padding-left: 2.4em; }
.markdown .toc-level-4 { padding-left: 3.6em; }
.markdown .toc-level-5 { padding-left: 4.8em; }
.markdown .toc-level-6 { padding-left: 6em; }
.markdown .toc-link { color: #262626; text-decoration: none; }
.markdown .footnotes { margin-top: 24px; padding-top: 12px; border-top: 1px solid #E3E4E7;
  font-size: .9375em; color: #4F555D; }
.markdown .footnotes hr { display: none; }
.markdown .footnote-ref { text-decoration: none; }
.markdown .footnote-backref { margin-left: 8px; color: #636973; }
.markdown img { max-width: 100%; height: auto; }
.markdown .math-error { display: block; margin: 1em 0; padding: 12px 16px;
  background: #F6F7F8; border: 1px dashed #D0D2D6; border-radius: 6px;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: .875em;
  color: #4F555D; white-space: pre-wrap; }
.markdown .math-error::before { content: "公式语法错误：" attr(data-reason); display: block;
  margin-bottom: 4px; color: #636973; }
.markdown .diagram { margin: 1em 0; text-align: center; overflow-x: auto; }
.markdown .diagram svg { max-width: 100%; height: auto; }
.markdown .diagram-error { border: 1px dashed #D0D2D6; border-radius: 6px; color: #4F555D; }
.markdown .limited { margin: 0 0 1em; padding: 12px 16px; background: #F6F7F8;
  border: 1px dashed #D0D2D6; border-radius: 6px; font-family: "Cascadia Mono", monospace;
  font-size: .875em; color: #4F555D; white-space: pre-wrap; overflow-x: auto; }
.markdown .limited::before { content: attr(data-reason); display: block; margin-bottom: 4px;
  color: #636973; font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif; }
.markdown .code { margin: 0 0 1em; background: #F6F7F8; border-radius: 6px; overflow-x: auto; }
.markdown .code pre.chroma { margin: 0; padding: 12px 16px; background: none;
  font-size: .875em; line-height: 1.6; }
.markdown .code pre.chroma code { background: none; padding: 0; }
.markdown .chroma .line { display: block; }
.markdown .chroma .k, .markdown .chroma .kc, .markdown .chroma .kd, .markdown .chroma .kn,
.markdown .chroma .kp, .markdown .chroma .kr { color: #CF222E; }
.markdown .chroma .kt { color: #953800; }
.markdown .chroma .s, .markdown .chroma .s1, .markdown .chroma .s2, .markdown .chroma .sb,
.markdown .chroma .sc, .markdown .chroma .sd, .markdown .chroma .se, .markdown .chroma .sh,
.markdown .chroma .si, .markdown .chroma .sr, .markdown .chroma .ss, .markdown .chroma .sx { color: #0A3069; }
.markdown .chroma .c, .markdown .chroma .c1, .markdown .chroma .cm, .markdown .chroma .cp,
.markdown .chroma .cs, .markdown .chroma .ch { color: #5C636C; font-style: italic; }
.markdown .chroma .nf, .markdown .chroma .fm { color: #8250DF; }
.markdown .chroma .m, .markdown .chroma .mb, .markdown .chroma .mf, .markdown .chroma .mh,
.markdown .chroma .mi, .markdown .chroma .mo, .markdown .chroma .il { color: #0550AE; }
.markdown .chroma .nc, .markdown .chroma .nn, .markdown .chroma .nt,
.markdown .chroma .no { color: #953800; }
.markdown math[display="block"] { display: block; margin: 1em 0; text-align: center; overflow-x: auto; }
@media print {
  body { background: #FFFFFF; }
  .markdown { max-width: none; margin: 0; padding: 0; }
  .markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
    break-after: avoid-page; page-break-after: avoid; }
  .markdown table { display: table; max-width: 100%; break-inside: avoid; page-break-inside: avoid; }
  .markdown thead { display: table-header-group; }
  .markdown tr { break-inside: avoid; page-break-inside: avoid; }
  .markdown img, .markdown math[display="block"], .markdown .diagram,
  .markdown pre, .markdown blockquote { break-inside: avoid; page-break-inside: avoid; }
  .markdown a { color: inherit; text-decoration: none; }
}
`
