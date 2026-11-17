package service

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docwrite"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// ExportPicker asks where an export should be written. The title and filter
// are per format; the returned path is the user's choice.
type ExportPicker func(ctx context.Context, suggested, title string, extensions []string) (string, error)

// PrintRunner renders the dedicated print view and either returns PDF bytes
// or opens the system print preview. main supplies the native implementation.
type PrintRunner interface {
	PDF(ctx context.Context, html string) ([]byte, error)
	Print(ctx context.Context, html string) error
}

// PickExportPath is the production HTML/PDF save dialog.
func PickExportPath(ctx context.Context, suggested, title string, extensions []string) (string, error) {
	name := strings.ToUpper(strings.Join(extensions, "/"))
	return mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       title,
		DefaultPath: suggested,
		Filters: []mygo.FileFilter{
			{Name: name, Extensions: extensions},
		},
	})
}

// ExportHTML writes a standalone HTML document to the path the user chooses
// (M5-6 FILE-16). Images are embedded as data URIs under a 20 MiB budget.
func (s *WindowService) ExportHTML(ctx context.Context, bodyHTML, title string) (contract.ExportResult, error) {
	w, err := s.startExport(ctx)
	if err != nil {
		return contract.ExportResult{}, err
	}
	if w == nil {
		return contract.ExportResult{Failure: failFile("busy", "导出或打印正在进行")}, nil
	}
	defer s.exportBusy.Store(false)

	suggested := suggestedExportName(title, ".html")
	chosen, pickErr := s.pickerForExport()(ctx, suggested, "导出 HTML", []string{"html"})
	if pickErr != nil {
		return contract.ExportResult{Failure: failFile("export_failed", "无法选择导出位置")}, nil
	}
	if chosen == "" {
		return contract.ExportResult{Failure: failFile("cancelled", "已取消导出")}, nil
	}
	real, pathFailure := exportPath(chosen, ".html", "只能导出为 .html 文件")
	if pathFailure != nil {
		return contract.ExportResult{Failure: pathFailure}, nil
	}
	doc, failure := s.buildExport(w, bodyHTML, title)
	if failure != nil {
		return contract.ExportResult{Failure: failure}, nil
	}
	if err := docwrite.Write(real, []byte(doc.HTML), 0o644); err != nil {
		return contract.ExportResult{Failure: failFile("export_failed", "无法写入导出文件")}, nil
	}
	return contract.ExportResult{Path: real, Warnings: doc.Warnings}, nil
}

// ExportPDF renders the dedicated print view to PDF and writes it to the
// chosen path (M5-6 FILE-16). Generation has a 30 second budget.
func (s *WindowService) ExportPDF(ctx context.Context, bodyHTML, title string) (contract.ExportResult, error) {
	w, err := s.startExport(ctx)
	if err != nil {
		return contract.ExportResult{}, err
	}
	if w == nil {
		return contract.ExportResult{Failure: failFile("busy", "导出或打印正在进行")}, nil
	}
	defer s.exportBusy.Store(false)

	suggested := suggestedExportName(title, ".pdf")
	chosen, pickErr := s.pickerForExport()(ctx, suggested, "导出 PDF", []string{"pdf"})
	if pickErr != nil {
		return contract.ExportResult{Failure: failFile("export_failed", "无法选择导出位置")}, nil
	}
	if chosen == "" {
		return contract.ExportResult{Failure: failFile("cancelled", "已取消导出")}, nil
	}
	real, pathFailure := exportPath(chosen, ".pdf", "只能导出为 .pdf 文件")
	if pathFailure != nil {
		return contract.ExportResult{Failure: pathFailure}, nil
	}
	doc, failure := s.buildExport(w, bodyHTML, title)
	if failure != nil {
		return contract.ExportResult{Failure: failure}, nil
	}
	runner := s.printRunner
	if runner == nil {
		return contract.ExportResult{Failure: failFile("print_failed", "打印视图不可用")}, nil
	}
	renderCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	pdf, pdfErr := runner.PDF(renderCtx, doc.HTML)
	if pdfErr != nil {
		if errors.Is(pdfErr, context.DeadlineExceeded) {
			return contract.ExportResult{Failure: failFile("timeout", "PDF 生成超过 30 秒")}, nil
		}
		return contract.ExportResult{Failure: failFile("pdf_failed", "无法生成 PDF")}, nil
	}
	if len(pdf) == 0 {
		return contract.ExportResult{Failure: failFile("pdf_failed", "PDF 内容为空")}, nil
	}
	if err := docwrite.Write(real, pdf, 0o644); err != nil {
		return contract.ExportResult{Failure: failFile("export_failed", "无法写入 PDF 文件")}, nil
	}
	return contract.ExportResult{Path: real, Warnings: doc.Warnings}, nil
}

// PrintDocument opens the system print preview on the dedicated print view
// (M5-6 FILE-17). It never prints the editor page itself.
func (s *WindowService) PrintDocument(ctx context.Context, bodyHTML, title string) (contract.PrintResult, error) {
	w, err := s.startExport(ctx)
	if err != nil {
		return contract.PrintResult{}, err
	}
	if w == nil {
		return contract.PrintResult{Failure: failFile("busy", "导出或打印正在进行")}, nil
	}
	defer s.exportBusy.Store(false)

	doc, failure := s.buildExport(w, bodyHTML, title)
	if failure != nil {
		return contract.PrintResult{Failure: failure}, nil
	}
	runner := s.printRunner
	if runner == nil {
		return contract.PrintResult{Failure: failFile("print_failed", "打印视图不可用")}, nil
	}
	if printErr := runner.Print(ctx, doc.HTML); printErr != nil {
		return contract.PrintResult{Failure: failFile("print_failed", "无法打开打印预览")}, nil
	}
	return contract.PrintResult{Warnings: doc.Warnings}, nil
}

// startExport claims the single export slot and returns the calling window.
func (s *WindowService) startExport(ctx context.Context) (*winctx.Window, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return nil, err
	}
	if !s.exportBusy.CompareAndSwap(false, true) {
		return nil, nil
	}
	return w, nil
}

func (s *WindowService) buildExport(w *winctx.Window, bodyHTML, title string) (markdown.ExportDocument, *contract.Failure) {
	doc, failure := markdown.BuildExportDocument(bodyHTML, title, s.exportImageResolver(w))
	if failure != nil {
		return markdown.ExportDocument{}, failFile(failure.Code, failure.Detail)
	}
	doc.Warnings = uniqueWarnings(doc.Warnings)
	return doc, nil
}

// exportImageResolver reads authorized images and returns data URIs while
// enforcing the total 20 MiB budget. It never fetches a remote URL.
func (s *WindowService) exportImageResolver(w *winctx.Window) markdown.ExportImageResolver {
	var used int64
	return func(src string) (string, string) {
		if parsed, err := url.Parse(src); err == nil && parsed.Scheme != "" &&
			!strings.EqualFold(parsed.Host, resource.Scheme+".localhost") {
			return "", "远程图片未嵌入"
		}
		path, reason := s.exportImagePath(w, src)
		if reason != "" {
			return "", reason
		}
		if check := resource.Check(path); check != "" {
			return "", check + "，已省略"
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return "", "图片不存在，已省略"
		}
		if used+int64(len(data)) > resource.MaxBytes {
			return "", "内嵌图片总量超过 20 MiB，部分图片已省略"
		}
		mime := http.DetectContentType(data)
		if !exportImageMIME(mime) {
			mime = exportImageMIMEFromExt(path)
		}
		if mime == "" {
			return "", "不支持的图片格式，已省略"
		}
		used += int64(len(data))
		return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), ""
	}
}

func (s *WindowService) exportImagePath(w *winctx.Window, src string) (string, string) {
	if parsed, err := url.Parse(src); err == nil && parsed.Scheme != "" {
		if !strings.EqualFold(parsed.Host, resource.Scheme+".localhost") {
			return "", "远程图片未嵌入"
		}
		token := strings.TrimPrefix(parsed.Path, "/")
		if s.resources == nil {
			return "", "图片不存在，已省略"
		}
		item, ok := s.resources.Lookup(token)
		if !ok || item.Window != w.ID() {
			return "", "图片不存在，已省略"
		}
		return item.Path, ""
	}
	doc, ok := w.OpenFile()
	if !ok {
		return "", "未保存文档不能嵌入本地图片"
	}
	real, reason := s.resolveDocumentImage(filepath.Dir(doc), src)
	if reason != "" {
		return "", reason + "，已省略"
	}
	return real, ""
}

func exportImageMIME(mime string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}

func exportImageMIMEFromExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

func suggestedExportName(title, ext string) string {
	name := strings.TrimSpace(title)
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	var cleaned strings.Builder
	for _, r := range name {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			cleaned.WriteRune('-')
		default:
			if r < 32 {
				continue
			}
			cleaned.WriteRune(r)
		}
	}
	name = strings.Trim(cleaned.String(), " .")
	if name == "" {
		name = "未命名"
	}
	return name + ext
}

func exportPath(chosen, ext, detail string) (string, *contract.Failure) {
	real, failure := canonicalSavePath(chosen)
	if failure != nil {
		return "", failure
	}
	current := filepath.Ext(real)
	if current == "" {
		real += ext
	} else if !strings.EqualFold(current, ext) {
		return "", failFile("unsupported_type", detail)
	}
	if info, err := os.Stat(real); err == nil && info.IsDir() {
		return "", failFile("unsupported_type", "不能导出到文件夹")
	}
	return real, nil
}

func uniqueWarnings(warnings []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(warnings))
	for _, warning := range warnings {
		if warning == "" || seen[warning] {
			continue
		}
		seen[warning] = true
		out = append(out, warning)
	}
	return out
}

func (s *WindowService) pickerForExport() ExportPicker {
	if s.exportPick != nil {
		return s.exportPick
	}
	return PickExportPath
}
