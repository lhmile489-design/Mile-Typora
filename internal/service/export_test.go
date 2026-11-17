package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/resource"
)

type fakePrintRunner struct {
	pdf      []byte
	calls    int
	printed  int
	lastHTML string
}

func (f *fakePrintRunner) PDF(_ context.Context, html string) ([]byte, error) {
	f.calls++
	f.lastHTML = html
	return f.pdf, nil
}

func (f *fakePrintRunner) Print(_ context.Context, html string) error {
	f.printed++
	f.lastHTML = html
	return nil
}

func TestExportHTMLEmbedsImagesAndWarns(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	imagePath := filepath.Join(dir, "图.png")
	if err := os.WriteFile(imagePath, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 210)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	token := h.service.resources.AddKind(h.window.ID(), resource.KindRead, imagePath)
	target := filepath.Join(dir, "导出.html")
	h.service.exportPick = func(context.Context, string, string, []string) (string, error) {
		return target, nil
	}
	body := `<h1 id="标题">标题</h1><p>正文<script>alert(1)</script></p>` +
		`<p><img src="` + resourceURL(token) + `" alt="图"><img src="https://example.com/a.png" alt="远程"></p>`
	result, err := h.service.ExportHTML(context.Background(), body, "笔记")
	if err != nil || result.Failure != nil {
		t.Fatalf("ExportHTML = %+v, %v", result, err)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	html := string(data)
	for _, want := range []string{"<!doctype html>", `<html lang="zh-CN">`, "<title>笔记</title>",
		`data:image/png;base64,`, "远程图片未嵌入", "break-after: avoid-page"} {
		if !strings.Contains(html, want) {
			t.Fatalf("export missing %q", want)
		}
	}
	for _, unwanted := range []string{"<script", "alert(1)", "http://mtres.localhost"} {
		if strings.Contains(html, unwanted) {
			t.Fatalf("export kept %q", unwanted)
		}
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("warnings = %+v", result.Warnings)
	}
}

func TestExportPDFUsesThePrintRunnerAndWritesBytes(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 211)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "导出.pdf")
	h.service.exportPick = func(context.Context, string, string, []string) (string, error) {
		return target, nil
	}
	runner := &fakePrintRunner{pdf: []byte("%PDF-1.4 fake")}
	h.service.printRunner = runner
	result, err := h.service.ExportPDF(context.Background(), "<p>正文</p>", "笔记")
	if err != nil || result.Failure != nil {
		t.Fatalf("ExportPDF = %+v, %v", result, err)
	}
	if runner.calls != 1 || !strings.Contains(runner.lastHTML, "<p>正文</p>") {
		t.Fatalf("runner = %+v", runner)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "%PDF-1.4 fake" {
		t.Fatalf("pdf = %q, %v", data, err)
	}
}

func TestExportCancelledAndWrongExtensionWriteNothing(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 212)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	h.service.exportPick = func(context.Context, string, string, []string) (string, error) {
		return "", nil
	}
	result, _ := h.service.ExportHTML(context.Background(), "<p>x</p>", "笔记")
	if result.Failure == nil || result.Failure.Code != "cancelled" {
		t.Fatalf("cancelled = %+v", result)
	}
	h.service.exportPick = func(context.Context, string, string, []string) (string, error) {
		return filepath.Join(dir, "wrong.md"), nil
	}
	result, _ = h.service.ExportHTML(context.Background(), "<p>x</p>", "笔记")
	if result.Failure == nil || result.Failure.Code != "unsupported_type" {
		t.Fatalf("wrong extension = %+v", result)
	}
	if _, err := os.Stat(filepath.Join(dir, "wrong.md")); !os.IsNotExist(err) {
		t.Fatal("wrong extension created a file")
	}
}

func TestPrintDocumentUsesTheDedicatedView(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 213)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	runner := &fakePrintRunner{}
	h.service.printRunner = runner
	result, err := h.service.PrintDocument(context.Background(), "<h1>标题</h1>", "笔记")
	if err != nil || result.Failure != nil {
		t.Fatalf("PrintDocument = %+v, %v", result, err)
	}
	if runner.printed != 1 || !strings.Contains(runner.lastHTML, "<h1>标题</h1>") {
		t.Fatalf("runner = %+v", runner)
	}
}
