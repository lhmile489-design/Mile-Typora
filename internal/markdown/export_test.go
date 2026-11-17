package markdown

import (
	"strings"
	"testing"
)

func TestBuildExportDocumentSanitizesAndEmbedsImages(t *testing.T) {
	body := `<h1 id="标题">标题</h1>` +
		`<p onclick="alert(1)" style="color:red" class="document">正文<script>alert(1)</script></p>` +
		`<details class="fm"><summary>元信息</summary><pre>title: x</pre></details>` +
		`<p><img src="http://mtres.localhost/local" alt="本地"><img src="https://example.com/a.png" alt="远程"></p>` +
		`<p><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></p>` +
		`<div class="diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.node{fill:#fff}</style><g class="node"><rect x="0" y="0" width="10" height="10"></rect></g><foreignObject><div>bad</div></foreignObject><script>alert(1)</script></svg></div>` +
		`<div class="limited" data-kind="image" data-reason="远程图片未加载">远程</div>` +
		`<div class="alert alert-note" data-type="note"><p class="alert-title">注意</p><p>内容</p></div>`
	resolver := func(src string) (string, string) {
		if strings.Contains(src, "mtres.localhost") {
			return "data:image/png;base64,iVBORw0KGgo=", ""
		}
		return "", "远程图片未嵌入"
	}
	doc, failure := BuildExportDocument(body, `标题 <&>`, resolver)
	if failure != nil {
		t.Fatalf("BuildExportDocument = %+v", failure)
	}
	for _, want := range []string{
		`<html lang="zh-CN">`, `<title>标题 &lt;&amp;&gt;</title>`,
		`<h1 id="标题">标题</h1>`, `data:image/png;base64,iVBORw0KGgo=`,
		`class="limited" data-kind="image" data-reason="远程图片未嵌入"`,
		`<math xmlns="http://www.w3.org/1998/Math/MathML">`, `data-type="note"`,
		`break-after: avoid-page`, `<style>.node{fill:#fff}</style>`,
	} {
		if !strings.Contains(doc.HTML, want) {
			t.Fatalf("document missing %q", want)
		}
	}
	for _, unwanted := range []string{
		`onclick`, `style="color:red"`, `<script`, `foreignObject`, `<details`, `class="document"`,
	} {
		if strings.Contains(doc.HTML, unwanted) {
			t.Fatalf("document kept %q", unwanted)
		}
	}
	if len(doc.Warnings) != 1 || !strings.Contains(doc.Warnings[0], "远程") {
		t.Fatalf("warnings = %+v", doc.Warnings)
	}
}

func TestExportKeepsFunctionMagicTokensAndRejectsControlHrefs(t *testing.T) {
	body := `<pre class="chroma"><code><span class="fm">__init__</span></code></pre>` +
		`<p><a href="java&#9;script:alert(1)">坏</a></p>`
	doc, failure := BuildExportDocument(body, "x", nil)
	if failure != nil {
		t.Fatalf("BuildExportDocument = %+v", failure)
	}
	if !strings.Contains(doc.HTML, "__init__") {
		t.Fatalf("chroma fm token was dropped: %q", doc.HTML)
	}
	if strings.Contains(doc.HTML, "href=") {
		t.Fatalf("control-character href survived: %q", doc.HTML)
	}
}

func TestExportRejectsUnsafeStyleAndLinks(t *testing.T) {
	body := `<p><a href="javascript:alert(1)">坏</a><a href="https://example.com">好</a></p>` +
		`<div class="diagram"><svg><g style="background:url(https://evil)"></g>` +
		`<style>@import url(https://evil);</style></svg></div>`
	doc, failure := BuildExportDocument(body, "x", nil)
	if failure != nil {
		t.Fatalf("BuildExportDocument = %+v", failure)
	}
	if strings.Contains(doc.HTML, "javascript:") || strings.Contains(doc.HTML, "url(") || strings.Contains(doc.HTML, "@import") {
		t.Fatalf("unsafe content survived: %q", doc.HTML)
	}
	if !strings.Contains(doc.HTML, `<a href="https://example.com">好</a>`) {
		t.Fatalf("safe link was lost: %q", doc.HTML)
	}
	if strings.Contains(doc.HTML, `style="background`) {
		t.Fatalf("unsafe style attribute survived: %q", doc.HTML)
	}
}
