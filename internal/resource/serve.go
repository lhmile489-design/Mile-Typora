package resource

import (
	"bytes"
	"errors"
	"image"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	// Formats the app serves; registering them teaches image.DecodeConfig.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

// Failure reasons a page shows in place of an image.
const (
	reasonUnknownToken  = "图片未登记"
	reasonNotFound      = "图片不存在"
	reasonTooLarge      = "图片超过 20 MiB"
	reasonTooManyPixels = "图片像素超过上限"
	reasonUnsupported   = "不支持的图片格式"
)

// Handler serves the registered images. Register it before the first window
// opens (CLAUDE.md §5, decisions.md D-T01):
//
//	mygo.Protocol.HandleFunc(resource.Scheme, store.ServeHTTP)
func (s *Store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The token is the whole path: no traversal, no directory parts.
	token := strings.TrimPrefix(r.URL.Path, "/")
	if token == "" || strings.ContainsAny(token, `/\`) || strings.Contains(token, "..") {
		http.Error(w, reasonUnknownToken, http.StatusNotFound)
		return
	}
	item, ok := s.Lookup(token)
	if !ok {
		http.Error(w, reasonUnknownToken, http.StatusNotFound)
		return
	}

	f, err := os.Open(item.Path)
	if err != nil {
		http.Error(w, reasonNotFound, http.StatusNotFound)
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		http.Error(w, reasonNotFound, http.StatusNotFound)
		return
	}
	if fi.Size() > MaxBytes {
		http.Error(w, reasonTooLarge, http.StatusRequestEntityTooLarge)
		return
	}

	// The file's own bytes decide the type; an extension proves nothing.
	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		http.Error(w, reasonNotFound, http.StatusNotFound)
		return
	}
	head = head[:n]
	mime, ok := sniff(head)
	if !ok {
		http.Error(w, reasonUnsupported, http.StatusUnsupportedMediaType)
		return
	}

	// Decoding the header gives the size without decoding the pixels.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(head))
	if err != nil {
		// A header split across the first 512 bytes: ask the file itself.
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			http.Error(w, reasonNotFound, http.StatusNotFound)
			return
		}
		cfg, _, err = image.DecodeConfig(f)
		if err != nil {
			http.Error(w, reasonUnsupported, http.StatusUnsupportedMediaType)
			return
		}
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > MaxPixels {
		http.Error(w, reasonTooManyPixels, http.StatusRequestEntityTooLarge)
		return
	}

	if _, err := f.Seek(0, io.SeekStart); err != nil {
		http.Error(w, reasonNotFound, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", mime)
	// A token names one version of one file; a new load registers a new one.
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, path.Base(item.Path), fi.ModTime().Truncate(time.Second), f)
}

// sniff recognises the four image formats the app accepts, by signature.
func sniff(head []byte) (string, bool) {
	switch {
	case len(head) >= 8 && bytes.Equal(head[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "image/png", true
	case len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF:
		return "image/jpeg", true
	case len(head) >= 6 && (string(head[:6]) == "GIF87a" || string(head[:6]) == "GIF89a"):
		return "image/gif", true
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return "image/webp", true
	}
	// SVG, HTML, anything else.
	return "", false
}
