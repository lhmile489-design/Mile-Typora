package markdown

import (
	"context"
	"strings"
	"testing"
)

func TestPlainTextKeepsReadableContent(t *testing.T) {
	r := New()
	source := `# 标题

正文 **粗体** 与 [链接](https://example.com) 和 ![图](assets/a.png)。

> 引用

- 第一项
- 第二项

| 名称 | 值 |
| --- | --- |
| 甲 | 1 |
| 乙 | 2 |

` + "```go" + `
fmt.Println("x")
` + "```" + `

<!-- 注释不出现 -->
`
	text, failure := r.PlainText(context.Background(), []byte(source))
	if failure != nil {
		t.Fatalf("PlainText failure = %+v", failure)
	}
	for _, want := range []string{"标题", "正文 粗体 与 链接 和 图", "引用", "第一项", "第二项", "名称\t值", "甲\t1", "乙\t2", `fmt.Println("x")`} {
		if !strings.Contains(text, want) {
			t.Fatalf("PlainText = %q, missing %q", text, want)
		}
	}
	for _, unwanted := range []string{"# ", "**", "[链接]", "](https", "<!--", "---", "| 名称"} {
		if strings.Contains(text, unwanted) {
			t.Fatalf("PlainText = %q, kept %q", text, unwanted)
		}
	}
}

func TestClipboardFragmentSanitizesDOMSelection(t *testing.T) {
	r := New()
	input := `<h2 onclick="alert(1)">标题</h2>` +
		`<p style="color:red">正文<script>alert(1)</script><img src="https://example.com/a.png" alt="图"></p>` +
		`<a href="javascript:alert(1)">坏链接</a>` +
		`<a href="https://example.com">好链接</a>` +
		`<table><tr><th>名称</th><th>值</th></tr><tr><td>甲</td><td>1</td></tr></table>`
	fragment, failure := r.ClipboardFragment(context.Background(), []byte(input), false, false)
	if failure != nil {
		t.Fatalf("ClipboardFragment failure = %+v", failure)
	}
	if !strings.Contains(fragment.HTML, "<h2>标题</h2>") {
		t.Fatalf("HTML = %q", fragment.HTML)
	}
	for _, unwanted := range []string{"script", "style=", "onclick", "javascript:", "<img", "class="} {
		if strings.Contains(fragment.HTML, unwanted) {
			t.Fatalf("HTML kept %q: %q", unwanted, fragment.HTML)
		}
	}
	if !strings.Contains(fragment.HTML, "<table>") {
		t.Fatalf("HTML lost the table: %q", fragment.HTML)
	}
	if !strings.Contains(fragment.Text, "名称\t值") || !strings.Contains(fragment.Text, "甲\t1") {
		t.Fatalf("Text = %q", fragment.Text)
	}
	if !strings.Contains(fragment.Text, "图") {
		t.Fatalf("Text lost the image alternative: %q", fragment.Text)
	}
}

func TestClipboardFragmentSimplifiedKeepsOnlyBasicSemantics(t *testing.T) {
	r := New()
	source := `## 标题

正文 **粗体** [链接](https://example.com) [坏](javascript:alert(1))

| 名称 | 值 |
| --- | --- |
| 甲 | 1 |

![图](assets/a.png)

` + "```go\nvar x = 1\n```"
	fragment, failure := r.ClipboardFragment(context.Background(), []byte(source), true, true)
	if failure != nil {
		t.Fatalf("ClipboardFragment failure = %+v", failure)
	}
	if !strings.Contains(fragment.HTML, "<p><strong>标题</strong></p>") {
		t.Fatalf("heading was not simplified: %q", fragment.HTML)
	}
	for _, unwanted := range []string{"<h2", "<table", "<td", "<img", "javascript:", "<pre"} {
		if strings.Contains(fragment.HTML, unwanted) {
			t.Fatalf("simple HTML kept %q: %q", unwanted, fragment.HTML)
		}
	}
	for _, want := range []string{"<p>", "<strong>", "<em>", "<code>", `<a href="https://example.com">`} {
		if !strings.Contains(fragment.HTML, want) && want != "<em>" {
			t.Fatalf("simple HTML = %q, missing %q", fragment.HTML, want)
		}
	}
	if strings.Count(fragment.HTML, "<a ") != 1 {
		t.Fatalf("simple HTML kept an anchor without a safe href: %q", fragment.HTML)
	}
	if strings.Contains(fragment.Text, "名称") {
		t.Fatalf("simple text kept table content: %q", fragment.Text)
	}
	if !strings.Contains(fragment.Text, "var x = 1") {
		t.Fatalf("simple text lost code: %q", fragment.Text)
	}
}
