package service

// The read-only proof of PRD §8.4 and AC-21: the whole pipeline — scanning a
// folder, opening documents, rendering, serving their images, and opening
// them again — must leave every byte of the workspace where it was and add
// nothing to it. The workspace is a temporary copy, so the test proves the
// code path rather than the app's handling of the user's own files.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/scan"
)

// snapshot hashes every file under root, keyed by its slash path.
func snapshot(t *testing.T, root string) map[string][32]byte {
	t.Helper()
	files := make(map[string][32]byte)
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = sha256.Sum256(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func writeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	// A PNG the resource protocol will accept: a real 2×2 image.
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{B: 255, A: 255})
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, img); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "img.png"), pngBytes.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	writeSample(t, root, "a.md", []byte(strings.Join([]string{
		"# A",
		"",
		"![图](img.png)",
		"",
		"公式 $x^2$ 与图表：",
		"",
		"```mermaid",
		"flowchart TD",
		"  A --> B",
		"```",
		"",
		"[外链](https://example.com)",
		"",
	}, "\n")))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeSample(t, root, "sub/b.md", []byte("# B\n\n正文\n"))
	return root
}

func TestReadOnlyWorkspace(t *testing.T) {
	root := writeWorkspace(t)
	before := snapshot(t, root)

	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)

	// Requests open in place, the way a file association does, which keeps
	// this test on one window and one code path.
	open := func(rel string) string {
		t.Helper()
		request, err := w.Push(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("queue %s: %v", rel, err)
		}
		result, err := s.OpenRequested(context.Background(), request.Seq)
		if err != nil {
			t.Fatalf("open %s: %v", rel, err)
		}
		if result.Failure != nil || result.Doc == nil {
			t.Fatalf("open %s = %+v", rel, result)
		}
		return result.Doc.HTML
	}

	// 1. Opening a document with an image, a formula, a diagram and a link.
	html := open("a.md")
	if !strings.Contains(html, "http://mtres.localhost/") {
		t.Fatalf("no resource token in the page:\n%s", html)
	}

	// 2. Its image is served from the registered token, byte for byte.
	onDisk, err := os.ReadFile(filepath.Join(root, "img.png"))
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range tokensOf(html) {
		rec := httptest.NewRecorder()
		s.resources.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+token, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("serving %s: %d %s", token, rec.Code, rec.Body.String())
		}
		if !bytes.Equal(rec.Body.Bytes(), onDisk) {
			t.Fatal("the served image differs from the file")
		}
	}

	// 3. Scanning the folder.
	if _, err := scan.Scan(context.Background(), root, scan.Options{}); err != nil {
		t.Fatalf("scan: %v", err)
	}

	// 4. Refreshing: open another document and come back.
	open("sub/b.md")
	open("a.md")

	// 5. Nothing moved, nothing was added, nothing changed.
	after := snapshot(t, root)
	if len(after) != len(before) {
		t.Fatalf("the workspace gained or lost files: %d -> %d", len(before), len(after))
	}
	for name, sum := range before {
		if got, ok := after[name]; !ok {
			t.Errorf("%s disappeared", name)
		} else if got != sum {
			t.Errorf("%s changed", name)
		}
	}
}

// tokensOf pulls the resource tokens out of rendered HTML.
func tokensOf(html string) []string {
	const prefix = "http://mtres.localhost/"
	var tokens []string
	for rest := html; ; {
		at := strings.Index(rest, prefix)
		if at < 0 {
			return tokens
		}
		rest = rest[at+len(prefix):]
		end := strings.IndexAny(rest, `"' <`)
		if end <= 0 {
			continue
		}
		tokens = append(tokens, rest[:end])
	}
}

func TestTokensOf(t *testing.T) {
	html := fmt.Sprintf(`<img src="http://mtres.localhost/abc"><img src='http://mtres.localhost/def'>`)
	got := tokensOf(html)
	if len(got) != 2 || got[0] != "abc" || got[1] != "def" {
		t.Fatalf("tokens = %v", got)
	}
}
