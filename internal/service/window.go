// Package service holds the bound services the frontend calls.
package service

import (
	"context"
	"errors"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/scan"
	"github.com/lhmile489-design/mile-typora/internal/watch"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

var (
	// ErrNoCallerWindow means a call arrived without a calling window.
	ErrNoCallerWindow = errors.New("no calling window")
	// ErrWindowNotOpen means the calling window is not in the registry, which
	// is a program defect: every window is registered when it is created.
	ErrWindowNotOpen = errors.New("calling window is not open")
)

// Opener creates a native window and returns its ID. main supplies one that
// registers the window; tests supply their own.
type Opener func() (int, error)

// Picker shows the system file dialog and returns the chosen path, or "" when
// the user cancelled. Tests supply their own.
type Picker func(ctx context.Context) (string, error)

// WindowService manages the windows of the app.
// Deps are what a WindowService needs from its host. main supplies the real
// ones; tests supply their own.
type Deps struct {
	Windows    *winctx.Registry
	Open       Opener
	PickFile   Picker
	PickFolder Picker
	Resources  *resource.Store
	// Watcher shares one file watch between the windows that show a file.
	Watcher *watch.Pool
	// DocUpdated tells one window its document changed.
	DocUpdated func(windowID int, update contract.DocUpdate)
	// TreeWatcher shares one folder watch between the windows that show it.
	TreeWatcher *watch.Pool
	// TreeChanged tells one window its folder's structure changed.
	TreeChanged func(windowID int)
	// CloseWindow closes one native window; the last one quits the app.
	CloseWindow func(windowID int) error
	// StartedAt is when the process started, for the startup measurement
	// (docs/develop/性能基线.md).
	StartedAt time.Time
	// State is the settings store; nil when the app data directory is not
	// usable, in which case the app still reads documents.
	State *appstate.Store
	// StartupNotice tells the first page why no document was restored.
	StartupNotice string
	// ThemeChanged tells every window the appearance preference changed.
	ThemeChanged func(appearance string)
	// Confirm asks the user a yes/no question with the reason spelled out.
	Confirm func(ctx context.Context, title, message, detail string) bool
	// External opens a URL with the system browser.
	External func(url string) error
}

type WindowService struct {
	// caller finds the calling window's ID; tests replace it.
	caller    func(ctx context.Context) (int, bool)
	version   func() string
	windows   *winctx.Registry
	open      Opener
	pick      Picker
	pickDir   Picker
	render    *markdown.Renderer
	resources *resource.Store
	watcher   *watch.Pool
	state     *appstate.Store
	// startupNotice is handed to the first page once.
	startupNotice string
	themeChanged  func(appearance string)
	docUpdated    func(windowID int, update contract.DocUpdate)
	treeWatcher   *watch.Pool
	treeChanged   func(windowID int)
	closeWindow   func(windowID int) error
	startedAt     time.Time
	// metaFailed records that an implicit settings write failed, so the next
	// GetSettings can tell the user without blocking the reading (PRD FR-08.8).
	metaFailed atomic.Bool
	confirm    func(ctx context.Context, title, message, detail string) bool
	external   func(url string) error
}

// NewWindowService returns a WindowService over the open windows. resources is
// the store the mtres protocol serves from; main registers that handler.
func NewWindowService(d Deps) *WindowService {
	if d.PickFile == nil {
		d.PickFile = PickMarkdown
	}
	if d.PickFolder == nil {
		d.PickFolder = PickFolder
	}
	if d.Confirm == nil {
		d.Confirm = ConfirmNative
	}
	if d.External == nil {
		d.External = mygo.Shell.OpenExternal
	}
	return &WindowService{
		caller: func(ctx context.Context) (int, bool) {
			w := mygo.CallerWindow(ctx)
			if w == nil {
				return 0, false
			}
			return w.ID(), true
		},
		version:       mygo.App.Version,
		windows:       d.Windows,
		open:          d.Open,
		pick:          d.PickFile,
		pickDir:       d.PickFolder,
		render:        markdown.New(),
		resources:     d.Resources,
		watcher:       d.Watcher,
		docUpdated:    d.DocUpdated,
		treeWatcher:   d.TreeWatcher,
		treeChanged:   d.TreeChanged,
		closeWindow:   d.CloseWindow,
		startedAt:     d.StartedAt,
		state:         d.State,
		startupNotice: d.StartupNotice,
		themeChanged:  d.ThemeChanged,
		confirm:       d.Confirm,
		external:      d.External,
	}
}

// imageResolver answers a document's image references: only files inside the
// document's own directory, only the formats the app serves, each under a
// fresh token (PRD FR-06).
func (s *WindowService) imageResolver(window int, dir string) markdown.ImageResolver {
	return func(ref string) (string, string) {
		trimmed := strings.TrimSpace(ref)
		if trimmed == "" {
			return "", "图片地址为空"
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
			// No request leaves the app for document content (PRD §8.4).
			return "", "远程图片未加载"
		}
		if hasScheme(trimmed) {
			return "", "不支持此图片地址"
		}
		unescaped, err := url.PathUnescape(trimmed)
		if err != nil {
			return "", "图片地址无效"
		}
		if strings.HasPrefix(unescaped, "/") || strings.HasPrefix(unescaped, `\`) ||
			filepath.IsAbs(unescaped) || filepath.VolumeName(unescaped) != "" {
			return "", "只能显示文档目录内的图片"
		}
		target := filepath.Join(dir, filepath.FromSlash(unescaped))
		// Lexically first: a reference that climbs out is refused before the
		// file system is asked, so nothing about it leaks.
		if ok, _ := pathguard.Within(dir, filepath.Clean(target)); !ok {
			return "", "只能显示文档目录内的图片"
		}
		real, pathFailure := pathguard.Canon(target)
		if pathFailure != nil {
			if pathFailure.Code == "out_of_scope" {
				return "", "此图片不在允许的范围内"
			}
			return "", "图片不存在"
		}
		if ok, _ := pathguard.Within(dir, real); !ok {
			return "", "此图片不在文档目录内"
		}
		if componentFailure := pathguard.CheckComponents(dir, real); componentFailure != nil {
			return "", componentFailure.Detail
		}
		if !imageExt(real) {
			return "", "不支持的图片格式"
		}
		// The bytes and the size decide, before the page asks for them.
		if reason := resource.Check(real); reason != "" {
			return "", reason
		}
		return resourceURL(s.resources.Add(window, real)), ""
	}
}

// hasScheme reports whether ref names a scheme, as "javascript:alert(1)" does.
func hasScheme(ref string) bool {
	for i, c := range ref {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
			continue
		case c == ':' && i > 0:
			return true
		default:
			return false
		}
	}
	return false
}

// imageExt accepts the extensions of the formats the store serves. The bytes
// decide in the end; the extension only keeps obvious mistakes out early.
func imageExt(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return true
	}
	return false
}

// PickMarkdown asks the system for one Markdown file. Choosing it is the
// authorization to read it (PRD FR-06.1).
func PickMarkdown(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx),
		Title:  "打开 Markdown 文件",
		Filters: []mygo.FileFilter{
			{Name: "Markdown", Extensions: []string{"md", "markdown"}},
			{Name: "所有文件", Extensions: []string{"*"}},
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

// PickFolder asks the system for one folder. Choosing it is the authorization
// to read what is inside (PRD FR-06.1).
func PickFolder(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:    mygo.CallerWindow(ctx),
		Title:     "打开文件夹",
		Directory: true,
	})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	return paths[0], nil
}

// OpenFolderDialog asks for a folder and makes it the window's root. The page
// then asks for its tree with Scan.
func (s *WindowService) OpenFolderDialog(ctx context.Context) (contract.OpenFolderResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.OpenFolderResult{}, err
	}
	chosen, err := s.pickDir(ctx)
	if err != nil {
		return contract.OpenFolderResult{}, err
	}
	if chosen == "" {
		return contract.OpenFolderResult{}, nil
	}
	real, pathFailure := pathguard.Canon(chosen)
	if pathFailure != nil {
		return contract.OpenFolderResult{Failure: &contract.Failure{
			Code: pathFailure.Code, Detail: pathFailure.Detail,
		}}, nil
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return contract.OpenFolderResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "请选择一个文件夹",
		}}, nil
	}
	// A window that already shows something keeps it (PRD FR-02, D-03).
	if !w.IsEmpty() {
		if err := s.handOff(winctx.KindFolder, real); err != nil {
			return contract.OpenFolderResult{Failure: &contract.Failure{
				Code:   "window_failed",
				Detail: "无法在新窗口打开，请关闭其他窗口后重试",
			}}, nil
		}
		return contract.OpenFolderResult{}, nil
	}
	s.finishFolder(w, real)
	return contract.OpenFolderResult{Root: real, Name: filepath.Base(real)}, nil
}

// finishFolder makes real the window's folder and starts everything that
// belongs to it: the recent entry, the resume target and the structure watch.
// Both ways of opening a folder end here (PRD FR-03, FR-07.1).
func (s *WindowService) finishFolder(w *winctx.Window, real string) {
	w.SetRoot(real)
	s.recordRecent(real, true)
	s.recordResumeOf(w)
	s.watchTree(w, real)
}

// Scan streams the tree of the window's folder in frames, ending with one
// marked Done (PRD FR-03). A page that stops reading closes the channel and
// the scan stops with it.
func (s *WindowService) Scan(ctx context.Context, frames *mygo.Channel[contract.ScanFrame]) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	root, ok := w.Root()
	if !ok {
		_ = frames.Send(contract.ScanFrame{Done: true, Failure: &contract.Failure{
			Code:   "no_folder",
			Detail: "尚未打开文件夹",
		}})
		return nil
	}
	started := time.Now()
	result, err := scan.Scan(ctx, root, scan.Options{})
	if err != nil {
		_ = frames.Send(contract.ScanFrame{Done: true, Failure: &contract.Failure{
			Code:   "scan_failed",
			Detail: "无法读取此文件夹",
		}})
		return nil
	}

	firstSent := false
	for _, frame := range scanFrames(result) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := frames.Send(frame); err != nil {
			return nil // the page is done with this tree
		}
		if !firstSent {
			firstSent = true
			log.Printf("perf: scan first ms=%d", time.Since(started).Milliseconds())
		}
		if frame.Done {
			log.Printf("perf: scan done ms=%d entries=%d", time.Since(started).Milliseconds(), len(result.Entries))
		}
	}
	return nil
}

// ScanBatch is how many entries one frame carries: the page draws its first
// rows before the whole tree is on its way (PRD §8.2).
const ScanBatch = 500

// scanFrames slices a scan into the frames the page receives. The last frame
// is marked Done and carries the outcome.
func scanFrames(result scan.Result) []contract.ScanFrame {
	frames := make([]contract.ScanFrame, 0, len(result.Entries)/ScanBatch+1)
	for start := 0; start < len(result.Entries); start += ScanBatch {
		end := min(start+ScanBatch, len(result.Entries))
		frame := contract.ScanFrame{Entries: make([]contract.TreeEntry, 0, end-start)}
		for _, entry := range result.Entries[start:end] {
			frame.Entries = append(frame.Entries, contract.TreeEntry{
				Path: entry.Path, Name: entry.Name, IsDir: entry.IsDir,
			})
		}
		frames = append(frames, frame)
	}
	frames = append(frames, contract.ScanFrame{
		Done:       true,
		Truncated:  result.Truncated,
		Bound:      result.Bound,
		Skipped:    result.Skipped,
		Unreadable: result.Unreadable,
	})
	return frames
}

// OpenFileDialog asks for a Markdown file and reads it (FR-01). Cancelling
// changes nothing; every problem is an expected Failure for the page to show.
func (s *WindowService) OpenFileDialog(ctx context.Context) (contract.LoadResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.LoadResult{}, err
	}
	chosen, err := s.pick(ctx)
	if err != nil {
		return contract.LoadResult{}, err
	}
	if chosen == "" {
		return contract.LoadResult{}, nil
	}
	// A window that already shows something keeps it: the file opens in a
	// new window (PRD FR-02, D-03).
	if !w.IsEmpty() {
		if err := s.handOff(winctx.KindFile, chosen); err != nil {
			return contract.LoadResult{Failure: &contract.Failure{
				Code:   "window_failed",
				Detail: "无法在新窗口打开，请关闭其他窗口后重试",
			}}, nil
		}
		return contract.LoadResult{}, nil
	}
	return s.openPath(ctx, w, chosen)
}

// OpenTreeFile opens a file the tree names, relative to the window's folder,
// in this window or a new one (PRD FR-02, AC-06).
func (s *WindowService) OpenTreeFile(ctx context.Context, rel string, newWindow bool) (contract.OpenRequestResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.OpenRequestResult{}, err
	}
	root, ok := w.Root()
	if !ok {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   "no_folder",
			Detail: "尚未打开文件夹",
		}}, nil
	}
	if rel == "" {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   "not_found",
			Detail: "没有选择文件",
		}}, nil
	}
	target := filepath.Join(root, filepath.FromSlash(rel))
	if within, pathFailure := pathguard.Within(root, filepath.Clean(target)); !within {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   pathFailure.Code,
			Detail: pathFailure.Detail,
		}}, nil
	}
	if newWindow {
		if err := s.handOff(winctx.KindFile, target); err != nil {
			return contract.OpenRequestResult{Failure: &contract.Failure{
				Code:   "window_failed",
				Detail: "无法在新窗口打开，请关闭其他窗口后重试",
			}}, nil
		}
		return contract.OpenRequestResult{}, nil
	}
	return s.openKind(ctx, w, winctx.KindFile, target)
}

// handOff opens a window and gives it the request: a window that already
// shows something never replaces it (PRD FR-02, D-03).
func (s *WindowService) handOff(kind, path string) error {
	id, err := s.open()
	if err != nil {
		return err
	}
	w, ok := s.windows.Get(id)
	if !ok {
		return ErrWindowNotOpen
	}
	_, err = w.PushKind(kind, path)
	return err
}

// OpenRequested opens what a queued request names: a file association, a
// command-line argument, or another instance's request (PRD FR-02.8). The
// request is acknowledged once handled, whether it opened or not.
func (s *WindowService) OpenRequested(ctx context.Context, seq int64) (contract.OpenRequestResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.OpenRequestResult{}, err
	}
	request, ok := w.Intent(seq)
	if !ok {
		// Already handled: a page that remounted (React StrictMode) or
		// reloaded asks again. Give it what the window shows, so the request
		// is not lost to a discarded render.
		return s.currentContent(ctx, w)
	}
	result, err := s.openKind(ctx, w, request.Kind, request.Path)
	w.Ack(seq)
	return result, err
}

// openKind opens a request of either kind.
func (s *WindowService) openKind(ctx context.Context, w *winctx.Window, kind, path string) (contract.OpenRequestResult, error) {
	if kind == winctx.KindFolder {
		return s.openFolderPath(w, path)
	}
	load, err := s.openPath(ctx, w, path)
	if err != nil {
		return contract.OpenRequestResult{}, err
	}
	return contract.OpenRequestResult{
		Kind:    "file",
		Doc:     load.Doc,
		Rel:     s.relToRoot(w, load.Doc),
		Failure: load.Failure,
	}, nil
}

// openFolderPath makes a folder the window's root.
func (s *WindowService) openFolderPath(w *winctx.Window, path string) (contract.OpenRequestResult, error) {
	real, pathFailure := pathguard.Canon(path)
	if pathFailure != nil {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code: pathFailure.Code, Detail: pathFailure.Detail,
		}}, nil
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return contract.OpenRequestResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "请选择一个文件夹",
		}}, nil
	}
	s.finishFolder(w, real)
	return contract.OpenRequestResult{
		Kind:   "folder",
		Folder: &contract.FolderInfo{Root: real, Name: filepath.Base(real)},
	}, nil
}

// watchTree subscribes the window to its folder's structure. The pool shares
// one recursive watch between windows that show the same folder; the last
// release stops it, as for a file. A folder too large to watch keeps manual
// refresh (PRD §8.3); the failure stays in the log, not in the page.
func (s *WindowService) watchTree(w *winctx.Window, root string) {
	if s.treeWatcher == nil {
		return
	}
	w.StopTreeWatch()
	release, err := s.treeWatcher.Acquire(root, func(ev watch.Event) {
		if s.treeChanged != nil {
			s.treeChanged(w.ID())
		}
		if ev.Op == watch.Gone {
			// The folder went away or was renamed: the open document cannot
			// be read any more, so mark it stale (PRD FR-07.9, AC-12).
			go s.reload(w)
		}
	})
	if err != nil {
		log.Printf("window %d: cannot watch its folder: %v", w.ID(), err)
		return
	}
	w.SetStopTreeWatch(release)
}

// currentContent answers a repeated request with what the window shows.
func (s *WindowService) currentContent(ctx context.Context, w *winctx.Window) (contract.OpenRequestResult, error) {
	if path, has := w.OpenFile(); has {
		load, err := s.openPath(ctx, w, path)
		if err != nil {
			return contract.OpenRequestResult{}, err
		}
		return contract.OpenRequestResult{Kind: "file", Doc: load.Doc, Failure: load.Failure}, nil
	}
	if root, has := w.Root(); has {
		return contract.OpenRequestResult{
			Kind:   "folder",
			Folder: &contract.FolderInfo{Root: root, Name: filepath.Base(root)},
		}, nil
	}
	return contract.OpenRequestResult{Failure: &contract.Failure{
		Code:   "request_expired",
		Detail: "这次打开请求已经处理过",
	}}, nil
}

// openPath validates a path the user chose or was handed, reads and renders
// it, and makes it the window's document.
func (s *WindowService) openPath(ctx context.Context, w *winctx.Window, chosen string) (contract.LoadResult, error) {
	started := time.Now()
	result := s.readAndRender(ctx, w, chosen)
	log.Printf("perf: open ms=%d ok=%t", time.Since(started).Milliseconds(), result.Failure == nil)
	if result.Failure != nil || result.Doc == nil {
		return result, nil
	}
	s.finishOpen(w, result.Doc.Path)
	return result, nil
}

// readAndRender turns a path into the document a page shows. Opening and
// refreshing need exactly these steps, so they share them.
func (s *WindowService) readAndRender(ctx context.Context, w *winctx.Window, chosen string) contract.LoadResult {
	real, pathFailure := pathguard.Canon(chosen)
	if pathFailure != nil {
		return contract.LoadResult{Failure: &contract.Failure{
			Code: pathFailure.Code, Detail: pathFailure.Detail,
		}}
	}
	if !pathguard.MarkdownExt(real) {
		return contract.LoadResult{Failure: &contract.Failure{
			Code:   "unsupported_type",
			Detail: "只支持 .md 和 .markdown 文件",
		}}
	}
	doc, readFailure := docread.Read(real)
	if readFailure != nil {
		return contract.LoadResult{Failure: &contract.Failure{
			Code:   readFailure.Code,
			Detail: readFailure.Detail,
			Size:   readFailure.Size,
			Limit:  readFailure.Limit,
		}}
	}
	s.resources.ForgetWindow(w.ID())
	rendered, renderFailure := s.render.Render(ctx, []byte(doc.Text), s.imageResolver(w.ID(), filepath.Dir(real)))
	if renderFailure != nil {
		return contract.LoadResult{Failure: &contract.Failure{
			Code: renderFailure.Code, Detail: renderFailure.Detail,
		}}
	}
	return contract.LoadResult{Doc: &contract.Doc{
		Name:       filepath.Base(real),
		Path:       real,
		Size:       doc.Size,
		HasBOM:     doc.HasBOM,
		LineEnding: doc.LineEnding,
		Text:       doc.Text,
		HTML:       rendered.HTML,
		Counts: contract.Counts{
			Math:           rendered.Counts.Math,
			MathLimited:    rendered.Counts.MathLimited,
			Mermaid:        rendered.Counts.Mermaid,
			MermaidLimited: rendered.Counts.MermaidLimited,
		},
	}}
}

// finishOpen records the document and starts watching its file.
func (s *WindowService) finishOpen(w *winctx.Window, real string) {
	w.SetOpenFile(real)
	s.recordRecent(real, false)
	s.recordResumeOf(w)
	if s.watcher == nil {
		return
	}
	release, err := s.watcher.Acquire(real, func(ev watch.Event) {
		s.onFileEvent(w, ev)
	})
	if err != nil {
		log.Printf("window %d: cannot watch its file: %v", w.ID(), err)
		return
	}
	w.SetStopWatch(release)
}

// onFileEvent refreshes the window's document after a change outside the app.
// The path stays out of the log: it is the user's file name (CLAUDE.md §6).
func (s *WindowService) onFileEvent(w *winctx.Window, ev watch.Event) {
	if ev.Op == watch.Gone {
		// The file's folder went away: read once more so the page marks the
		// document stale instead of keeping it as if it were current
		// (PRD FR-07.5, AC-12).
		log.Printf("window %d: the watch on its file ended", w.ID())
		go s.reload(w)
		return
	}
	log.Printf("window %d: its file %s", w.ID(), ev.Op)
	go s.reload(w)
}

// reload reads the window's file again and tells its page. A result that a
// newer change has overtaken is dropped (PRD §9.2.5, AC-12).
func (s *WindowService) reload(w *winctx.Window) {
	path, ok := w.OpenFile()
	if !ok {
		return
	}
	seq := w.NextRefresh()
	result := s.readAndRender(context.Background(), w, path)
	if !w.IsLatestRefresh(seq) {
		log.Printf("window %d: a late reload was dropped", w.ID())
		return
	}
	if s.docUpdated == nil {
		return
	}
	s.docUpdated(w.ID(), contract.DocUpdate{Seq: seq, Doc: result.Doc, Failure: result.Failure})
}

// Refresh reads the window's document again, for F5 and the stale banner
// (PRD FR-07.2). A missing file comes back as a failure the page shows.
func (s *WindowService) Refresh(ctx context.Context) (contract.LoadResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.LoadResult{}, err
	}
	path, ok := w.OpenFile()
	if !ok {
		return contract.LoadResult{Failure: &contract.Failure{
			Code:   "not_found",
			Detail: "尚未打开文档",
		}}, nil
	}
	w.NextRefresh()
	return s.readAndRender(ctx, w, path), nil
}

// RemoveRecent drops one recent entry the page found unavailable (PRD §7.2).
// Only entries the app recorded can be removed, so the page cannot use this
// to touch anything else.
func (s *WindowService) RemoveRecent(ctx context.Context, path string) error {
	if _, err := s.callerWindow(ctx); err != nil {
		return err
	}
	if s.state == nil {
		return nil
	}
	if err := s.state.RemoveRecent(path); err != nil {
		log.Printf("settings: cannot remove a recent entry: %v", err)
		return err
	}
	return nil
}

// CloseWindow closes the calling window (PRD FR-09, Ctrl+W). The last window
// closes the app, as the window manager would.
func (s *WindowService) CloseWindow(ctx context.Context) error {
	id, ok := s.caller(ctx)
	if !ok {
		return ErrNoCallerWindow
	}
	if _, exists := s.windows.Get(id); !exists {
		return ErrWindowNotOpen
	}
	if s.closeWindow == nil {
		return nil
	}
	return s.closeWindow(id)
}

// CloseDocument drops the window's document: the page returns to its start
// state and the watch ends. A folder stays open (PRD FR-07.5).
func (s *WindowService) CloseDocument(ctx context.Context) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	w.StopWatch()
	w.SetOpenFile("")
	// With a folder still open the resume target becomes the folder; without
	// one there is nothing to restore, so the old file is forgotten.
	if s.state != nil {
		if err := s.state.SetResume(resumeOf(w)); err != nil {
			log.Printf("settings: cannot forget the closed document: %v", err)
		}
	}
	return nil
}

// callerWindow resolves the window a call came from. The window ID the page
// might send is never trusted (CLAUDE.md §5.3).
func (s *WindowService) callerWindow(ctx context.Context) (*winctx.Window, error) {
	id, ok := s.caller(ctx)
	if !ok {
		return nil, ErrNoCallerWindow
	}
	w, ok := s.windows.Get(id)
	if !ok {
		return nil, ErrWindowNotOpen
	}
	return w, nil
}

// Ready is the page's handshake: it identifies the calling window. The page
// then asks for its open requests with Pending, and acknowledges each one.
func (s *WindowService) Ready(ctx context.Context) (contract.ReadyInfo, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ReadyInfo{}, err
	}
	w.MarkReady()
	if !s.startedAt.IsZero() {
		// A machine-readable line for the cold-start measurement; it carries
		// no path or content (CLAUDE.md §6).
		log.Printf("perf: ready window=%d ms=%d", w.ID(), time.Since(s.startedAt).Milliseconds())
	}
	info := contract.ReadyInfo{WindowID: w.ID(), Version: s.version()}
	// The reason a restore fell back to a blank page belongs to this launch,
	// so every handshake of it reports the reason: a page that remounts
	// (React StrictMode in development) must not lose it.
	info.StartupNotice = s.startupNotice
	return info, nil
}

// Pending returns the open requests after seq that the page has not
// acknowledged. A page that remounts or reloads asks again and loses nothing
// (PRD §9.2.3: no request is dropped silently).
func (s *WindowService) Pending(ctx context.Context, after int64) (contract.PendingResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.PendingResult{}, err
	}
	return contract.PendingResult{Requests: openRequests(w.PendingSince(after))}, nil
}

// Ack confirms that the page handled every request up to seq, which frees the
// window's queue.
func (s *WindowService) Ack(ctx context.Context, seq int64) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	w.Ack(seq)
	return nil
}

// openRequests converts queued requests to the page's contract type.
func openRequests(intents []winctx.Intent) []contract.OpenRequest {
	out := make([]contract.OpenRequest, len(intents))
	for i, it := range intents {
		out[i] = contract.OpenRequest{Seq: it.Seq, Path: it.Path}
	}
	return out
}

// NewWindow opens another window (PRD FR-02). The reuse matrix of M2-2 decides
// whether a blank window is taken over instead; the toolbar's "新建窗口" always
// opens one.
func (s *WindowService) NewWindow(ctx context.Context) (contract.NewWindowResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.NewWindowResult{}, err
	}
	id, err := s.open()
	if err != nil {
		// Expected failure: the page shows it and keeps reading (PRD §7.2).
		return contract.NewWindowResult{Failure: &contract.Failure{
			Code:   "window_failed",
			Detail: "无法创建新窗口，请关闭其他窗口后重试",
		}}, nil
	}
	return contract.NewWindowResult{WindowID: id}, nil
}

// resourceURL is where the page fetches a registered resource. WebView2
// answers a custom scheme at <scheme>.localhost (decisions.md D-T01).
func resourceURL(token string) string {
	return "http://" + resource.Scheme + ".localhost/" + token
}

// winctxKindFile keeps the request kinds in one place for this package.
const winctxKindFile = winctx.KindFile
