package markdown

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// benchDocument is about 100 KiB of the constructs a reading document mixes:
// headings, paragraphs, lists, code fences, tables, inline and block math,
// and a few Mermaid blocks.
func benchDocument() []byte {
	var b strings.Builder
	for i := 0; i < 120; i++ {
		fmt.Fprintf(&b, "## 章节 %d\n\n", i)
		for p := 0; p < 8; p++ {
			fmt.Fprintf(&b, "这是第 %d-%d 段，包含 **粗体**、*斜体*、`代码` 与一个行内公式 $x_%d^2$。\n\n", i, p, i)
		}
		if i%3 == 0 {
			fmt.Fprintf(&b, "- 第一项 %d\n- 第二项\n- 第三项\n\n", i)
		}
		if i%10 == 0 {
			fmt.Fprintf(&b, "```go\nfunc f%d() int { return %d }\n```\n\n", i, i)
		}
		if i%20 == 0 {
			b.WriteString("| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\n")
		}
		if i%25 == 0 {
			b.WriteString("$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n$$\n\n")
		}
		if i%40 == 0 {
			b.WriteString("```mermaid\nflowchart LR\n  A --> B\n```\n\n")
		}
	}
	return []byte(b.String())
}

// BenchmarkRender measures the Go half of opening a document: parse, sanitize
// and build the HTML the page receives. Frontend math and Mermaid work is not
// part of it (docs/develop/性能基线.md).
func BenchmarkRender(b *testing.B) {
	src := benchDocument()
	renderer := New()
	images := func(string) (string, string) { return "", "" }
	b.SetBytes(int64(len(src)))
	b.Logf("benchmark document: %d bytes", len(src))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result, failure := renderer.Render(context.Background(), src, images)
		if failure != nil {
			b.Fatalf("render failed: %+v", failure)
		}
		if result.HTML == "" {
			b.Fatal("empty HTML")
		}
	}
}
