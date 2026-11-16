package resource

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writePNG(t *testing.T, dir, name string) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func get(t *testing.T, store *Store, token string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/"+token, nil)
	store.ServeHTTP(rec, req)
	return rec
}

func TestServesRegisteredPNG(t *testing.T) {
	store := New()
	path := writePNG(t, t.TempDir(), "a.png")
	token := store.Add(1, path)
	rec := get(t, store, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content type = %q, want image/png", ct)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty body")
	}
}

func TestServesJPEGAndGIF(t *testing.T) {
	dir := t.TempDir()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	var jpegBuf bytes.Buffer
	if err := jpeg.Encode(&jpegBuf, img, nil); err != nil {
		t.Fatal(err)
	}
	jpegPath := filepath.Join(dir, "a.jpg")
	if err := os.WriteFile(jpegPath, jpegBuf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	var gifBuf bytes.Buffer
	if err := gif.Encode(&gifBuf, img, nil); err != nil {
		t.Fatal(err)
	}
	gifPath := filepath.Join(dir, "a.gif")
	if err := os.WriteFile(gifPath, gifBuf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	store := New()
	for path, want := range map[string]string{jpegPath: "image/jpeg", gifPath: "image/gif"} {
		rec := get(t, store, store.Add(1, path))
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != want {
			t.Fatalf("%s: status %d type %q, want 200 %s", path, rec.Code, rec.Header().Get("Content-Type"), want)
		}
	}
}

func TestRefusesUnknownToken(t *testing.T) {
	store := New()
	if rec := get(t, store, "0123456789abcdef0123456789abcdef"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRefusesTokenThatLooksLikeAPath(t *testing.T) {
	store := New()
	for _, token := range []string{"..", "../a.png", "a/b.png"} {
		if rec := get(t, store, token); rec.Code != http.StatusNotFound {
			t.Errorf("token %q: status = %d, want 404", token, rec.Code)
		}
	}
}

func TestRefusesNonImageBytes(t *testing.T) {
	dir := t.TempDir()
	// An SVG named as a PNG: the extension must not decide.
	path := filepath.Join(dir, "evil.png")
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if err := os.WriteFile(path, svg, 0o644); err != nil {
		t.Fatal(err)
	}
	store := New()
	rec := get(t, store, store.Add(1, path))
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", rec.Code)
	}
}

func TestRefusesHugeFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(MaxBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	store := New()
	if rec := get(t, store, store.Add(1, path)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
}

func TestRefusesTooManyPixels(t *testing.T) {
	// A PNG header claiming 100000 × 100000 pixels, without the data.
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], 100000)
	binary.BigEndian.PutUint32(ihdr[4:8], 100000)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // colour type
	buf.Write(crcChunk("IHDR", ihdr))
	dir := t.TempDir()
	path := filepath.Join(dir, "huge.png")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	store := New()
	rec := get(t, store, store.Add(1, path))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (%s)", rec.Code, rec.Body.String())
	}
}

// crcChunk builds one PNG chunk with its length, type, data and CRC.
func crcChunk(kind string, data []byte) []byte {
	out := make([]byte, 0, len(data)+12)
	out = binary.BigEndian.AppendUint32(out, uint32(len(data)))
	out = append(out, kind...)
	out = append(out, data...)
	crc := crc32.ChecksumIEEE(append([]byte(kind), data...))
	return binary.BigEndian.AppendUint32(out, crc)
}

func TestSniff(t *testing.T) {
	cases := map[string]string{
		"\x89PNG\r\n\x1a\n": "image/png",
		"\xff\xd8\xff\xe0":  "image/jpeg",
		"GIF89a":            "image/gif",
		"RIFF....WEBPVP8 ":  "image/webp",
	}
	for head, want := range cases {
		got, ok := sniff([]byte(head))
		if !ok || got != want {
			t.Errorf("sniff(%q) = %q, %v; want %q", head, got, ok, want)
		}
	}
	for _, head := range []string{"<svg", "", "GIF", "RIFF____NOPE"} {
		if _, ok := sniff([]byte(head)); ok {
			t.Errorf("sniff(%q) accepted a non-image", head)
		}
	}
}

func TestForgetWindowDropsItsTokens(t *testing.T) {
	store := New()
	path := writePNG(t, t.TempDir(), "a.png")
	token := store.Add(7, path)
	store.ForgetWindow(7)
	if rec := get(t, store, token); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d after ForgetWindow, want 404", rec.Code)
	}
}
