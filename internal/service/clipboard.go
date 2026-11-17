package service

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// ClipboardReadText returns the system clipboard's plain text (P1 EDIT-06).
func (s *WindowService) ClipboardReadText(ctx context.Context) (string, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return "", err
	}
	return mygo.Clipboard.ReadText(), nil
}

// ClipboardWriteText puts plain text on the system clipboard.
func (s *WindowService) ClipboardWriteText(ctx context.Context, text string) error {
	if _, err := s.callerWindow(ctx); err != nil {
		return err
	}
	mygo.Clipboard.WriteText(text)
	return nil
}

// ClipboardCopyPlainText renders a source selection and writes only readable
// text to the clipboard (M5-5 EDIT-07).
func (s *WindowService) ClipboardCopyPlainText(ctx context.Context, source string) (contract.ClipboardResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.ClipboardResult{}, err
	}
	if strings.TrimSpace(source) == "" {
		return clipboardFailure("empty_selection", "先选择要复制的内容"), nil
	}
	text, failure := s.render.PlainText(ctx, []byte(source))
	if failure != nil {
		return clipboardFailure("render_failed", failure.Detail), nil
	}
	if strings.TrimSpace(text) == "" {
		return clipboardFailure("empty_selection", "选区没有可复制的文字"), nil
	}
	writer := s.clipboardWriteText
	if writer == nil {
		writer = writeClipboardText
	}
	if err := writer(text); err != nil {
		return clipboardFailure("clipboard_failed", "无法写入系统剪贴板"), nil
	}
	return contract.ClipboardResult{}, nil
}

// ClipboardCopyHTML puts a cleaned HTML fragment and its plain-text fallback
// on the clipboard in one item (M5-5 EDIT-09/EDIT-10). FromSource parses the
// Markdown selected in the source editor; otherwise content is an HTML
// fragment selected in the reading view.
func (s *WindowService) ClipboardCopyHTML(ctx context.Context, content string, fromSource, simplified bool) (contract.ClipboardResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.ClipboardResult{}, err
	}
	if strings.TrimSpace(content) == "" {
		return clipboardFailure("empty_selection", "先选择要复制的内容"), nil
	}
	fragment, failure := s.render.ClipboardFragment(ctx, []byte(content), fromSource, simplified)
	if failure != nil {
		return clipboardFailure("render_failed", failure.Detail), nil
	}
	if strings.TrimSpace(fragment.HTML) == "" && strings.TrimSpace(fragment.Text) == "" {
		return clipboardFailure("empty_selection", "选区没有可复制的内容"), nil
	}
	writer := s.clipboardWriteHTML
	if writer == nil {
		writer = writeClipboardHTML
	}
	if err := writer(fragment.HTML, fragment.Text); err != nil {
		return clipboardFailure("clipboard_failed", "无法写入系统剪贴板"), nil
	}
	return contract.ClipboardResult{}, nil
}

// ClipboardCopyImage reads an authorized local image, converts it to PNG and
// writes it to the clipboard (M5-5 EDIT-05). Source is either a relative image
// reference from the editor or an mtres URL of a rendered image.
func (s *WindowService) ClipboardCopyImage(ctx context.Context, source string) (contract.ClipboardResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ClipboardResult{}, err
	}
	real, failure := s.clipboardImagePath(w, source)
	if failure != nil {
		return contract.ClipboardResult{Failure: failure}, nil
	}
	if reason := resource.Check(real); reason != "" {
		return contract.ClipboardResult{Failure: clipboardImageFailure(reason)}, nil
	}
	data, failure := encodeImageFile(real)
	if failure != nil {
		return contract.ClipboardResult{Failure: failure}, nil
	}
	writer := s.clipboardWritePNG
	if writer == nil {
		writer = writeClipboardPNG
	}
	if err := writer(data); err != nil {
		return clipboardFailure("clipboard_failed", "无法写入系统剪贴板"), nil
	}
	return contract.ClipboardResult{}, nil
}

// ClipboardReadImage turns a clipboard image into a pending PNG copy beside
// the document, waiting for the same confirmation as an inserted image
// (M5-5 EDIT-06).
func (s *WindowService) ClipboardReadImage(ctx context.Context) (contract.ImagePickResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ImagePickResult{}, err
	}
	reader := s.clipboardReadImage
	if reader == nil {
		reader = readClipboardImage
	}
	data := reader()
	if len(data) == 0 {
		return contract.ImagePickResult{Failure: failFile("no_image", "剪贴板中没有图片")}, nil
	}
	docReal, failure := s.imageDocument(w)
	if failure != nil {
		return contract.ImagePickResult{Failure: failure}, nil
	}
	if len(data) > resource.MaxBytes {
		return contract.ImagePickResult{Failure: failFile("too_large", "图片超过 20 MiB")}, nil
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return contract.ImagePickResult{Failure: failFile("unsupported_type", "剪贴板图片无法读取")}, nil
	}
	if int64(config.Width)*int64(config.Height) > resource.MaxPixels {
		return contract.ImagePickResult{Failure: failFile("too_large", "图片像素超过上限")}, nil
	}
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return contract.ImagePickResult{Failure: failFile("unsupported_type", "剪贴板图片无法读取")}, nil
	}
	payload := append([]byte(nil), data...)
	if format != "png" {
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, decoded); err != nil {
			return contract.ImagePickResult{Failure: failFile("image_failed", "无法转换剪贴板图片")}, nil
		}
		payload = encoded.Bytes()
	}
	if len(payload) > resource.MaxBytes {
		return contract.ImagePickResult{Failure: failFile("too_large", "转换后的 PNG 超过 20 MiB")}, nil
	}
	target, targetFailure := uniqueImageTarget(
		filepath.Join(filepath.Dir(docReal), "assets"),
		"粘贴图片.png",
		"",
	)
	if targetFailure != nil {
		return contract.ImagePickResult{Failure: targetFailure}, nil
	}
	token, tokenErr := imageToken()
	if tokenErr != nil {
		return contract.ImagePickResult{Failure: failFile("image_failed", "无法准备图片")}, nil
	}
	w.SetPendingImage(winctx.PendingImage{
		Token:  token,
		Doc:    docReal,
		Target: target,
		Data:   payload,
	})
	return contract.ImagePickResult{
		Token:  token,
		Name:   filepath.Base(target),
		Target: target,
		Size:   int64(len(payload)),
	}, nil
}

// clipboardImagePath authorizes the image a copy command names. A rendered
// image must be a token this window registered; an editor reference resolves
// against the document directory with the same checks as rendering.
func (s *WindowService) clipboardImagePath(w *winctx.Window, source string) (string, *contract.Failure) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return "", failFile("not_found", "没有可复制的图片")
	}
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Scheme != "" {
		if !strings.EqualFold(parsed.Host, resource.Scheme+".localhost") {
			return "", failFile("out_of_scope", "只能复制文档目录内的本地图片")
		}
		token := strings.TrimPrefix(parsed.Path, "/")
		if s.resources == nil {
			return "", failFile("not_found", "图片不存在")
		}
		item, ok := s.resources.Lookup(token)
		if !ok || item.Window != w.ID() {
			return "", failFile("not_found", "图片不存在")
		}
		return item.Path, nil
	}
	docReal, failure := s.imageDocument(w)
	if failure != nil {
		return "", failure
	}
	real, reason := s.resolveDocumentImage(filepath.Dir(docReal), trimmed)
	if reason != "" {
		return "", clipboardImageFailure(reason)
	}
	return real, nil
}

func encodeImageFile(path string) ([]byte, *contract.Failure) {
	file, err := os.Open(path)
	if err != nil {
		return nil, failFile("not_found", "图片不存在或不可读")
	}
	defer file.Close()
	decoded, _, err := image.Decode(file)
	if err != nil {
		return nil, failFile("unsupported_type", "图片格式无法解码")
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, decoded); err != nil {
		return nil, failFile("image_failed", "无法转换图片")
	}
	return encoded.Bytes(), nil
}

func clipboardImageFailure(reason string) *contract.Failure {
	switch {
	case strings.Contains(reason, "20 MiB"), strings.Contains(reason, "像素"):
		return failFile("too_large", reason)
	case strings.Contains(reason, "不存在"):
		return failFile("not_found", reason)
	case strings.Contains(reason, "远程"), strings.Contains(reason, "目录"), strings.Contains(reason, "范围"), strings.Contains(reason, "地址"):
		return failFile("out_of_scope", reason)
	default:
		return failFile("unsupported_type", reason)
	}
}

func clipboardFailure(code, detail string) contract.ClipboardResult {
	return contract.ClipboardResult{Failure: failFile(code, detail)}
}

func readClipboardImage() []byte {
	return mygo.Clipboard.ReadImage()
}

func writeClipboardPNG(data []byte) error {
	return mygo.Clipboard.Write(transfer.New(
		transfer.NewItem(transfer.Bytes(transfer.PNG, data)),
	))
}

func writeClipboardHTML(markup, text string) error {
	return mygo.Clipboard.Write(transfer.New(
		transfer.NewItem(
			transfer.Bytes(transfer.HTML, []byte(markup)),
			transfer.Bytes(transfer.Text, []byte(text)),
		),
	))
}

func writeClipboardText(text string) error {
	return mygo.Clipboard.Write(transfer.New(
		transfer.NewItem(transfer.Bytes(transfer.Text, []byte(text))),
	))
}
