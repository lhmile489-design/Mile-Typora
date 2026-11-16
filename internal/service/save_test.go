package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveDocumentWritesAndUpdatesTheBaseline(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# old\n"))
	h := newRefreshHarness(t, 50)
	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath: %+v", got.Failure)
	}

	saved, err := h.service.SaveDocument(context.Background(), "# new\n", false)
	if err != nil || saved.Failure != nil {
		t.Fatalf("SaveDocument = %+v, %v", saved, err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "# new\n" {
		t.Fatalf("content = %q", data)
	}
	dirty, base, _, _ := h.window.EditState()
	if dirty || base != saved.Hash {
		t.Fatalf("edit state = dirty %v hash %q, want clean with %q", dirty, base, saved.Hash)
	}
}

func TestSaveDocumentRefusesToOverwriteAnExternalChange(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# old\n"))
	h := newRefreshHarness(t, 51)
	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath: %+v", got.Failure)
	}
	if err := os.WriteFile(path, []byte("# other window\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	blocked, err := h.service.SaveDocument(context.Background(), "# mine\n", false)
	if err != nil {
		t.Fatalf("SaveDocument: %v", err)
	}
	if blocked.Failure == nil || blocked.Failure.Code != "conflict" {
		t.Fatalf("failure = %+v, want conflict", blocked.Failure)
	}
	if data, _ := os.ReadFile(path); string(data) != "# other window\n" {
		t.Fatalf("the conflicting file was overwritten: %q", data)
	}

	forced, err := h.service.SaveDocument(context.Background(), "# mine\n", true)
	if err != nil || forced.Failure != nil {
		t.Fatalf("forced save = %+v, %v", forced, err)
	}
	if data, _ := os.ReadFile(path); string(data) != "# mine\n" {
		t.Fatalf("forced save content = %q", data)
	}
}

func TestSaveKeepsBOMAndLineEndings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte("\xef\xbb\xbf# 一\r\n\r\n正文\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 52)
	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath: %+v", got.Failure)
	}

	if saved, _ := h.service.SaveDocument(context.Background(), "# 二\n\n新正文\n", false); saved.Failure != nil {
		t.Fatalf("save: %+v", saved.Failure)
	}
	data, _ := os.ReadFile(path)
	want := "\xef\xbb\xbf# 二\r\n\r\n新正文\r\n"
	if string(data) != want {
		t.Fatalf("content = %q, want %q", data, want)
	}
}

func TestSaveDocumentAsUsesTheChosenPath(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# old\n"))
	h := newRefreshHarness(t, 53)
	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath: %+v", got.Failure)
	}
	target := filepath.Join(t.TempDir(), "copy")
	h.service.savePick = func(context.Context, string) (string, error) { return target, nil }

	saved, err := h.service.SaveDocumentAs(context.Background(), "# copy\n")
	if err != nil || saved.Failure != nil {
		t.Fatalf("SaveDocumentAs = %+v, %v", saved, err)
	}
	if !strings.HasSuffix(saved.Path, "copy.md") {
		t.Fatalf("path = %q, want the .md extension added", saved.Path)
	}
	if data, _ := os.ReadFile(saved.Path); string(data) != "# copy\n" {
		t.Fatalf("saved content = %q", data)
	}
	if open, ok := h.window.OpenFile(); !ok || open != saved.Path {
		t.Fatalf("window file = %q, want %q", open, saved.Path)
	}
	// The original is untouched.
	if data, _ := os.ReadFile(path); string(data) != "# old\n" {
		t.Fatalf("original changed: %q", data)
	}
}

func TestClosingADirtyWindowNeedsForce(t *testing.T) {
	h := newRefreshHarness(t, 54)
	h.window.SetEditState(true, "hash", false, "LF")
	if err := h.service.CloseWindow(context.Background(), false); !errors.Is(err, ErrWindowDirty) {
		t.Fatalf("close error = %v, want ErrWindowDirty", err)
	}
	if err := h.service.CloseWindow(context.Background(), true); err != nil {
		t.Fatalf("forced close: %v", err)
	}
	if !h.window.Closing() {
		t.Fatal("the window was not marked as closing")
	}
}

func TestNewDocumentReusesAnEmptyWindowAndOpensAnotherForContent(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# old\n"))
	h := newRefreshHarness(t, 55)

	if got, err := h.service.NewDocument(context.Background()); err != nil || got.WindowID != 55 {
		t.Fatalf("empty NewDocument = %+v, %v", got, err)
	}
	if !h.window.StartUntitled() {
		t.Fatal("the empty window was not asked to start an untitled document")
	}

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath: %+v", got.Failure)
	}
	h.window.ClearStartUntitled()
	next := h.reg.Add(56)
	h.service.open = func() (int, error) { return next.ID(), nil }

	got, err := h.service.NewDocument(context.Background())
	if err != nil || got.WindowID != 56 {
		t.Fatalf("non-empty NewDocument = %+v, %v", got, err)
	}
	if !next.StartUntitled() {
		t.Fatal("the new window was not asked to start an untitled document")
	}
}
