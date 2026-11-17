package service

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/resource"
)

func writeClipboardFixture(t *testing.T, dir, name string, encode func(*bytes.Buffer, image.Image) error) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for x := 0; x < 3; x++ {
		for y := 0; y < 2; y++ {
			img.Set(x, y, color.RGBA{R: uint8(20 * x), G: uint8(40 * y), B: 90, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestClipboardCopyImageEncodesPNGFromEditorAndRenderedToken(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	jpegPath := writeClipboardFixture(t, dir, "图.jpg", func(buf *bytes.Buffer, img image.Image) error {
		return jpeg.Encode(buf, img, &jpeg.Options{Quality: 90})
	})
	h := newRefreshHarness(t, 200)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	var copied []byte
	h.service.clipboardWritePNG = func(data []byte) error {
		copied = append([]byte(nil), data...)
		return nil
	}

	result, err := h.service.ClipboardCopyImage(context.Background(), "图.jpg")
	if err != nil || result.Failure != nil {
		t.Fatalf("ClipboardCopyImage = %+v, %v", result, err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(copied))
	if err != nil || format != "png" || config.Width != 3 || config.Height != 2 {
		t.Fatalf("clipboard image = %dx%d %s, %v", config.Width, config.Height, format, err)
	}

	// A rendered image is copied through the token its window registered.
	token := h.service.resources.AddKind(h.window.ID(), resource.KindRead, jpegPath)
	copied = nil
	result, err = h.service.ClipboardCopyImage(context.Background(), resourceURL(token))
	if err != nil || result.Failure != nil {
		t.Fatalf("ClipboardCopyImage token = %+v, %v", result, err)
	}
	if len(copied) == 0 {
		t.Fatal("token image produced no clipboard bytes")
	}

	// A remote reference never loads through the copy command.
	result, _ = h.service.ClipboardCopyImage(context.Background(), "https://example.com/图.jpg")
	if result.Failure == nil || result.Failure.Code != "out_of_scope" {
		t.Fatalf("remote result = %+v", result)
	}
}

func TestClipboardReadImageCopiesPastedPNGIntoAssets(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 201)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	pngBytes := tinyPNG(t)
	h.service.clipboardReadImage = func() []byte { return pngBytes }

	picked, err := h.service.ClipboardReadImage(context.Background())
	if err != nil || picked.Failure != nil {
		t.Fatalf("ClipboardReadImage = %+v, %v", picked, err)
	}
	if picked.Token == "" || !strings.HasSuffix(filepath.ToSlash(picked.Target), "assets/粘贴图片.png") {
		t.Fatalf("picked = %+v", picked)
	}
	if _, err := os.Stat(picked.Target); !os.IsNotExist(err) {
		t.Fatal("reading the clipboard wrote before confirmation")
	}
	copied, err := h.service.CopyImage(context.Background(), picked.Token)
	if err != nil || copied.Failure != nil {
		t.Fatalf("CopyImage = %+v, %v", copied, err)
	}
	data, err := os.ReadFile(copied.Path)
	if err != nil {
		t.Fatal(err)
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(data)); err != nil || format != "png" {
		t.Fatalf("written image = %s, %v", format, err)
	}
	if !bytes.Equal(data, pngBytes) {
		t.Fatal("an already-PNG clipboard image was re-encoded instead of written as-is")
	}

	h.service.clipboardReadImage = func() []byte { return nil }
	empty, _ := h.service.ClipboardReadImage(context.Background())
	if empty.Failure == nil || empty.Failure.Code != "no_image" {
		t.Fatalf("empty clipboard = %+v", empty)
	}
}

func TestClipboardCopyPlainTextAndHTMLUseTheSanitizedFragments(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 202)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	var writtenText string
	h.service.clipboardWriteText = func(text string) error {
		writtenText = text
		return nil
	}
	result, err := h.service.ClipboardCopyPlainText(context.Background(), "# 标题\n\n正文 **粗体**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |")
	if err != nil || result.Failure != nil {
		t.Fatalf("ClipboardCopyPlainText = %+v, %v", result, err)
	}
	if !strings.Contains(writtenText, "标题") || !strings.Contains(writtenText, "正文 粗体") || !strings.Contains(writtenText, "A\tB") {
		t.Fatalf("plain text = %q", writtenText)
	}

	var writtenHTML, fallback string
	h.service.clipboardWriteHTML = func(markup, text string) error {
		writtenHTML, fallback = markup, text
		return nil
	}
	result, err = h.service.ClipboardCopyHTML(context.Background(), "# 标题\n\n<script>alert(1)</script>正文", true, false)
	if err != nil || result.Failure != nil {
		t.Fatalf("ClipboardCopyHTML = %+v, %v", result, err)
	}
	if !strings.Contains(writtenHTML, "<h1>标题</h1>") || strings.Contains(writtenHTML, "<script") {
		t.Fatalf("html = %q", writtenHTML)
	}
	if !strings.Contains(fallback, "标题") || !strings.Contains(fallback, "正文") {
		t.Fatalf("fallback = %q", fallback)
	}

	result, _ = h.service.ClipboardCopyHTML(context.Background(), "## 标题\n\n| A | B |", true, true)
	if result.Failure != nil {
		t.Fatalf("simplified result = %+v", result)
	}
	if !strings.Contains(writtenHTML, "<p><strong>标题</strong></p>") || strings.Contains(writtenHTML, "<table") {
		t.Fatalf("simplified html = %q", writtenHTML)
	}

	empty, _ := h.service.ClipboardCopyPlainText(context.Background(), "   ")
	if empty.Failure == nil || empty.Failure.Code != "empty_selection" {
		t.Fatalf("empty selection = %+v", empty)
	}
}

func TestClipboardCopyImageConvertsGIFToPNG(t *testing.T) {
	dir := t.TempDir()
	doc := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	writeClipboardFixture(t, dir, "动图.gif", func(buf *bytes.Buffer, img image.Image) error {
		return gif.Encode(buf, img, nil)
	})
	h := newRefreshHarness(t, 203)
	if _, err := h.service.openPath(context.Background(), h.window, doc); err != nil {
		t.Fatal(err)
	}
	var copied []byte
	h.service.clipboardWritePNG = func(data []byte) error { copied = data; return nil }
	result, err := h.service.ClipboardCopyImage(context.Background(), "动图.gif")
	if err != nil || result.Failure != nil {
		t.Fatalf("ClipboardCopyImage gif = %+v, %v", result.Failure, err)
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(copied)); err != nil || format != "png" {
		t.Fatalf("gif was not converted to png: %s, %v", format, err)
	}
}
