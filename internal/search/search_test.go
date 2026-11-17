package search

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSearchMatchesNamesAndContentCaseInsensitively(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Alpha.md", "# 一\nNeedle here\n")
	writeFile(t, dir, "中文.md", "包含针的内容\n")
	writeFile(t, dir, "other.txt", "needle")

	result, err := Search(context.Background(), dir, "alpha", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 1 || !result.Matches[0].IsName || result.Matches[0].Path != "Alpha.md" {
		t.Fatalf("name matches = %+v", result.Matches)
	}

	result, err = Search(context.Background(), dir, "NEEDLE", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 1 || result.Matches[0].Line != 2 || result.Matches[0].Text != "Needle here" {
		t.Fatalf("content matches = %+v", result.Matches)
	}

	result, err = Search(context.Background(), dir, "针", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 1 || result.Matches[0].Path != "中文.md" {
		t.Fatalf("Chinese matches = %+v", result.Matches)
	}
}

func TestSearchStopsAtTheMatchLimit(t *testing.T) {
	dir := t.TempDir()
	var lines []string
	for i := 0; i < 20; i++ {
		lines = append(lines, "needle")
	}
	writeFile(t, dir, "a.md", strings.Join(lines, "\n"))
	result, err := Search(context.Background(), dir, "needle", Options{MaxMatches: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 5 || !result.Truncated {
		t.Fatalf("result = %+v", result)
	}
}

func TestSearchHonoursCancellation(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.md", "needle\n")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Search(ctx, dir, "needle", Options{}); err == nil {
		t.Fatal("a cancelled search returned no error")
	}
}

func TestSearchEmitsPerFileAndStopsWhenTheChannelCloses(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.md", "needle\n")
	writeFile(t, dir, "b.md", "needle\n")
	seen := 0
	_, err := Run(context.Background(), dir, "needle", Options{}, func(matches []Match) error {
		seen++
		if seen == 1 {
			return nil
		}
		return os.ErrClosed
	})
	if err == nil {
		t.Fatal("a closed channel did not stop the search")
	}
	if seen != 2 {
		t.Fatalf("emitted %d files", seen)
	}
}
