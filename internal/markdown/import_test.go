package markdown

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestImportHTMLConvertsReadableStructure(t *testing.T) {
	src := []byte(`<html><body>
<h1>标题</h1><p>第一段 <strong>粗体</strong> 与 <em>斜体</em>。</p>
<ul><li>甲</li><li>乙</li></ul>
<blockquote><p>引用</p></blockquote>
<pre><code class="language-go">func main() {}</code></pre>
<table><tr><th>名称</th><th>值</th></tr><tr><td>a</td><td>1</td></tr></table>
<p><a href="https://example.com">链接</a> <img src="https://example.com/a.png" alt="图"></p>
</body></html>`)
	got, err := ImportHTML(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# 标题", "**粗体**", "*斜体*", "- 甲", "> 引用", "```go", "| 名称 | 值 |", "[链接](https://example.com)", "![图](https://example.com/a.png)"} {
		if !strings.Contains(got.Text, want) {
			t.Fatalf("import lacks %q:\n%s", want, got.Text)
		}
	}
}

func TestImportHTMLDropsExecutableAndLocalImages(t *testing.T) {
	src := []byte(`<script>alert(1)</script><p onclick="alert(1)">正文<img src="file:///C:/a.png" alt="本地图"></p>`)
	got, err := ImportHTML(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got.Text, "alert(1)") || strings.Contains(got.Text, "file:") || strings.Contains(got.Text, "![](") {
		t.Fatalf("dangerous content survived:\n%s", got.Text)
	}
	if !strings.Contains(got.Text, "本地图") {
		t.Fatalf("image alt text missing:\n%s", got.Text)
	}
	if len(got.Warnings) == 0 {
		t.Fatal("expected format-loss warnings")
	}
}

func TestImportDOCXConvertsParagraphsListsAndTables(t *testing.T) {
	data := makeDOCX(t, map[string]string{
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:t>普通</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>项目</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>值</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`,
		"word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
	})
	got, err := ImportDOCX(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# 标题", "**粗体**普通", "- 项目", "| 名称 | 值 |", "| a | 1 |"} {
		if !strings.Contains(got.Text, want) {
			t.Fatalf("import lacks %q:\n%s", want, got.Text)
		}
	}
}

func TestImportDOCXRejectsUnsafeZipEntries(t *testing.T) {
	data := makeDOCX(t, map[string]string{
		"../escape.xml": "x",
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:body></w:document>`,
	})
	if _, err := ImportDOCX(context.Background(), data); err == nil {
		t.Fatal("an unsafe zip entry was accepted")
	}
}

func TestImportDOCXIgnoresMacrosAndExternalParts(t *testing.T) {
	data := makeDOCX(t, map[string]string{
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>`,
		"word/vbaProject.bin": "macro",
		"word/header1.xml":    `<w:hdr><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>`,
	})
	got, err := ImportDOCX(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got.Text, "macro") || strings.Contains(got.Text, "页眉") {
		t.Fatalf("macro or header leaked into the buffer:\n%s", got.Text)
	}
	if !strings.Contains(got.Text, "正文") {
		t.Fatalf("body missing:\n%s", got.Text)
	}
}

func makeDOCX(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
