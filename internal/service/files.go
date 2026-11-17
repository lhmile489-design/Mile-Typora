package service

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// MoveDocument moves the current document, or a file selected in the tree,
// into a folder the user picks (M5-1 FILE-09). Nothing is overwritten: a
// same-name file in the target aborts the move.
func (s *WindowService) MoveDocument(ctx context.Context, rel string) (contract.FileOpResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.FileOpResult{}, err
	}
	source, failure := s.fileTarget(w, rel)
	if failure != nil {
		return contract.FileOpResult{Failure: failure}, nil
	}
	if failure := s.ensureWindowsClean(s.windowsShowing(source)); failure != nil {
		return contract.FileOpResult{Failure: failure}, nil
	}
	if s.pickMove == nil {
		return contract.FileOpResult{Failure: failFile("move_failed", "无法打开选择目录的对话框")}, nil
	}
	chosen, err := s.pickMove(ctx)
	if err != nil {
		return contract.FileOpResult{Failure: failFile("move_failed", "无法打开选择目录的对话框")}, nil
	}
	if chosen == "" {
		return contract.FileOpResult{}, nil
	}
	targetDir, pathFailure := pathguard.Canon(chosen)
	if pathFailure != nil {
		return contract.FileOpResult{Failure: contractFailure(pathFailure)}, nil
	}
	info, err := os.Stat(targetDir)
	if err != nil || !info.IsDir() {
		return contract.FileOpResult{Failure: failFile("unsupported_type", "请选择一个文件夹")}, nil
	}
	target := filepath.Join(targetDir, filepath.Base(source))
	if strings.EqualFold(filepath.Dir(source), targetDir) {
		return contract.FileOpResult{}, nil
	}
	if _, err := os.Stat(target); err == nil {
		return contract.FileOpResult{Failure: failFile("move_exists", "目标文件夹已有同名文件")}, nil
	} else if !os.IsNotExist(err) {
		return contract.FileOpResult{Failure: failFile("move_failed", "无法检查目标文件")}, nil
	}
	windows := s.windowsShowing(source)
	unlock := lockWindows(windows)
	defer unlock()
	// The folder dialog can stay open for a while: re-check and lock saves
	// only once it closed, right before the file changes.
	if failure := s.ensureWindowsClean(windows); failure != nil {
		return contract.FileOpResult{Failure: failure}, nil
	}
	for _, window := range windows {
		window.StopWatch()
	}
	if err := moveFile(source, target); err != nil {
		for _, window := range windows {
			s.watchFile(window, source)
		}
		return contract.FileOpResult{Failure: failFile("move_failed", "无法移动文件，原文件未改变")}, nil
	}
	if s.state != nil {
		_ = s.state.RemoveRecent(source)
		s.recordRecent(target, false)
	}
	s.updateMovedWindows(windows, source, target)
	if s.treeChanged != nil {
		if _, hasRoot := w.Root(); hasRoot {
			s.treeChanged(w.ID())
		}
	}
	return contract.FileOpResult{Path: target, Name: filepath.Base(target)}, nil
}

// TrashDocument sends the current document, or a file selected in the tree, to
// the recycle bin (M5-1 FILE-14). A failure leaves the file where it is; this
// never falls back to a permanent delete.
func (s *WindowService) TrashDocument(ctx context.Context, rel string) (contract.FileOpResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.FileOpResult{}, err
	}
	target, failure := s.fileTarget(w, rel)
	if failure != nil {
		return contract.FileOpResult{Failure: failure}, nil
	}
	windows := s.windowsShowing(target)
	unlock := lockWindows(windows)
	defer unlock()
	if failure := s.ensureWindowsClean(windows); failure != nil {
		return contract.FileOpResult{Failure: failure}, nil
	}
	trash := s.trash
	if trash == nil {
		trash = mygo.Shell.TrashItem
	}
	for _, window := range windows {
		window.StopWatch()
	}
	if err := trash(target); err != nil {
		for _, window := range windows {
			s.watchFile(window, target)
		}
		return contract.FileOpResult{Failure: failFile("trash_failed", "无法移至回收站，文件未删除")}, nil
	}
	if s.state != nil {
		_ = s.state.RemoveRecent(target)
	}
	s.afterTrash(windows, target)
	if s.treeChanged != nil {
		if _, hasRoot := w.Root(); hasRoot {
			s.treeChanged(w.ID())
		}
	}
	return contract.FileOpResult{Path: target, Name: filepath.Base(target)}, nil
}

// DocumentProperties returns the read-only details the properties dialog shows
// (M5-1 FILE-11).
func (s *WindowService) DocumentProperties(ctx context.Context, rel string) (contract.FileProperties, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.FileProperties{}, err
	}
	target, failure := s.fileTarget(w, rel)
	if failure != nil {
		return contract.FileProperties{Failure: failure}, nil
	}
	info, err := os.Stat(target)
	if err != nil {
		return contract.FileProperties{Failure: failFile("not_found", "文件不存在或已被移动")}, nil
	}
	properties := contract.FileProperties{
		Name:     filepath.Base(target),
		Path:     target,
		Size:     info.Size(),
		Encoding: "未知",
		Modified: info.ModTime().Format(time.RFC3339),
		ReadOnly: info.Mode().Perm()&0o222 == 0,
	}
	if doc, readFailure := docread.Read(target); readFailure == nil {
		properties.Encoding = "UTF-8"
		if doc.HasBOM {
			properties.Encoding = "UTF-8 BOM"
		}
		properties.LineEnding = doc.LineEnding
		if raw, err := os.ReadFile(target); err == nil {
			properties.LineEnding = detectedLineEnding(raw)
		}
	} else {
		properties.LineEnding = "未知"
	}
	return properties, nil
}

// detectedLineEnding tells LF, CRLF and mixed files apart for the properties
// dialog. The editor itself normalizes to LF; only this read view needs the
// distinction.
func detectedLineEnding(data []byte) string {
	crlf, lf := 0, 0
	for i := 0; i < len(data); i++ {
		if data[i] != '\n' {
			continue
		}
		if i > 0 && data[i-1] == '\r' {
			crlf++
		} else {
			lf++
		}
	}
	switch {
	case crlf > 0 && lf > 0:
		return "混合"
	case crlf > 0:
		return "CRLF"
	default:
		return "LF"
	}
}

// RevealDocument selects the current document in Windows Explorer (M5-1
// FILE-12). It never opens the file or changes its content.
func (s *WindowService) RevealDocument(ctx context.Context) (contract.FileOpResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.FileOpResult{}, err
	}
	target, ok := w.OpenFile()
	if !ok {
		return contract.FileOpResult{Failure: failFile("no_file", "当前文档尚未保存")}, nil
	}
	real, pathFailure := pathguard.Canon(target)
	if pathFailure != nil {
		return contract.FileOpResult{Failure: contractFailure(pathFailure)}, nil
	}
	if _, err := os.Stat(real); err != nil {
		return contract.FileOpResult{Failure: failFile("not_found", "文件不存在或已被移动")}, nil
	}
	reveal := s.reveal
	if reveal == nil {
		reveal = mygo.Shell.ShowItemInFolder
	}
	reveal(real)
	return contract.FileOpResult{Path: real, Name: filepath.Base(real)}, nil
}

// AttachParentFolder makes the current document's folder the window root
// without closing the document. "Show in sidebar" uses it in single-file mode
// (M5-1 FILE-13).
func (s *WindowService) AttachParentFolder(ctx context.Context) (contract.AttachFolderResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.AttachFolderResult{}, err
	}
	file, ok := w.OpenFile()
	if !ok {
		return contract.AttachFolderResult{Failure: failFile("no_file", "当前文档尚未保存")}, nil
	}
	real, pathFailure := pathguard.Canon(file)
	if pathFailure != nil {
		return contract.AttachFolderResult{Failure: contractFailure(pathFailure)}, nil
	}
	info, err := os.Stat(real)
	if err != nil || info.IsDir() {
		return contract.AttachFolderResult{Failure: failFile("not_found", "文件不存在或已被移动")}, nil
	}
	parent := filepath.Dir(real)
	parentReal, pathFailure := pathguard.Canon(parent)
	if pathFailure != nil {
		return contract.AttachFolderResult{Failure: contractFailure(pathFailure)}, nil
	}
	parentInfo, err := os.Stat(parentReal)
	if err != nil || !parentInfo.IsDir() {
		return contract.AttachFolderResult{Failure: failFile("not_found", "无法打开文件所在目录")}, nil
	}
	rel, relErr := filepath.Rel(parentReal, real)
	if relErr != nil || outsideRel(rel) {
		return contract.AttachFolderResult{Failure: failFile("out_of_scope", "文件不在所选目录内")}, nil
	}
	currentRoot, hasRoot := w.Root()
	if !hasRoot || !strings.EqualFold(currentRoot, parentReal) {
		w.SetRootKeepFile(parentReal)
		s.recordRecent(parentReal, true)
		s.recordResumeOf(w)
		s.watchTree(w, parentReal)
	}
	return contract.AttachFolderResult{
		Folder: &contract.FolderInfo{Root: parentReal, Name: filepath.Base(parentReal)},
		Rel:    filepath.ToSlash(rel),
	}, nil
}

// outsideRel reports whether filepath.Rel escaped its root. A file named
// "..notes.md" is inside the root; only ".." and "..\" are not.
func outsideRel(rel string) bool {
	return rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// fileTarget resolves what a file command acts on. An empty rel means the
// window's current document; a non-empty rel is a relative path from the
// window's root and is still canonicalized and checked here.
func (s *WindowService) fileTarget(w *winctx.Window, rel string) (string, *contract.Failure) {
	if strings.TrimSpace(rel) == "" {
		path, ok := w.OpenFile()
		if !ok {
			return "", failFile("no_file", "当前没有已保存的文档")
		}
		real, pathFailure := pathguard.Canon(path)
		if pathFailure != nil {
			return "", contractFailure(pathFailure)
		}
		return real, nil
	}
	root, ok := w.Root()
	if !ok {
		return "", failFile("out_of_scope", "尚未打开文件夹")
	}
	clean := filepath.FromSlash(rel)
	if filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" || strings.HasPrefix(clean, `\`) || strings.HasPrefix(clean, "/") {
		return "", failFile("out_of_scope", "只能操作当前目录内的文件")
	}
	joined := filepath.Join(root, clean)
	real, pathFailure := pathguard.Canon(joined)
	if pathFailure != nil {
		return "", contractFailure(pathFailure)
	}
	within, withinFailure := pathguard.Within(root, real)
	if !within {
		return "", contractFailure(withinFailure)
	}
	if componentFailure := pathguard.CheckComponents(root, real); componentFailure != nil {
		return "", contractFailure(componentFailure)
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", failFile("not_found", "文件不存在或已被移动")
	}
	if info.IsDir() || !pathguard.MarkdownExt(real) {
		return "", failFile("unsupported_type", "只能操作 Markdown 文件")
	}
	return real, nil
}

// ensureWindowsClean refuses a move or trash when another window showing the
// same file has unsaved changes. The page reports dirty through SetEditState.
func (s *WindowService) ensureWindowsClean(windows []*winctx.Window) *contract.Failure {
	for _, w := range windows {
		if dirty, _, _, _ := w.EditState(); dirty {
			return failFile("dirty_other", "同一文件在其他窗口有未保存修改，请先保存")
		}
	}
	return nil
}

// windowsShowing lists the windows that show path, including the caller.
func (s *WindowService) windowsShowing(path string) []*winctx.Window {
	if s.windows == nil {
		return nil
	}
	var out []*winctx.Window
	for _, id := range s.windows.IDs() {
		w, ok := s.windows.Get(id)
		if !ok {
			continue
		}
		open, has := w.OpenFile()
		if !has || !sameFilePath(open, path) {
			continue
		}
		out = append(out, w)
	}
	return out
}

func sameFilePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// updateMovedWindows points every window that showed the old path at the new
// one, rewires its watch and gives it the re-read document. The windows were
// checked clean first, so replacing their buffers cannot lose edits.
func (s *WindowService) updateMovedWindows(windows []*winctx.Window, oldPath, newPath string) {
	for _, w := range windows {
		open, has := w.OpenFile()
		if !has || !sameFilePath(open, oldPath) {
			continue
		}
		w.SetOpenFile(newPath)
		// Drop any reload that was already reading the old path.
		w.NextRefresh()
		s.watchFile(w, newPath)
		s.recordResumeOf(w)
		if s.treeChanged != nil {
			s.treeChanged(w.ID())
		}
		result := s.readAndRender(context.Background(), w, newPath)
		if s.docUpdated == nil {
			continue
		}
		if result.Doc == nil {
			s.docUpdated(w.ID(), contract.DocUpdate{Seq: w.NextRefresh(), Failure: result.Failure})
			continue
		}
		dirty, _, _, _ := w.EditState()
		w.SetEditState(dirty, result.Doc.Hash, result.Doc.HasBOM, result.Doc.LineEnding)
		s.docUpdated(w.ID(), contract.DocUpdate{
			Seq: w.NextRefresh(),
			Doc: result.Doc,
			Rel: s.relToRoot(w, result.Doc),
		})
	}
}

// afterTrash tells every window that showed the file what happened. The
// document stays in memory with its path so Save As or a later recreate can
// still use it; only the watch stops.
func (s *WindowService) afterTrash(windows []*winctx.Window, path string) {
	for _, w := range windows {
		// A reload that started before the trash must not report the file as
		// missing after the trashed event.
		w.NextRefresh()
		if s.treeChanged != nil {
			s.treeChanged(w.ID())
		}
		if s.fileTrashed != nil {
			s.fileTrashed(w.ID(), contract.FileTrashed{Path: path, Name: filepath.Base(path)})
		}
	}
}

// lockWindows serializes a file operation against saves in every window that
// shows the file. Ordering by ID keeps two file operations from deadlocking.
func lockWindows(windows []*winctx.Window) func() {
	ordered := append([]*winctx.Window(nil), windows...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID() < ordered[j].ID() })
	for _, w := range ordered {
		w.LockSave()
	}
	return func() {
		for i := len(ordered) - 1; i >= 0; i-- {
			ordered[i].UnlockSave()
		}
	}
}

// renameFile is os.Rename in production; tests replace it to force the
// cross-volume copy path.
var renameFile = os.Rename

// moveFile renames a file, falling back to copy, verify and delete for a
// target on another volume. Any failure leaves the source in place.
func moveFile(source, target string) error {
	if err := renameFile(source, target); err == nil {
		return nil
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	temp, err := os.CreateTemp(filepath.Dir(target), ".mile-move-*")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if _, err := io.Copy(temp, in); err != nil {
		temp.Close()
		return err
	}
	// Windows refuses to delete a file that still has an open handle.
	if err := in.Close(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempName, info.Mode().Perm()); err != nil {
		return err
	}
	if err := os.Chtimes(tempName, info.ModTime(), info.ModTime()); err != nil {
		return err
	}
	sourceHash, err := hashFile(source)
	if err != nil {
		return err
	}
	tempHash, err := hashFile(tempName)
	if err != nil || sourceHash != tempHash {
		return errFileCopy
	}
	if err := os.Rename(tempName, target); err != nil {
		return err
	}
	if err := os.Remove(source); err != nil {
		_ = os.Remove(target)
		return err
	}
	return nil
}

var errFileCopy = &fileCopyError{}

type fileCopyError struct{}

func (*fileCopyError) Error() string { return "copy verification failed" }

func failFile(code, detail string) *contract.Failure {
	return &contract.Failure{Code: code, Detail: detail}
}

func contractFailure(failure *pathguard.Failure) *contract.Failure {
	if failure == nil {
		return failFile("out_of_scope", "无法访问此路径")
	}
	return failFile(failure.Code, failure.Detail)
}
