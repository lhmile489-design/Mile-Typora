package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPickAndCopyImageIntoAssets(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	source := filepath.Join(dir, "图.png")
	if err := os.WriteFile(source, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 120)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	h.service.pickImage = func(context.Context) (string, error) { return source, nil }

	picked, err := h.service.PickImage(context.Background())
	if err != nil || picked.Failure != nil {
		t.Fatalf("PickImage = %+v, %v", picked, err)
	}
	if picked.Token == "" || !strings.HasSuffix(filepath.ToSlash(picked.Target), "/assets/图.png") {
		t.Fatalf("picked = %+v", picked)
	}
	if _, err := os.Stat(picked.Target); !os.IsNotExist(err) {
		t.Fatal("picking wrote the image before confirmation")
	}
	copied, err := h.service.CopyImage(context.Background(), picked.Token)
	if err != nil || copied.Failure != nil {
		t.Fatalf("CopyImage = %+v, %v", copied, err)
	}
	if copied.Markdown != "assets/%E5%9B%BE.png" {
		t.Fatalf("markdown = %q", copied.Markdown)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "assets", "图.png")); err != nil || len(data) == 0 {
		t.Fatalf("copied image = %v", err)
	}
	if second, _ := h.service.CopyImage(context.Background(), picked.Token); second.Failure == nil {
		t.Fatal("the same token was accepted twice")
	}
}

func TestImageCopyUsesASuffixAndRejectsOutsideRoot(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	source := filepath.Join(dir, "图.png")
	if err := os.WriteFile(source, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 130)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	h.service.pickImage = func(context.Context) (string, error) { return source, nil }
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "图.png"), tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	picked, err := h.service.PickImage(context.Background())
	if err != nil || picked.Failure != nil {
		t.Fatalf("PickImage = %+v, %v", picked, err)
	}
	if !strings.HasSuffix(filepath.ToSlash(picked.Target), "assets/图-1.png") {
		t.Fatalf("target = %q", picked.Target)
	}

	// A document outside the window root cannot write into that root.
	other := t.TempDir()
	h.window.SetRoot(other)
	h.window.SetOpenFile(doc)
	result, _ := h.service.PickImage(context.Background())
	if result.Failure == nil || result.Failure.Code != "out_of_scope" {
		t.Fatalf("outside-root result = %+v", result)
	}
}

func TestImageCopyRechecksTheTargetAndRoot(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	source := filepath.Join(dir, "图.png")
	if err := os.WriteFile(source, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 150)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	h.service.pickImage = func(context.Context) (string, error) { return source, nil }
	picked, err := h.service.PickImage(context.Background())
	if err != nil || picked.Failure != nil {
		t.Fatalf("PickImage = %+v, %v", picked, err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	keep := []byte("not an image, but already here")
	if err := os.WriteFile(picked.Target, keep, 0o644); err != nil {
		t.Fatal(err)
	}
	if result, _ := h.service.CopyImage(context.Background(), picked.Token); result.Failure == nil {
		t.Fatal("CopyImage overwrote a target created after picking")
	}
	if data, err := os.ReadFile(picked.Target); err != nil || string(data) != string(keep) {
		t.Fatalf("target changed: %q, %v", data, err)
	}

	// The workspace changed after picking; the document is no longer inside it.
	picked, _ = h.service.PickImage(context.Background())
	if picked.Failure != nil {
		t.Fatalf("second PickImage = %+v", picked)
	}
	h.window.SetRoot(t.TempDir())
	if result, _ := h.service.CopyImage(context.Background(), picked.Token); result.Failure == nil || result.Failure.Code != "out_of_scope" {
		t.Fatalf("CopyImage after root change = %+v", result)
	}
}

func TestPendingImageIsDroppedWhenTheDocumentChanges(t *testing.T) {
	dir := t.TempDir()
	docA := writeSample(t, dir, "a.md", []byte("# 一\n"))
	docB := writeSample(t, dir, "b.md", []byte("# 二\n"))
	source := filepath.Join(dir, "图.png")
	if err := os.WriteFile(source, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 145)
	if _, err := h.service.openPath(context.Background(), h.window, docA); err != nil {
		t.Fatal(err)
	}
	h.service.pickImage = func(context.Context) (string, error) { return source, nil }
	picked, err := h.service.PickImage(context.Background())
	if err != nil || picked.Failure != nil {
		t.Fatalf("PickImage = %+v, %v", picked, err)
	}
	// Another window or instance opens a different document while the
	// confirmation is open; the pending target belongs to the old document.
	h.window.SetOpenFile(docB)
	if result, _ := h.service.CopyImage(context.Background(), picked.Token); result.Failure == nil {
		t.Fatal("a pending image survived the document switch")
	}
	if _, err := os.Stat(filepath.Join(dir, "assets")); !os.IsNotExist(err) {
		t.Fatal("the dropped pick wrote the old document's assets")
	}
}

func TestImageCancelLeavesNoTarget(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	source := filepath.Join(dir, "图.png")
	if err := os.WriteFile(source, tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 140)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	h.service.pickImage = func(context.Context) (string, error) { return source, nil }
	picked, _ := h.service.PickImage(context.Background())
	if err := h.service.CancelImage(context.Background(), picked.Token); err != nil {
		t.Fatal(err)
	}
	if result, _ := h.service.CopyImage(context.Background(), picked.Token); result.Failure == nil {
		t.Fatal("a cancelled image was still copied")
	}
	if _, err := os.Stat(filepath.Join(dir, "assets")); !os.IsNotExist(err) {
		t.Fatal("cancel created the assets directory")
	}
}
