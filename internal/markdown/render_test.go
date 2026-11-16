package markdown

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"

	xhtml "golang.org/x/net/html"
)

func render(t *testing.T, src string) string {
	t.Helper()
	res, failure := New().Render(context.Background(), []byte(src), nil)
	if failure != nil {
		t.Fatalf("Render: %+v", failure)
	}
	return res.HTML
}

func renderFile(t *testing.T, path string) string {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return render(t, string(src))
}

// dangerous lists elements the page must never receive.
var dangerous = map[string]bool{
	"script": true, "iframe": true, "object": true, "embed": true,
	"svg": true, "style": true, "form": true, "link": true, "meta": true, "base": true,
}

// assertSafe walks the output as a token stream, which has no nesting limit,
// and refuses executable content. Substring checks are not enough: the text of
// escaped HTML says "<script>" too, and that is exactly what should stay text.
func assertSafe(t *testing.T, label, out string) {
	t.Helper()
	z := xhtml.NewTokenizer(strings.NewReader(out))
	for {
		switch z.Next() {
		case xhtml.ErrorToken:
			if err := z.Err(); err != io.EOF {
				t.Fatalf("%s: cannot read output: %v", label, err)
			}
			return
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			tag := strings.ToLower(string(name))
			if dangerous[tag] {
				t.Errorf("%s: output contains <%s>", label, tag)
			}
			for hasAttr {
				var key, val []byte
				key, val, hasAttr = z.TagAttr()
				attr := strings.ToLower(string(key))
				if attr == "style" {
					t.Errorf("%s: <%s> carries a style attribute", label, tag)
				}
				if strings.HasPrefix(attr, "on") {
					t.Errorf("%s: <%s> carries the event attribute %s", label, tag, attr)
				}
				if attr == "href" || attr == "src" {
					target := strings.ToLower(strings.TrimSpace(string(val)))
					for _, bad := range []string{"javascript:", "data:", "vbscript:", "file:"} {
						if strings.HasPrefix(target, bad) {
							t.Errorf("%s: <%s> %s=%q", label, tag, attr, string(val))
						}
					}
				}
			}
		}
	}
}

// textOf returns the document's text content.
func textOf(out string) string {
	var b strings.Builder
	z := xhtml.NewTokenizer(strings.NewReader(out))
	for {
		tt := z.Next()
		if tt == xhtml.ErrorToken {
			return b.String()
		}
		if tt == xhtml.TextToken {
			b.Write(z.Text())
		}
	}
}

func TestGFMElements(t *testing.T) {
	html := renderFile(t, "../../testdata/render/gfm.md")
	for _, want := range []string{
		"<h1 id=\"一级标题\">",
		"<h2 id=\"列表\">",
		"<strong>加粗</strong>",
		"<em>斜体</em>",
		"<del>删除线</del>",
		"<code>行内代码</code>",
		"<ul>", "<ol>", "<li>",
		"<blockquote>",
		"<hr>",
		"<table>", "<thead>", "<tbody>", "<th", "<td",
		`<div class="code" data-lang="go">`, `<pre class="chroma">`, `<span class="`,
		`<a href="https://example.com">外部链接</a>`,
		`<img src="images/logo.png" alt="相对图片"`,
		"中文",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("output lacks %q\n%s", want, html)
		}
	}
	if strings.Count(html, `type="checkbox"`) != 2 {
		t.Errorf("want two task list checkboxes\n%s", html)
	}
	if !strings.Contains(html, `checked=""`) {
		t.Errorf("the checked task lost its state\n%s", html)
	}
	assertSafe(t, "gfm.md", html)
}

func TestUnknownLanguageFallsBackToPlainCode(t *testing.T) {
	html := render(t, "```nosuchlang\nplain text\n```\n")
	if !strings.Contains(html, "plain text") || !strings.Contains(html, `class="chroma"`) {
		t.Fatalf("output = %s, want a plain code block", html)
	}
}

func TestRawHTMLIsShownAsText(t *testing.T) {
	html := render(t, "<script>alert(\"x\")</script>\n\ninline <b>bold</b> here\n")
	assertSafe(t, "raw html", html)

	body := textOf(html)
	for _, want := range []string{`<script>alert("x")</script>`, "<b>", "bold", "</b>"} {
		if !strings.Contains(body, want) {
			t.Errorf("the document text lacks %q; got %q", want, body)
		}
	}
}

func TestMaliciousSample(t *testing.T) {
	html := renderFile(t, "../../testdata/malicious/html.md")
	assertSafe(t, "malicious/html.md", html)

	// What was dangerous is still readable as text.
	if body := textOf(html); !strings.Contains(body, "<script>alert('xss')</script>") {
		t.Errorf("the script was dropped instead of shown as text: %q", body)
	}
	if !strings.Contains(textOf(html), "普通段落里的") {
		t.Error("the readable text is gone")
	}
}

func TestRenderStopsWhenTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, failure := New().Render(ctx, []byte("# 标题"), nil); failure == nil || failure.Code != "render_timeout" {
		t.Fatalf("failure = %+v, want render_timeout", failure)
	}
}

func TestEmptyDocument(t *testing.T) {
	if html := render(t, ""); html != "" {
		t.Fatalf("output = %q, want empty", html)
	}
}

func FuzzRender(f *testing.F) {
	for _, path := range []string{
		"../../testdata/render/gfm.md",
		"../../testdata/malicious/html.md",
	} {
		if src, err := os.ReadFile(path); err == nil {
			f.Add(src)
		}
	}
	f.Add([]byte(`<a href="javascript:alert(1)">x</a>`))
	f.Add([]byte("| a | b |\n|---|---|\n| 1 | 2 |"))
	f.Add([]byte(strings.Repeat("- ", 2000)))

	renderer := New()
	f.Fuzz(func(t *testing.T, src []byte) {
		res, failure := renderer.Render(context.Background(), src, nil)
		out := res.HTML
		if failure != nil {
			// A timeout or a refused render is an answer; what matters is that
			// it is reported instead of crashing.
			return
		}
		assertSafe(t, "fuzz", out)
	})
}

func renderResult(t *testing.T, src string) Result {
	t.Helper()
	res, failure := New().Render(context.Background(), []byte(src), nil)
	if failure != nil {
		t.Fatalf("Render: %+v", failure)
	}
	return res
}

func TestMathDelimiters(t *testing.T) {
	res := renderResult(t, string(mustRead(t, "../../testdata/render/math.md")))
	if got := strings.Count(res.HTML, `data-display="false"`); got != 3 {
		t.Errorf("inline formulas = %d, want 3\n%s", got, res.HTML)
	}
	if got := strings.Count(res.HTML, `data-display="true"`); got != 2 {
		t.Errorf("block formulas = %d, want 2\n%s", got, res.HTML)
	}
	for _, want := range []string{"E = mc^2", "a^2 + b^2 = c^2", "begin{pmatrix}", "begin{aligned}", "a_i"} {
		if !strings.Contains(res.HTML, want) {
			t.Errorf("output lacks %q\n%s", want, res.HTML)
		}
	}
	if res.Counts.Math != 5 {
		t.Errorf("Counts.Math = %d, want 5", res.Counts.Math)
	}
}

func TestEscapedDollarAndCodeStayLiteral(t *testing.T) {
	res := renderResult(t, string(mustRead(t, "../../testdata/render/math.md")))
	if !strings.Contains(res.HTML, "$5") {
		t.Fatalf("the escaped dollar lost its text\n%s", res.HTML)
	}
	// The two code samples keep their dollars without becoming formulas.
	if strings.Count(res.HTML, `class="math"`) != 5 {
		t.Fatalf("a code sample turned into a formula\n%s", res.HTML)
	}
	assertSafe(t, "math.md", res.HTML)
}

func TestMermaidFencesKeepTheirSource(t *testing.T) {
	res := renderResult(t, string(mustRead(t, "../../testdata/render/mermaid.md")))
	if got := strings.Count(res.HTML, `class="mermaid-src"`); got != 8 {
		t.Fatalf("mermaid blocks = %d, want 8\n%s", got, res.HTML)
	}
	if res.Counts.Mermaid != 8 {
		t.Errorf("Counts.Mermaid = %d, want 8", res.Counts.Mermaid)
	}
	for _, want := range []string{"flowchart TD", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt", "pie"} {
		if !strings.Contains(res.HTML, want) {
			t.Errorf("output lacks %q", want)
		}
	}
	// The configuration directive travels as text; the page refuses it.
	if !strings.Contains(res.HTML, "%%{init:") {
		t.Error("the init directive is missing from the source text")
	}
	assertSafe(t, "mermaid.md", res.HTML)
}

func TestMathCountLimit(t *testing.T) {
	var b strings.Builder
	for range MaxMathBlocks + 1 {
		b.WriteString("$x$\n\n")
	}
	res := renderResult(t, b.String())
	if res.Counts.Math != MaxMathBlocks+1 || res.Counts.MathLimited != 1 {
		t.Fatalf("counts = %+v, want %d formulas and 1 limited", res.Counts, MaxMathBlocks+1)
	}
	if !strings.Contains(res.HTML, `class="limited"`) {
		t.Fatal("the over-limit formula is not marked")
	}
}

func TestMathSizeLimit(t *testing.T) {
	big := "$" + strings.Repeat("a", MaxMathBytes+16) + "$"
	res := renderResult(t, big)
	if res.Counts.MathLimited != 1 {
		t.Fatalf("counts = %+v, want one limited formula", res.Counts)
	}
	if !strings.Contains(res.HTML, "超过单块上限") {
		t.Fatalf("reason missing\n%.200s", res.HTML)
	}
}

func TestMermaidLimits(t *testing.T) {
	var b strings.Builder
	for i := range MaxMermaidBlocks + 1 {
		b.WriteString("```mermaid\nflowchart TD\n  A" + string(rune('a'+i%26)) + " --> B\n```\n\n")
	}
	res := renderResult(t, b.String())
	if res.Counts.MermaidLimited != 1 {
		t.Fatalf("counts = %+v, want one limited diagram", res.Counts)
	}

	huge := "```mermaid\n" + strings.Repeat("A --> B\n", MaxMermaidBytes/8+2) + "```\n"
	if res := renderResult(t, huge); res.Counts.MermaidLimited != 1 {
		t.Fatalf("counts = %+v, want the oversized diagram limited", res.Counts)
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return src
}

func TestImagesUseTheResolver(t *testing.T) {
	src := "![图](images/a.png)\n\n![远](https://example.com/x.png)\n"
	res, failure := New().Render(context.Background(), []byte(src), func(ref string) (string, string) {
		if ref == "images/a.png" {
			return "http://mtres.localhost/tok123", ""
		}
		return "", "远程图片未加载"
	})
	if failure != nil {
		t.Fatalf("Render: %+v", failure)
	}
	if !strings.Contains(res.HTML, `<img src="http://mtres.localhost/tok123" alt="图">`) {
		t.Fatalf("the local image was not rewritten\n%s", res.HTML)
	}
	if !strings.Contains(res.HTML, `data-kind="image" data-reason="远程图片未加载"`) {
		t.Fatalf("the remote image is not marked\n%s", res.HTML)
	}
	if !strings.Contains(res.HTML, ">远</div>") {
		t.Fatalf("the alt text of the blocked image is missing\n%s", res.HTML)
	}
	assertSafe(t, "images", res.HTML)
}

func TestImagesWithoutResolverKeepTheirSource(t *testing.T) {
	res := renderResult(t, "![图](images/a.png)\n")
	if !strings.Contains(res.HTML, `<img src="images/a.png" alt="图">`) {
		t.Fatalf("output = %s, want the source untouched", res.HTML)
	}
}
func TestHeadingIDsKeepChinese(t *testing.T) {
	html := render(t, "# 安装步骤\n\n## 安装步骤\n\n### 第一步：准备环境\n\n#### \n")
	for _, want := range []string{
		`id="安装步骤"`,
		`id="安装步骤-1"`,
		`id="第一步准备环境"`,
		`id="heading"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("output lacks %q\n%s", want, html)
		}
	}
}

func TestHeadingIDsArePerDocument(t *testing.T) {
	r := New()
	first, _ := r.Render(context.Background(), []byte("# 标题"), nil)
	second, _ := r.Render(context.Background(), []byte("# 标题"), nil)
	if first.HTML != second.HTML {
		t.Fatalf("the same heading got different ids across renders:\n%s\n%s", first.HTML, second.HTML)
	}
}

func TestFrontMatterIsFolded(t *testing.T) {
	src := "---\ntitle: 标题\ntags: [a, b]\n---\n\n# 正文\n"
	res := renderResult(t, src)
	if !strings.Contains(res.HTML, `class="fm"`) || !strings.Contains(res.HTML, "元信息 · 2 项") {
		t.Fatalf("output lacks the front matter block\n%s", res.HTML)
	}
	if !strings.Contains(res.HTML, "title: 标题") {
		t.Fatalf("the YAML is not shown\n%s", res.HTML)
	}
	if strings.Contains(res.HTML, "<h2>") || !strings.Contains(res.HTML, ">正文</h1>") {
		t.Fatalf("the document after the front matter is wrong\n%s", res.HTML)
	}
}

func TestUnclosedFrontMatterStaysText(t *testing.T) {
	res := renderResult(t, "---\ntitle: 标题\n\n# 正文\n")
	if strings.Contains(res.HTML, `class="fm"`) {
		t.Fatalf("an unclosed block became front matter\n%s", res.HTML)
	}
}

func TestTaskListCheckboxesAreReadOnly(t *testing.T) {
	html := render(t, "- [x] 完成\n- [ ] 未完成\n")
	if strings.Count(html, `type="checkbox"`) != 2 || strings.Count(html, `disabled=""`) != 2 {
		t.Fatalf("output = %s, want two disabled checkboxes", html)
	}
}
