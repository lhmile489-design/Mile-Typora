package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/docwrite"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// ErrWindowDirty means a close needs the page's unsaved-changes prompt first.
var ErrWindowDirty = errors.New("window has unsaved changes")

// SavePicker asks for a save path; tests replace it.
type SavePicker func(ctx context.Context, suggested string) (string, error)

// SaveDocument writes the window's buffer to its file (PRD 10.2). force skips
// the conflict check after the user confirmed an overwrite or recreate.
func (s *WindowService) SaveDocument(ctx context.Context, text string, force bool) (contract.SaveResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.SaveResult{}, err
	}
	path, ok := w.OpenFile()
	if !ok {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "no_path",
			Detail: "这份文档还没有保存位置，请使用另存为",
		}}, nil
	}
	return s.saveText(w, path, text, force, false), nil
}

// SaveDocumentAs asks for a path and writes the buffer there.
func (s *WindowService) SaveDocumentAs(ctx context.Context, text string) (contract.SaveResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.SaveResult{}, err
	}
	suggested := "未命名.md"
	if path, ok := w.OpenFile(); ok {
		suggested = filepath.Base(path)
	}
	chosen, err := s.savePick(ctx, suggested)
	if err != nil {
		return contract.SaveResult{}, err
	}
	if chosen == "" {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "cancelled",
			Detail: "已取消保存",
		}}, nil
	}
	real, pathFailure := canonicalSavePath(chosen)
	if pathFailure != nil {
		return contract.SaveResult{Failure: pathFailure}, nil
	}
	if filepath.Ext(real) == "" {
		real += ".md"
	}
	if !pathguard.MarkdownExt(real) {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "只能保存为 .md 或 .markdown 文件",
		}}, nil
	}
	if info, err := os.Stat(real); err == nil && info.IsDir() {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "不能保存到文件夹",
		}}, nil
	}
	result := s.saveText(w, real, text, true, true)
	if result.Failure != nil {
		return result, nil
	}
	// The window now watches and remembers the new file.
	w.SetOpenFile(real)
	s.watchFile(w, real)
	s.recordRecent(real, false)
	s.recordResumeOf(w)
	result.Name = filepath.Base(real)
	return result, nil
}

// SetEditState lets the page tell the backend whether its buffer is dirty and
// which file version it started from. The native close handler uses it.
func (s *WindowService) SetEditState(ctx context.Context, dirty bool, hash string, hasBOM bool, lineEnding string) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	w.SetEditState(dirty, hash, hasBOM, lineEnding)
	return nil
}

// WindowDirty answers the native close handler; main calls it directly.
func (s *WindowService) WindowDirty(id int) bool {
	w, ok := s.windows.Get(id)
	if !ok {
		return false
	}
	dirty, _, _, _ := w.EditState()
	return dirty
}

// canonicalSavePath resolves a path that may not exist yet: the folder is
// canonicalized (links, junctions and devices are still refused), the name is
// kept. Canon itself needs an existing file, which a new save target is not.
func canonicalSavePath(chosen string) (string, *contract.Failure) {
	if strings.TrimSpace(chosen) == "" {
		return "", &contract.Failure{Code: "no_path", Detail: "没有选择保存位置"}
	}
	dir, base := filepath.Dir(chosen), filepath.Base(chosen)
	realDir, failure := pathguard.Canon(dir)
	if failure != nil {
		return "", &contract.Failure{Code: failure.Code, Detail: failure.Detail}
	}
	return filepath.Join(realDir, base), nil
}

// saveText validates, checks the disk baseline and replaces the file.
func (s *WindowService) saveText(w *winctx.Window, path, text string, force, as bool) contract.SaveResult {
	w.LockSave()
	defer w.UnlockSave()
	if !as {
		// A move can finish while this save waits for the lock. Writing the
		// old path then would resurrect the file the move just left behind.
		current, ok := w.OpenFile()
		if !ok || !sameFilePath(current, path) {
			return contract.SaveResult{Failure: &contract.Failure{
				Code:   "save_failed",
				Detail: "文件已被移动，请另存为或重新打开",
			}}
		}
	}
	if !utf8.ValidString(text) {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "encoding",
			Detail: "编辑内容不是有效的 UTF-8",
		}}
	}
	if len(text) > docread.MaxBytes {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "too_large",
			Detail: "文档超过读取上限",
			Size:   int64(len(text)),
			Limit:  docread.MaxBytes,
		}}
	}
	_, baseHash, hasBOM, lineEnding := w.EditState()
	if !as && !force {
		diskHash, err := hashFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				return contract.SaveResult{Failure: &contract.Failure{
					Code:   "missing",
					Detail: "文件已被删除，可以重新创建或另存为",
				}}
			}
			return contract.SaveResult{Failure: &contract.Failure{
				Code:   "save_failed",
				Detail: "无法读取磁盘上的文件",
			}}
		}
		if baseHash != "" && diskHash != baseHash {
			return contract.SaveResult{Failure: &contract.Failure{
				Code:   "conflict",
				Detail: "文件已在其他窗口或程序中修改",
			}}
		}
	}

	data := encode(text, hasBOM, lineEnding)
	if len(data) > docread.MaxBytes+4 {
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "too_large",
			Detail: "文档超过读取上限",
			Size:   int64(len(data)),
			Limit:  docread.MaxBytes,
		}}
	}
	if err := docwrite.Write(path, data, 0o644); err != nil {
		log.Printf("save: cannot write the document: %v", err)
		return contract.SaveResult{Failure: &contract.Failure{
			Code:   "save_failed",
			Detail: "保存失败，文件可能被占用或没有写入权限",
		}}
	}

	sum := sha256.Sum256(data)
	newHash := hex.EncodeToString(sum[:])
	w.SetEditState(false, newHash, hasBOM, lineEnding)
	w.SetSavedHash(newHash)
	if !as {
		s.recordRecent(path, false)
		s.recordResumeOf(w)
	}
	return contract.SaveResult{
		Path:       path,
		Name:       filepath.Base(path),
		Size:       int64(len(data)),
		Hash:       newHash,
		HasBOM:     hasBOM,
		LineEnding: lineEnding,
	}
}

// encode restores the file's format: the BOM it had and its line endings.
// The editor always holds LF, so only CRLF needs a conversion.
func encode(text string, hasBOM bool, lineEnding string) []byte {
	if lineEnding == "CRLF" {
		text = strings.ReplaceAll(text, "\n", "\r\n")
	}
	data := []byte(text)
	if hasBOM {
		data = append([]byte{0xEF, 0xBB, 0xBF}, data...)
	}
	return data
}

// hashFile hashes a file's bytes on disk, the save conflict baseline.
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// PickSavePath is the production save dialog.
func PickSavePath(ctx context.Context, suggested string) (string, error) {
	return mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "另存为",
		DefaultPath: suggested,
		Filters: []mygo.FileFilter{
			{Name: "Markdown", Extensions: []string{"md", "markdown"}},
		},
	})
}
