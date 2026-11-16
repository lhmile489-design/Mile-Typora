package scan

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func paths(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Path
	}
	return out
}

func TestScanSampleTree(t *testing.T) {
	res, err := Scan(context.Background(), "../../testdata/tree", Options{})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	want := []string{
		".hidden",
		".hidden/.secret.md",
		"a.md",
		"b.MD",
		"other",
		"other/x.md",
		"sub",
		"sub/c.md",
		"sub/x.md",
		"第2章.md",
		"第10章.md",
	}
	if got := paths(res.Entries); !reflect.DeepEqual(got, want) {
		t.Fatalf("entries = %v\nwant %v", got, want)
	}
	if res.Truncated {
		t.Fatalf("Truncated = true on a small tree (bound %q)", res.Bound)
	}
	// The folder without Markdown is not shown, and neither is the .txt.
	for _, e := range res.Entries {
		if e.Path == "empty" || e.Path == "notes.txt" {
			t.Errorf("unexpected entry %q", e.Path)
		}
	}
}

func TestScanSkipsJunctions(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("junctions are a Windows feature")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("# a"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("# s"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", filepath.Join(root, "link"), outside).CombinedOutput(); err != nil {
		t.Skipf("cannot create a junction here: %v: %s", err, out)
	}

	res, err := Scan(context.Background(), root, Options{})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if got := paths(res.Entries); !reflect.DeepEqual(got, []string{"a.md"}) {
		t.Fatalf("entries = %v, want only a.md", got)
	}
	if res.Skipped == 0 {
		t.Fatal("Skipped = 0, want the junction counted")
	}
}

func TestScanDepthBound(t *testing.T) {
	root := t.TempDir()
	deep := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, "x.md"), []byte("# x"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Scan(context.Background(), root, Options{MaxDepth: 2})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if !res.Truncated || res.Bound != "depth" {
		t.Fatalf("result = %+v, want truncation by depth", res)
	}
	if len(res.Entries) != 0 {
		t.Fatalf("entries = %v, want nothing below the bound", paths(res.Entries))
	}
}

func TestScanMarkdownBound(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("# x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	res, err := Scan(context.Background(), root, Options{MaxMarkdown: 2})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if !res.Truncated || res.Bound != "markdown" {
		t.Fatalf("result = %+v, want truncation by markdown count", res)
	}
	if got := len(res.Entries); got != 2 {
		t.Fatalf("entries = %d, want 2", got)
	}
}

func TestScanEntriesBound(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("# x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	res, err := Scan(context.Background(), root, Options{MaxEntries: 2})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if !res.Truncated || res.Bound != "entries" {
		t.Fatalf("result = %+v, want truncation by entry count", res)
	}
}

func TestScanCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Scan(ctx, "../../testdata/tree", Options{}); err == nil {
		t.Fatal("Scan returned no error after cancellation")
	}
}

func TestScanRejectsAFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.md")
	if err := os.WriteFile(path, []byte("# a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Scan(context.Background(), path, Options{}); err != ErrNotDirectory {
		t.Fatalf("err = %v, want ErrNotDirectory", err)
	}
}

func TestNaturalLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"第2章.md", "第10章.md", true},
		{"第10章.md", "第2章.md", false},
		{"a.md", "b.md", true},
		{"a2.md", "a10.md", true},
		{"a.md", "a.md", false},
		{"A.md", "a.md", true},
	}
	for _, c := range cases {
		if got := naturalLess(c.a, c.b); got != c.want {
			t.Errorf("naturalLess(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
