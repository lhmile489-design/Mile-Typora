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
	out, failure := New().Render(context.Background(), []byte(src))
	if failure != nil {
		t.Fatalf("Render: %+v", failure)
	}
	return out
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
		"<h1>一级标题</h1>",
		"<h2>列表</h2>",
		"<strong>加粗</strong>",
		"<em>斜体</em>",
		"<del>删除线</del>",
		"<code>行内代码</code>",
		"<ul>", "<ol>", "<li>",
		"<blockquote>",
		"<hr>",
		"<table>", "<thead>", "<tbody>", "<th", "<td",
		"<pre><code",
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
	if !strings.Contains(html, "plain text") || !strings.Contains(html, "<pre>") {
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
	if _, failure := New().Render(ctx, []byte("# 标题")); failure == nil || failure.Code != "render_timeout" {
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
		out, failure := renderer.Render(context.Background(), src)
		if failure != nil {
			// A timeout or a refused render is an answer; what matters is that
			// it is reported instead of crashing.
			return
		}
		assertSafe(t, "fuzz", out)
	})
}
