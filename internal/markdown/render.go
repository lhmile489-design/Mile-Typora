// Package markdown turns Markdown into HTML the page may show. Parsing and
// cleaning both happen here, so the page never receives markup outside the
// whitelist (docs/decisions.md D-T02, CLAUDE.md §6).
package markdown

import (
	"bytes"
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// Timeout bounds one render (PRD §8.3).
const Timeout = 8 * time.Second

// Failure is an expected render problem, phrased for the user.
type Failure struct {
	Code   string
	Detail string
}

func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

// Renderer holds the parser and the whitelist; it is safe for concurrent use.
type Renderer struct {
	md     goldmark.Markdown
	policy *bluemonday.Policy
}

// New returns a Renderer for CommonMark with GFM.
func New() *Renderer {
	return &Renderer{
		md: goldmark.New(
			goldmark.WithExtensions(extension.GFM),
			goldmark.WithRendererOptions(
				// Raw HTML is shown as text, never parsed (PRD FR-04).
				renderer.WithNodeRenderers(util.Prioritized(&rawHTMLRenderer{}, 100)),
			),
		),
		policy: newPolicy(),
	}
}

// Render returns sanitized HTML for src. A nil Failure means success.
func (r *Renderer) Render(ctx context.Context, src []byte) (string, *Failure) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()

	type result struct {
		html string
		err  error
	}
	done := make(chan result, 1)
	go func() {
		// goldmark does not take a context: run it aside and let the select
		// below give up on it. The goroutine finishes on its own.
		defer func() {
			if rec := recover(); rec != nil {
				done <- result{err: fmt.Errorf("renderer panic: %v", rec)}
			}
		}()
		var buf bytes.Buffer
		if err := r.md.Convert(src, &buf); err != nil {
			done <- result{err: err}
			return
		}
		done <- result{html: buf.String()}
	}()

	select {
	case <-ctx.Done():
		return "", &Failure{Code: "render_timeout", Detail: "渲染超时，请稍后重试"}
	case res := <-done:
		if res.err != nil {
			return "", &Failure{Code: "render_failed", Detail: "无法解析此文档"}
		}
		// The whitelist is the last line of defence: whatever the renderer
		// emitted, only known tags and attributes reach the page.
		return r.policy.Sanitize(res.html), nil
	}
}

// rawHTMLRenderer shows raw HTML as text: goldmark's default drops it and
// writes a comment, which would hide what the document says (PRD FR-04).
type rawHTMLRenderer struct{}

func (h *rawHTMLRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHTMLBlock, h.renderBlock)
	reg.Register(ast.KindRawHTML, h.renderInline)
}

func (h *rawHTMLRenderer) renderBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	block, ok := node.(*ast.HTMLBlock)
	if !ok {
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<pre class="raw-html">`)
	for i := range block.Lines().Len() {
		line := block.Lines().At(i)
		_, _ = w.Write(util.EscapeHTML(line.Value(source)))
	}
	_, _ = w.WriteString("</pre>\n")
	return ast.WalkContinue, nil
}

func (h *rawHTMLRenderer) renderInline(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	raw, ok := node.(*ast.RawHTML)
	if !ok {
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<code class="raw-html">`)
	for i := range raw.Segments.Len() {
		segment := raw.Segments.At(i)
		_, _ = w.Write(util.EscapeHTML(segment.Value(source)))
	}
	_, _ = w.WriteString(`</code>`)
	return ast.WalkContinue, nil
}

// classNames are the only class values this package emits; the whitelist keeps
// any others out (a document cannot invent a class of its own).
var classNames = regexp.MustCompile(`^(raw-html|math|mermaid-src|code|fm)$`)

// newPolicy is a whitelist designed for what rawHTMLRenderer and goldmark
// emit, not a general-purpose one (CLAUDE.md §6).
func newPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()

	p.AllowElements(
		"p", "h1", "h2", "h3", "h4", "h5", "h6",
		"a", "strong", "em", "del", "code", "pre",
		"blockquote", "ul", "ol", "li",
		"table", "thead", "tbody", "tr", "th", "td",
		"hr", "br", "img", "span", "div", "input",
	)
	p.AllowAttrs("href").OnElements("a")
	p.AllowAttrs("src", "alt", "title").OnElements("img")
	p.AllowAttrs("id").OnElements("h1", "h2", "h3", "h4", "h5", "h6")
	p.AllowAttrs("class").Matching(classNames).OnElements("span", "div", "pre", "code")
	p.AllowAttrs("type", "disabled", "checked").OnElements("input")
	p.AllowAttrs("align").OnElements("th", "td")
	p.AllowAttrs("start").OnElements("ol")

	// Links may point at the web (opened through the system browser later) and
	// at the app's own resource protocol; relative links stay for the document
	// flow. Anything else, javascript: included, is removed.
	p.AllowURLSchemes("http", "https", "mtres")
	p.AllowRelativeURLs(true)

	// No style, script or event attributes, no iframes or objects: the
	// whitelist above never allows them.
	return p
}
