// Package markdown turns Markdown into HTML the page may show. Parsing and
// cleaning both happen here, so the page never receives markup outside the
// whitelist (docs/decisions.md D-T02, CLAUDE.md §6). Formulas and diagrams
// keep their source here; the page renders them (D-T02).
package markdown

import (
	"bytes"
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
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

// Limits are the per-document bounds of PRD §8.3.
const (
	MaxMathBytes     = 16 << 10 // one formula's source
	MaxMermaidBytes  = 64 << 10 // one diagram's source
	MaxMathBlocks    = 200      // formulas rendered per document
	MaxMermaidBlocks = 20       // diagrams rendered per document
)

// Failure is an expected render problem, phrased for the user.
type Failure struct {
	Code   string
	Detail string
}

func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

// Result is what one render produced.
type Result struct {
	HTML string
	// Counts tells the page how many formulas and diagrams it has, and how
	// many were left as source because of a limit.
	Counts Counts
}

// Counts reports what a document holds, so the status bar can say how much
// was rendered and what was not (PRD §8.3).
type Counts struct {
	Math           int
	MathLimited    int
	Mermaid        int
	MermaidLimited int
}

// Renderer holds the parser and the whitelist.
//
// goldmark node renderers cannot see a per-call context, so the limits of one
// document are counted on the Renderer itself: renders are serialized. They
// are CPU-bound and short; M3-7 measures whether that is enough.
type Renderer struct {
	mu     sync.Mutex
	md     goldmark.Markdown
	policy *bluemonday.Policy
	counts Counts
}

// New returns a Renderer for CommonMark with GFM and formula delimiters.
func New() *Renderer {
	r := &Renderer{policy: newPolicy()}
	r.md = goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,
			Math(),
		),
		goldmark.WithRendererOptions(
			renderer.WithNodeRenderers(util.Prioritized(r, 100)),
		),
	)
	return r
}

// Render returns sanitized HTML for src. A nil Failure means success.
func (r *Renderer) Render(ctx context.Context, src []byte) (Result, *Failure) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()

	type outcome struct {
		res Result
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.counts = Counts{}
		defer func() {
			if rec := recover(); rec != nil {
				done <- outcome{err: fmt.Errorf("renderer panic: %v", rec)}
			}
		}()
		var buf bytes.Buffer
		// Block formulas become fences first; see preprocessMath.
		if err := r.md.Convert(preprocessMath(src), &buf); err != nil {
			done <- outcome{err: err}
			return
		}
		counts := r.counts
		// The whitelist is the last line of defence: whatever the renderer
		// emitted, only known tags and attributes reach the page.
		done <- outcome{res: Result{HTML: r.policy.Sanitize(buf.String()), Counts: counts}}
	}()

	select {
	case <-ctx.Done():
		return Result{}, &Failure{Code: "render_timeout", Detail: "渲染超时，请稍后重试"}
	case out := <-done:
		if out.err != nil {
			return Result{}, &Failure{Code: "render_failed", Detail: "无法解析此文档"}
		}
		return out.res, nil
	}
}

// RegisterFuncs implements renderer.NodeRenderer for the nodes this package
// renders itself.
func (r *Renderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHTMLBlock, r.renderRawBlock)
	reg.Register(ast.KindRawHTML, r.renderRawInline)
	reg.Register(KindMathInline, r.renderMathInline)
	reg.Register(ast.KindFencedCodeBlock, r.renderFence)
}

// rawHTMLRenderer behaviour: raw HTML is shown as text, never parsed
// (PRD FR-04). goldmark's default drops it and writes a comment instead.
func (r *Renderer) renderRawBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
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

func (r *Renderer) renderRawInline(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
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

// renderMathInline wraps TeX for the page's KaTeX pass, or leaves the source
// as text when the document exceeds its formula budget.
func (r *Renderer) renderMathInline(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n, ok := node.(*MathInline)
	if !ok {
		return ast.WalkContinue, nil
	}
	tex := n.Tex.Value(source)
	r.counts.Math++
	if len(tex) > MaxMathBytes || r.counts.Math > MaxMathBlocks {
		r.counts.MathLimited++
		writeLimited(w, "math", limitReason(len(tex), MaxMathBytes, r.counts.Math, MaxMathBlocks), tex)
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<span class="math" data-display="false">`)
	_, _ = w.Write(util.EscapeHTML(tex))
	_, _ = w.WriteString(`</span>`)
	return ast.WalkContinue, nil
}

// renderFence writes a Mermaid diagram's source, or a block formula's TeX,
// for the page, and every other fence as plain code: registering for fenced
// blocks replaces goldmark's own renderer, so this one answers for all of
// them. M2-3 adds highlighting here.
func (r *Renderer) renderFence(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	block, ok := node.(*ast.FencedCodeBlock)
	if !ok || !entering {
		return ast.WalkContinue, nil
	}
	language := strings.TrimSpace(string(block.Language(source)))
	var lines []byte
	for i := range block.Lines().Len() {
		line := block.Lines().At(i)
		lines = append(lines, line.Value(source)...)
	}

	if strings.EqualFold(language, blockMathLang) {
		r.counts.Math++
		if len(lines) > MaxMathBytes || r.counts.Math > MaxMathBlocks {
			r.counts.MathLimited++
			writeLimited(w, "math", limitReason(len(lines), MaxMathBytes, r.counts.Math, MaxMathBlocks), lines)
			return ast.WalkContinue, nil
		}
		_, _ = w.WriteString(`<div class="math" data-display="true">`)
		_, _ = w.Write(util.EscapeHTML(lines))
		_, _ = w.WriteString("</div>" + "\n")
		return ast.WalkContinue, nil
	}

	if !strings.EqualFold(language, "mermaid") {
		if language == "" {
			_, _ = w.WriteString("<pre><code>")
		} else {
			_, _ = fmt.Fprintf(w, `<pre><code class="language-%s">`, util.EscapeHTML([]byte(language)))
		}
		_, _ = w.Write(util.EscapeHTML(lines))
		_, _ = w.WriteString("</code></pre>\n")
		return ast.WalkContinue, nil
	}

	r.counts.Mermaid++
	if len(lines) > MaxMermaidBytes || r.counts.Mermaid > MaxMermaidBlocks {
		r.counts.MermaidLimited++
		writeLimited(w, "mermaid", limitReason(len(lines), MaxMermaidBytes, r.counts.Mermaid, MaxMermaidBlocks), lines)
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<pre class="mermaid-src" data-lang="mermaid">`)
	_, _ = w.Write(util.EscapeHTML(lines))
	_, _ = w.WriteString("</pre>\n")
	return ast.WalkContinue, nil
}

func isMermaid(language []byte) bool {
	return bytes.EqualFold(bytes.TrimSpace(language), []byte("mermaid"))
}

// writeLimited leaves the source visible with the reason it was not enhanced
// (PRD §8.3): a limit must not look like a rendering bug.
func writeLimited(w util.BufWriter, kind, reason string, src []byte) {
	_, _ = fmt.Fprintf(w, `<div class="limited" data-kind=%q data-reason=%q>`, kind, reason)
	_, _ = w.Write(util.EscapeHTML(src))
	_, _ = w.WriteString("</div>\n")
}

func limitReason(size, maxSize, count, maxCount int) string {
	if size > maxSize {
		return fmt.Sprintf("超过单块上限 %d KiB", maxSize>>10)
	}
	return fmt.Sprintf("超过每篇 %d 块的上限", maxCount)
}

// classNames are the only class values this package emits; the whitelist keeps
// any others out (a document cannot invent a class of its own).
var classNames = regexp.MustCompile(`^(raw-html|math|mermaid-src|limited|code|fm)$`)

// newPolicy is a whitelist designed for what this package emits, not a
// general-purpose one (CLAUDE.md §6).
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
	p.AllowAttrs("data-display").OnElements("span", "div")
	p.AllowAttrs("data-kind", "data-reason").OnElements("div")
	p.AllowAttrs("data-lang").OnElements("pre", "div")
	p.AllowAttrs("type", "disabled", "checked").OnElements("input")
	p.AllowAttrs("align").OnElements("th", "td")
	p.AllowAttrs("start").OnElements("ol")

	// Links may point at the web and at the app's own resource protocol;
	// relative links stay for the document flow. Anything else is removed.
	p.AllowURLSchemes("http", "https", "mtres")
	p.AllowRelativeURLs(true)

	return p
}
