package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

func newTestService(callerID int, registered bool) (*WindowService, *winctx.Registry) {
	reg := winctx.NewRegistry()
	if registered {
		reg.Add(callerID)
	}
	return &WindowService{
		caller:    func(context.Context) (int, bool) { return callerID, true },
		version:   func() string { return "0.1.0" },
		windows:   reg,
		open:      func() (int, error) { return 99, nil },
		pick:      func(context.Context) (string, error) { return "", nil },
		render:    markdown.New(),
		resources: resource.New(),
	}, reg
}

func TestReadyReturnsCallerWindow(t *testing.T) {
	s, _ := newTestService(7, true)
	got, err := s.Ready(context.Background())
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got.WindowID != 7 || got.Version != "0.1.0" {
		t.Fatalf("Ready = %+v, want window 7 version 0.1.0", got)
	}
}

func TestReadyWithoutCallerWindow(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func TestReadyForUnregisteredWindow(t *testing.T) {
	s, _ := newTestService(5, false)
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrWindowNotOpen) {
		t.Fatalf("Ready error = %v, want ErrWindowNotOpen", err)
	}
}

func TestNewWindowWindowOpensAndRegisters(t *testing.T) {
	s, reg := newTestService(1, true)
	opened := 0
	s.open = func() (int, error) {
		opened++
		id := 100 + opened
		reg.Add(id) // main registers a window as it creates it
		return id, nil
	}
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("NewWindow failure = %+v, want none", got.Failure)
	}
	if got.WindowID != 101 {
		t.Fatalf("NewWindow window = %d, want 101", got.WindowID)
	}
	if reg.Len() != 2 {
		t.Fatalf("registry has %d windows, want 2", reg.Len())
	}
}

func TestNewWindowReportsExpectedFailure(t *testing.T) {
	s, _ := newTestService(1, true)
	s.open = func() (int, error) { return 0, errors.New("no display") }
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow returned an unexpected error: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "window_failed" || got.Failure.Detail == "" {
		t.Fatalf("NewWindow = %+v, want a window_failed failure with a detail", got)
	}
}

func TestPendingReturnsQueuedRequestsInOrder(t *testing.T) {
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	for _, p := range []string{"a.md", "b.md"} {
		if _, err := w.Push(p); err != nil {
			t.Fatalf("Push(%q): %v", p, err)
		}
	}
	if _, err := s.Ready(context.Background()); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	got, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(got.Requests) != 2 || got.Requests[0].Path != "a.md" || got.Requests[1].Path != "b.md" {
		t.Fatalf("Pending requests = %+v, want a.md then b.md", got.Requests)
	}
	// Asking again, as a remounted page does, still returns them.
	again, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("second Pending: %v", err)
	}
	if len(again.Requests) != 2 {
		t.Fatalf("second Pending returned %d requests, want both again", len(again.Requests))
	}
	if err := s.Ack(context.Background(), 2); err != nil {
		t.Fatalf("Ack: %v", err)
	}
	after, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending after Ack: %v", err)
	}
	if len(after.Requests) != 0 {
		t.Fatalf("Pending after Ack = %+v, want none", after.Requests)
	}
}

func TestNewWindowRequiresCaller(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.NewWindow(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("NewWindow error = %v, want ErrNoCallerWindow", err)
	}
}

func TestNewWindowServiceOutsideCall(t *testing.T) {
	// A context that did not come from a page call has no window.
	s := NewWindowService(winctx.NewRegistry(), func() (int, error) { return 1, nil }, nil, resource.New())
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func writeSample(t *testing.T, dir, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenFileDialogReadsTheChosenFile(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 标题\n正文\n"))
	s, reg := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("failure = %+v, want none", got.Failure)
	}
	if got.Doc == nil || got.Doc.Name != "笔记.md" || !strings.HasPrefix(got.Doc.Text, "# 标题") {
		t.Fatalf("doc = %+v, want the chosen file's content", got.Doc)
	}
	if !strings.Contains(got.Doc.HTML, "<h1>标题</h1>") {
		t.Fatalf("html = %q, want the rendered heading", got.Doc.HTML)
	}
	if got.Doc.LineEnding != "LF" || got.Doc.Size != int64(len("# 标题\n正文\n")) {
		t.Fatalf("doc = %+v, want LF and the file's size", got.Doc)
	}
	w, _ := reg.Get(1)
	if open, ok := w.OpenFile(); !ok || open == "" {
		t.Fatal("the window did not record the open file")
	}
}

func TestOpenFileDialogCancelledChangesNothing(t *testing.T) {
	s, reg := newTestService(1, true)
	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Doc != nil || got.Failure != nil {
		t.Fatalf("result = %+v, want an empty result for a cancelled dialog", got)
	}
	if w, _ := reg.Get(1); w.PageReady() || func() bool { _, ok := w.OpenFile(); return ok }() {
		t.Fatal("a cancelled dialog changed the window")
	}
}

func TestOpenFileDialogRejectsOtherFileTypes(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "notes.txt", []byte("plain"))
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "unsupported_type" {
		t.Fatalf("failure = %+v, want unsupported_type", got.Failure)
	}
}

func TestOpenFileDialogReportsEncoding(t *testing.T) {
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) {
		return filepath.Join("..", "..", "testdata", "docs", "invalid-utf8.md"), nil
	}
	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "encoding" || got.Failure.Detail == "" {
		t.Fatalf("failure = %+v, want encoding with a detail", got.Failure)
	}
}

func TestOpenFileDialogReportsMissingFile(t *testing.T) {
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return filepath.Join(t.TempDir(), "gone.md"), nil }
	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "not_found" {
		t.Fatalf("failure = %+v, want not_found", got.Failure)
	}
}

func TestImageResolverScope(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "images")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if err := os.WriteFile(filepath.Join(sub, "a.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, png, 0o644); err != nil {
		t.Fatal(err)
	}

	s, _ := newTestService(1, true)
	resolve := s.imageResolver(1, dir)

	if url, reason := resolve("images/a.png"); !strings.HasPrefix(url, "http://mtres.localhost/") || reason != "" {
		t.Fatalf("inside image: %q %q, want a token URL", url, reason)
	}
	for ref, wantReason := range map[string]string{
		"https://example.com/x.png":    "远程图片未加载",
		"javascript:alert(1)":          "不支持此图片地址",
		"b.svg":                        "不支持的图片格式",
		"missing.png":                  "图片不存在",
		"../" + filepath.Base(outside): "只能显示文档目录内的图片",
		"images/../../x.png":           "只能显示文档目录内的图片",
		"":                             "图片地址为空",
	} {
		url, reason := resolve(ref)
		if url != "" || reason != wantReason {
			t.Errorf("resolve(%q) = %q, %q; want %q", ref, url, reason, wantReason)
		}
	}
}

func TestOpenFileDialogServesImagesThroughTokens(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "图.png"), []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, 0o644); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(dir, "笔记.md")
	if err := os.WriteFile(docPath, []byte("# 图\n\n![图](图.png)\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return docPath, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Failure != nil || got.Doc == nil {
		t.Fatalf("result = %+v, want a document", got)
	}
	if !strings.Contains(got.Doc.HTML, "http://mtres.localhost/") {
		t.Fatalf("html = %s, want a token URL for the image", got.Doc.HTML)
	}
	if strings.Contains(got.Doc.HTML, "图.png\"") {
		t.Fatalf("the raw image path reached the page: %s", got.Doc.HTML)
	}
}
