package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportDocumentConvertsHTMLIntoTheEmptyWindow(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "文章.html")
	body := "<h1>标题</h1><p>正文</p><script>alert(1)</script>"
	if err := os.WriteFile(source, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 61)
	h.service.pickImport = func(context.Context) (string, error) { return source, nil }

	result, err := h.service.ImportDocument(context.Background())
	if err != nil || result.Failure != nil {
		t.Fatalf("ImportDocument = %+v, %v", result, err)
	}
	if result.WindowID != h.window.ID() {
		t.Fatalf("window = %d, want the empty caller %d", result.WindowID, h.window.ID())
	}
	if !strings.Contains(result.Text, "# 标题") || !strings.Contains(result.Text, "正文") {
		t.Fatalf("text = %q", result.Text)
	}
	if strings.Contains(result.Text, "alert(1)") {
		t.Fatal("script leaked into the imported buffer")
	}
	if result.Name != "导入-文章" {
		t.Fatalf("name = %q", result.Name)
	}
	if len(result.Warnings) == 0 {
		t.Fatal("expected a warning for the dropped script")
	}
	if data, _ := os.ReadFile(source); string(data) != body {
		t.Fatal("the source file was modified")
	}
}

func TestImportDocumentCancelledChangesNothing(t *testing.T) {
	h := newRefreshHarness(t, 62)
	h.service.pickImport = func(context.Context) (string, error) { return "", nil }
	result, err := h.service.ImportDocument(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Failure == nil || result.Failure.Code != "cancelled" {
		t.Fatalf("result = %+v", result)
	}
}

func TestImportDocumentRejectsWrongExtensionsAndLargeFiles(t *testing.T) {
	dir := t.TempDir()
	other := filepath.Join(dir, "note.md")
	if err := os.WriteFile(other, []byte("# x"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 63)
	h.service.pickImport = func(context.Context) (string, error) { return other, nil }
	result, _ := h.service.ImportDocument(context.Background())
	if result.Failure == nil || result.Failure.Code != "unsupported_type" {
		t.Fatalf("wrong extension = %+v", result)
	}

	large := filepath.Join(dir, "large.html")
	f, err := os.Create(large)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(10<<20 + 1); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	h.service.pickImport = func(context.Context) (string, error) { return large, nil }
	result, _ = h.service.ImportDocument(context.Background())
	if result.Failure == nil || result.Failure.Code != "too_large" {
		t.Fatalf("large file = %+v", result)
	}
}

func TestImportDocumentHandsTextToANewWindow(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "page.html")
	if err := os.WriteFile(source, []byte("<p>正文</p>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 64)
	h.window.SetOpenFile(filepath.Join(dir, "open.md"))
	next := h.reg.Add(65)
	h.service.open = func() (int, error) { return next.ID(), nil }
	h.service.pickImport = func(context.Context) (string, error) { return source, nil }

	result, err := h.service.ImportDocument(context.Background())
	if err != nil || result.Failure != nil {
		t.Fatalf("ImportDocument = %+v, %v", result, err)
	}
	if result.WindowID != next.ID() || result.Text != "" {
		t.Fatalf("result = %+v, want a handoff to window %d", result, next.ID())
	}
	if !next.StartUntitled() {
		t.Fatal("new window was not asked to start an untitled document")
	}
	text, name := next.StartText()
	if text != "正文\n" || name != "导入-page" {
		t.Fatalf("start text = %q, name = %q", text, name)
	}
}
