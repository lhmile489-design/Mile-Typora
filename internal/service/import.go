package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
)

const importTimeout = 8 * time.Second

// PickImportFile asks for an HTML or DOCX file to import (FILE-15).
func PickImportFile(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx),
		Title:  "导入 HTML 或 DOCX",
		Filters: []mygo.FileFilter{
			{Name: "可导入的文档", Extensions: []string{"html", "htm", "docx"}},
			{Name: "HTML", Extensions: []string{"html", "htm"}},
			{Name: "Word 文档", Extensions: []string{"docx"}},
		},
	})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	return paths[0], nil
}

// ImportDocument converts a user-chosen HTML or DOCX file into a new unsaved
// Markdown buffer. It never writes the source file or the imported text.
func (s *WindowService) ImportDocument(ctx context.Context) (contract.ImportResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ImportResult{}, err
	}
	if s.pickImport == nil {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "import_failed",
			Detail: "当前窗口不能打开导入对话框",
		}}, nil
	}
	chosen, err := s.pickImport(ctx)
	if err != nil {
		return contract.ImportResult{}, err
	}
	if chosen == "" {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "cancelled",
			Detail: "已取消导入",
		}}, nil
	}
	real, failure := pathguard.Canon(chosen)
	if failure != nil {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   failure.Code,
			Detail: failure.Detail,
		}}, nil
	}
	ext := strings.ToLower(filepath.Ext(real))
	if ext != ".html" && ext != ".htm" && ext != ".docx" {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "只能导入 .html、.htm 或 .docx 文件",
		}}, nil
	}
	info, err := os.Stat(real)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return contract.ImportResult{Failure: &contract.Failure{
				Code:   "import_failed",
				Detail: "文件不存在或已被移动",
			}}, nil
		}
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "import_failed",
			Detail: "无法读取要导入的文件",
		}}, nil
	}
	if info.IsDir() {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "不能导入文件夹",
		}}, nil
	}
	if info.Size() > docread.MaxBytes {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "too_large",
			Detail: "文件超过 10 MiB 导入上限",
			Size:   info.Size(),
			Limit:  docread.MaxBytes,
		}}, nil
	}
	data, err := os.ReadFile(real)
	if err != nil {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "import_failed",
			Detail: "无法读取要导入的文件",
		}}, nil
	}

	importCtx, cancel := context.WithTimeout(ctx, importTimeout)
	defer cancel()
	var imported markdown.ImportedDoc
	if ext == ".docx" {
		imported, err = markdown.ImportDOCX(importCtx, data)
	} else {
		imported, err = markdown.ImportHTML(importCtx, data)
	}
	if err != nil {
		code := "import_failed"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(importCtx.Err(), context.DeadlineExceeded) {
			code = "timeout"
		}
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   code,
			Detail: importFailureText(ext, code),
		}}, nil
	}
	name := "导入-" + strings.TrimSuffix(filepath.Base(real), filepath.Ext(real))
	result := contract.ImportResult{
		Text:     imported.Text,
		Name:     name,
		Warnings: imported.Warnings,
		WindowID: w.ID(),
	}
	// A clean window with no file takes the buffer; any other window opens a
	// new one so the imported text never replaces unsaved work (M6-1 freeze).
	dirty, _, _, _ := w.EditState()
	if _, hasFile := w.OpenFile(); !hasFile && !dirty {
		return result, nil
	}
	if s.open == nil {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "window_failed",
			Detail: "无法创建新窗口",
		}}, nil
	}
	id, err := s.open()
	if err != nil {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "window_failed",
			Detail: "无法创建新窗口，请关闭其他窗口后重试",
		}}, nil
	}
	next, ok := s.windows.Get(id)
	if !ok {
		return contract.ImportResult{Failure: &contract.Failure{
			Code:   "window_failed",
			Detail: "新窗口没有注册",
		}}, nil
	}
	next.SetStartUntitled(true)
	next.SetStartText(imported.Text, name)
	result.Text = "" // the new window receives it through Ready.
	result.WindowID = next.ID()
	return result, nil
}

func importFailureText(ext, code string) string {
	if code == "timeout" {
		return "导入超时，请换一个文件重试"
	}
	if ext == ".docx" {
		return "无法解析这个 DOCX 文件，请确认它未损坏且不是受保护文档"
	}
	return "无法解析这个 HTML 文件，请确认它是 UTF-8 编码"
}
