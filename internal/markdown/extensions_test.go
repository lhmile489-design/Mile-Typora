package markdown

import (
	"context"
	"strings"
	"testing"
)

func renderTest(t *testing.T, source string) string {
	t.Helper()
	result, failure := New().Render(context.Background(), []byte(source), nil)
	if failure != nil {
		t.Fatalf("render failure: %+v", failure)
	}
	return result.HTML
}

func TestFootnoteRendersAndKeepsLinks(t *testing.T) {
	html := renderTest(t, "正文[^1]\n\n[^1]: 脚注内容\n")
	if !strings.Contains(html, "<sup") || !strings.Contains(html, `class="footnote-ref"`) {
		t.Fatalf("footnote reference missing: %s", html)
	}
	if !strings.Contains(html, `class="footnotes"`) || !strings.Contains(html, "脚注内容") {
		t.Fatalf("footnote list missing: %s", html)
	}
	if !strings.Contains(html, "返回") || strings.Contains(html, "↩") {
		t.Fatalf("backlink is not the text label: %s", html)
	}
	if !strings.Contains(html, `href="#fn:1"`) {
		t.Fatalf("footnote anchor missing: %s", html)
	}
}

func TestAlertsRenderOnlyKnownTypes(t *testing.T) {
	html := renderTest(t, "> [!NOTE]\n> 内容\n")
	if !strings.Contains(html, `class="alert alert-note"`) || !strings.Contains(html, `data-type="note"`) {
		t.Fatalf("alert missing: %s", html)
	}
	if strings.Contains(html, "[!NOTE]") || !strings.Contains(html, "注意") || !strings.Contains(html, "内容") {
		t.Fatalf("alert content wrong: %s", html)
	}
	unknown := renderTest(t, "> [!FOO]\n> 原文\n")
	if strings.Contains(unknown, `data-type=`) || !strings.Contains(unknown, "[!FOO]") {
		t.Fatalf("unknown alert should stay a blockquote: %s", unknown)
	}
}

func TestAlertDoesNotPassRawHTML(t *testing.T) {
	html := renderTest(t, "> [!TIP]\n> <script>alert(1)</script>\n")
	if strings.Contains(html, "<script") || !strings.Contains(html, "&lt;script") {
		t.Fatalf("raw HTML escaped incorrectly: %s", html)
	}
}

func TestTOCUsesHeadingIDs(t *testing.T) {
	html := renderTest(t, "[TOC]\n\n# 一级\n\n## 二级\n")
	if !strings.Contains(html, `<nav class="toc">`) || !strings.Contains(html, `href="#`) {
		t.Fatalf("TOC missing: %s", html)
	}
	if !strings.Contains(html, "一级") || !strings.Contains(html, "二级") {
		t.Fatalf("TOC entries missing: %s", html)
	}
}

func TestUnderlineIsTheOnlyRawInlineTag(t *testing.T) {
	html := renderTest(t, "<u>文字</u> 和 <u class=\"x\">属性</u>\n")
	if !strings.Contains(html, "<u>文字</u>") {
		t.Fatalf("underline missing: %s", html)
	}
	if strings.Contains(html, `<u class="x">`) || !strings.Contains(html, "raw-html") {
		t.Fatalf("attribute underline was not escaped: %s", html)
	}
}

func TestCompleteCommentsAreHidden(t *testing.T) {
	html := renderTest(t, "前 <!-- 隐藏 --> 后\n\n<!-- 整段 -->\n")
	if strings.Contains(html, "隐藏") || strings.Contains(html, "整段") {
		t.Fatalf("comment reached the page: %s", html)
	}
	if !strings.Contains(html, "前") || !strings.Contains(html, "后") {
		t.Fatalf("comment hid surrounding text: %s", html)
	}
}

func TestUnclosedCommentStaysVisible(t *testing.T) {
	html := renderTest(t, "<!-- 没有结束\n")
	if !strings.Contains(html, "&lt;!--") {
		t.Fatalf("unclosed comment was not escaped: %s", html)
	}
}
