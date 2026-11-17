package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/pathguard"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/service"
	"github.com/lhmile489-design/mile-typora/internal/watch"
	"github.com/lhmile489-design/mile-typora/internal/webview"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// appState is the settings store, for the window-time helpers.
var appState *appstate.Store

// startedAt is when the process began, for the startup measurement.
var startedAt = time.Now()

// windowsService is the service the window hooks talk to; main sets it once.
var windowsService *service.WindowService

// printWindowIDs marks the isolated print views. They are mygo windows but not
// app windows: open requests and focus routing must never pick them.
var printWindowIDs sync.Map

func markPrintWindow(id int, active bool) {
	if active {
		printWindowIDs.Store(id, true)
		return
	}
	printWindowIDs.Delete(id)
}

func isPrintWindow(id int) bool {
	_, ok := printWindowIDs.Load(id)
	return ok
}

// startupRequest is one thing a resume launch opens, in order.
type startupRequest struct {
	Kind string
	Path string
}

// startupTarget decides what a resume launch restores, and why it cannot when
// the target is gone (PRD FR-10.6). An empty list with no notice means the
// launch opens a blank page by design.
func startupTarget(state *appstate.Store) ([]startupRequest, string) {
	if state == nil {
		return nil, ""
	}
	settings := state.Get()
	if settings.Startup != appstate.StartupResume || settings.Resume == nil {
		return nil, ""
	}
	target := settings.Resume
	info, err := os.Stat(target.Path)
	if err != nil {
		return nil, "上次阅读的内容已不存在，已打开空白页"
	}
	if target.IsDir {
		if !info.IsDir() {
			return nil, "上次阅读的文件夹已改变，已打开空白页"
		}
		requests := []startupRequest{{Kind: winctx.KindFolder, Path: target.Path}}
		if target.Selected != "" {
			inside := filepath.Join(target.Path, filepath.FromSlash(target.Selected))
			if fi, err := os.Stat(inside); err == nil && !fi.IsDir() {
				requests = append(requests, startupRequest{Kind: winctx.KindFile, Path: inside})
			}
		}
		return requests, ""
	}
	if info.IsDir() || !pathguard.MarkdownExt(target.Path) {
		return nil, "上次阅读的文件已改变，已打开空白页"
	}
	return []startupRequest{{Kind: winctx.KindFile, Path: target.Path}}, ""
}

// windows holds every open window's context (CLAUDE.md §5.2). A window is
// registered as it is created and forgotten when it closes.
var windows = winctx.NewRegistry()

// themeChange tells every window that the appearance preference changed.
var themeChange = mygo.NewEvent[contract.ThemeChange]("theme-change")

// settingsChange tells every window that a shared preference changed.
var settingsChange = mygo.NewEvent[contract.SettingsChange]("settings-changed")

// docUpdated tells one window its document changed outside the app.
var docUpdated = mygo.NewEvent[contract.DocUpdate]("doc-updated")

// fileTrashed tells one window its file went to the recycle bin.
var fileTrashed = mygo.NewEvent[contract.FileTrashed]("file-trashed")

// treeChanged tells one window its folder's structure changed.
var treeChanged = mygo.NewEvent[contract.TreeChanged]("tree-changed")

// appNotice tells one window about something the app refused to do.
var appNotice = mygo.NewEvent[contract.Notice]("app-notice")

// saveAllRequest asks one window to save its dirty buffer.
var saveAllRequest = mygo.NewEvent[contract.SaveAllRequest]("save-all-request")

// saveAllDone gives the aggregate back to the window that started the run.
var saveAllDone = mygo.NewEvent[contract.SaveAllSummary]("save-all-done")

// closeRequested asks a page to run its unsaved-changes prompt before the
// native close goes through.
var closeRequested = mygo.NewEvent[contract.CloseRequested]("close-requested")

// openRequest tells one window to open something after its page is ready.
// Only the target window receives it (CLAUDE.md §5, decisions.md D-T01).
var openRequest = mygo.NewEvent[contract.OpenRequest]("open-request")

func main() {
	// Without the runtime the window would stay blank; tell the user what to
	// install before any window exists (PRD §8.1).
	if !webview.Available() {
		webview.ShowPrompt()
		return
	}

	// The single instance lock is the first mygo call (CLAUDE.md §5.1). A
	// second instance passes its command line to the first and exits.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.OnSecondInstance(func(args []string, workingDir string) {
		routeOpenRequests(args)
	})

	// A packaged app has no console, so measurement runs ask for a log file
	// (docs/develop/性能基线.md). It carries no path or content.
	if path := os.Getenv("MILE_PERF"); path != "" {
		if f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
			log.SetOutput(io.MultiWriter(os.Stderr, f))
			defer f.Close()
		}
	}

	// Settings live in the app's own data directory, never next to the
	// documents (CLAUDE.md §5.7). Without them the app still reads.
	var state *appstate.Store
	if dir, err := mygo.App.Path(mygo.PathUserData); err != nil {
		log.Printf("settings: cannot find the data directory: %v", err)
	} else if opened, err := appstate.Open(dir); err != nil {
		log.Printf("settings: cannot read them, starting with defaults: %v", err)
	} else {
		state = opened
	}
	appState = state

	// The saved preference decides the native appearance before the first
	// window exists (PRD FR-10.12).
	appearance := appstate.AppearanceSystem
	if state != nil {
		appearance = state.Get().Appearance
	}
	applyAppearance(appearance)

	// Images load through the app's own protocol, registered before any
	// window exists (decisions.md D-T01). Only registered files are served.
	resources := resource.New()
	// One watch per file, shared by every window that shows it (PRD FR-07.4).
	watcher := watch.NewPool(func(path string, onEvent func(watch.Event)) (func(), error) {
		return watch.Start(context.Background(), path, onEvent)
	})
	// One recursive watch per folder, shared the same way.
	treeWatcher := watch.NewPool(func(path string, onEvent func(watch.Event)) (func(), error) {
		return watch.StartTree(context.Background(), path, onEvent)
	})
	if err := mygo.Protocol.HandleFunc(resource.Scheme, resources.ServeHTTP); err != nil {
		log.Fatal(err)
	}
	// The resume target decides what the first window shows; an explicit
	// command line (a file association) wins over it (PRD FR-10.8).
	startup := []startupRequest(nil)
	notice := ""
	if len(os.Args) <= 1 {
		startup, notice = startupTarget(state)
	}
	windowsSvc := service.NewWindowService(service.Deps{
		Windows:    windows,
		Open:       openWindow,
		PickFile:   service.PickMarkdown,
		PickFolder: service.PickFolder,
		Resources:  resources,
		Watcher:    watcher,
		DocUpdated: func(windowID int, update contract.DocUpdate) {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					_ = docUpdated.Emit(w, update)
					return
				}
			}
		},
		TreeWatcher: treeWatcher,
		TreeChanged: func(windowID int) {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					_ = treeChanged.Emit(w, contract.TreeChanged{})
					return
				}
			}
		},
		StartedAt:   startedAt,
		PrintRunner: nativePrintRunner{},
		CloseWindow: func(windowID int) error {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					w.Close()
					return nil
				}
			}
			return nil
		},
		State:         state,
		StartupNotice: notice,
		ThemeChanged:  applyAppearance,
		SettingsChanged: func(change contract.SettingsChange) {
			for _, w := range mygo.Windows() {
				if !isPrintWindow(w.ID()) {
					_ = settingsChange.Emit(w, change)
				}
			}
		},
		ViewState: func(windowID int) (contract.WindowViewState, error) {
			w := mygo.WindowByID(windowID)
			if w == nil || isPrintWindow(windowID) {
				return contract.WindowViewState{Failure: &contract.Failure{Code: "view_unavailable", Detail: "窗口视图控制不可用"}}, nil
			}
			return windowViewState(w), nil
		},
		SetFullScreen: func(windowID int, value bool) (contract.WindowViewState, error) {
			w := mygo.WindowByID(windowID)
			if w == nil || isPrintWindow(windowID) {
				return contract.WindowViewState{Failure: &contract.Failure{Code: "view_unavailable", Detail: "窗口视图控制不可用"}}, nil
			}
			w.SetFullScreen(value)
			return windowViewState(w), nil
		},
		SetAlwaysOnTop: func(windowID int, value bool) (contract.WindowViewState, error) {
			w := mygo.WindowByID(windowID)
			if w == nil || isPrintWindow(windowID) {
				return contract.WindowViewState{Failure: &contract.Failure{Code: "view_unavailable", Detail: "窗口视图控制不可用"}}, nil
			}
			w.SetAlwaysOnTop(value)
			return windowViewState(w), nil
		},
		SetZoom: func(windowID int, factor float64) (contract.WindowViewState, error) {
			w := mygo.WindowByID(windowID)
			if w == nil || isPrintWindow(windowID) {
				return contract.WindowViewState{Failure: &contract.Failure{Code: "view_unavailable", Detail: "窗口视图控制不可用"}}, nil
			}
			w.Page().SetZoomFactor(factor)
			return windowViewState(w), nil
		},
		FocusWindow: func(windowID int) bool {
			w := mygo.WindowByID(windowID)
			if w == nil || isPrintWindow(windowID) {
				return false
			}
			w.Focus()
			return true
		},
		SaveAllRequest: func(windowID, requestID int) bool {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					return saveAllRequest.Emit(w, contract.SaveAllRequest{RequestID: requestID}) == nil
				}
			}
			return false
		},
		SaveAllDone: func(windowID int, summary contract.SaveAllSummary) {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					_ = saveAllDone.Emit(w, summary)
					return
				}
			}
		},
		FileTrashed: func(windowID int, event contract.FileTrashed) {
			for _, w := range mygo.Windows() {
				if w.ID() == windowID {
					_ = fileTrashed.Emit(w, event)
					return
				}
			}
		},
	})
	windowsService = windowsSvc
	mygo.Bind(windowsSvc)

	mygo.App.WhenReady(func() {
		// The window opened for this launch: its page loads next, so these
		// requests wait in its queue and arrive with the handshake.
		w := newWindow()
		for _, request := range startup {
			enqueueKind(w.ID(), request.Kind, request.Path)
		}
		enqueue(w.ID(), os.Args[1:])
	})
	// The app quits when its last window closes (PRD FR-02), so there is no
	// OnWindowAllClosed handler.
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
	windows.Close()
}

// openWindow is the opener the WindowService calls. It creates and registers
// a window and returns its ID.
func openWindow() (int, error) {
	return newWindow().ID(), nil
}

// nativePrintRunner renders M5-6's dedicated print view in an isolated mygo
// window. The window is not registered in winctx: it has no document, gets no
// open requests, and exists only until the PDF or print dialog finishes.
type nativePrintRunner struct{}

func (nativePrintRunner) PDF(ctx context.Context, document string) ([]byte, error) {
	return renderPrintView(ctx, document, false)
}

func (nativePrintRunner) Print(ctx context.Context, document string) error {
	_, err := renderPrintView(ctx, document, true)
	return err
}

func renderPrintView(ctx context.Context, document string, show bool) ([]byte, error) {
	options := mygo.WindowOptions{
		Title:           "Mile Typora 打印",
		Width:           1000,
		Height:          1400,
		SkipTaskbar:     true,
		BackgroundColor: "#FFFFFF",
		URL:             "about:blank",
		Page: mygo.PageOptions{
			DevTools:             mygo.DevToolsDisabled,
			BackgroundThrottling: mygo.ThrottlingOff,
			// The page only renders the export document; it never needs the
			// app's bindings, dropped files or custom-scheme reads.
			Untrusted: true,
		},
	}
	if !show {
		// PrintToPDF lays out the real page; a hidden or off-screen window can
		// come back blank. Use an isolated visible window and close it after.
		options.Hidden = false
		options.SkipTaskbar = true
	}
	w := mygo.NewWindow(options)
	printID := w.ID()
	markPrintWindow(printID, true)
	w.OnClosed(func() { markPrintWindow(printID, false) })
	if !show {
		defer w.Close()
	}
	page := w.Page()
	page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if e.URL != "" && e.URL != "about:blank" {
			e.PreventDefault()
		}
	})
	page.OnContextMenu(func(e *mygo.ContextMenuEvent) {
		e.Menu = nil
	})
	if err := waitForInitialPage(ctx, page); err != nil {
		return nil, err
	}
	page.LoadHTML(document, "")
	if err := waitForPrintReady(ctx, page); err != nil {
		return nil, err
	}
	if _, err := page.EvalContext(ctx, `Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, {once: true}); img.addEventListener('error', resolve, {once: true}); }))).then(() => document.fonts.ready).then(() => true)`); err != nil {
		return nil, err
	}
	if show {
		// window.print returns once the preview is requested. Keep this clean
		// document window open: the preview belongs to it, and the user closes
		// it when done. Closing here would cancel the preview.
		page.Print()
		return nil, nil
	}
	type pdfResult struct {
		data []byte
		err  error
	}
	done := make(chan pdfResult, 1)
	go func() {
		data, err := page.PrintToPDF(mygo.PDFOptions{
			PageSize:   mygo.PageA4,
			Margins:    &mygo.Margins{Top: 0.6, Right: 0.6, Bottom: 0.6, Left: 0.6},
			Background: true,
		})
		done <- pdfResult{data: data, err: err}
	}()
	select {
	case result := <-done:
		return result.data, result.err
	case <-ctx.Done():
		// PrintToPDF has no context parameter; closing the window releases
		// WebView2's pending CDP call and keeps exportBusy from wedging.
		w.Close()
		return nil, ctx.Err()
	}
}

// waitForInitialPage waits for the new window's initial about:blank document.
// LoadHTML replaces that document, so it must not race the first navigation.
func waitForInitialPage(ctx context.Context, page *mygo.Page) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(30 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := page.EvalContext(ctx, "document.readyState")
		if err == nil && state == "complete" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// waitForPrintReady polls document.readyState: the page may already be ready
// before an OnDOMReady listener can be registered on a fresh hidden window.
func waitForPrintReady(ctx context.Context, page *mygo.Page) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		ready, err := page.EvalContext(ctx, `document.readyState === "complete" && document.querySelector("main.markdown") !== null`)
		if err == nil && ready == true {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// newWindow opens an empty reader window (DESIGN.md §4, PRD §5.2).
func newWindow() *mygo.Window {
	w := mygo.NewWindow(mygo.WindowOptions{
		Title:     "Mile Typora",
		Width:     1280,
		Height:    800,
		MinWidth:  960,
		MinHeight: 640,
		// --bg-app of the light and dark themes (DESIGN.md §1).
		BackgroundColor: "light-dark(#FFFFFF, #1C1D20)",
		URL:             "/",
		Page: mygo.PageOptions{
			// The inspector is off in builds, and with it the web view's
			// browser keys (decisions.md D-T01).
			DevTools:      mygo.DevToolsAuto,
			PreloadScript: preloadTheme(),
		},
	})
	id := w.ID()
	ctx := windows.Add(id)
	// A page that is already ready gets later requests as events.
	ctx.SetNotify(func(it winctx.Intent) error {
		return openRequest.Emit(w, contract.OpenRequest{Seq: it.Seq, Path: it.Path})
	})
	page := w.Page()
	// The page stays on the app's own content; a link never replaces it
	// (CLAUDE.md §5.9). M2-4 hands external links to the system browser.
	page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if !isAppURL(e.URL) {
			e.PreventDefault()
		}
	})
	// P0 has no context menu of its own, and the web view's offers
	// Reload and Back, which would reload the document on a right-click.
	page.OnContextMenu(func(e *mygo.ContextMenuEvent) {
		e.Menu = nil
	})
	// Coming to the front makes what this window shows the resume target
	// (PRD FR-10.4).
	w.OnFocus(func() {
		if windowsService != nil {
			windowsService.RecordFocus(id)
		}
	})
	// A dirty buffer is the page's call: the native close waits for its
	// save / discard / cancel answer (PRD 10.2).
	w.OnClose(func(e *mygo.CloseEvent) {
		if windowsService == nil || ctx.Closing() {
			return
		}
		if windowsService.WindowDirty(id) {
			e.PreventDefault()
			_ = closeRequested.Emit(w, contract.CloseRequested{})
		}
	})
	// Closing the window cancels its context, so work started for it stops.
	w.OnClosed(func() {
		if windowsService != nil {
			windowsService.SaveAllWindowClosed(id)
		}
		windows.Remove(id)
	})
	return w
}

// isAppURL reports whether the page may navigate to raw: the app's own
// content, and the development server while developing.
func isAppURL(raw string) bool {
	if raw == "" || raw == "about:blank" {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	if host == "mygo.localhost" {
		return true
	}
	return os.Getenv("MYGO_DEV") == "1" && (host == "localhost" || host == "127.0.0.1") && u.Port() == "5273"
}

// routeOpenRequests hands a second instance's command line to the window the
// user is looking at, or to the newest window when none has the focus.
func routeOpenRequests(args []string) {
	if len(args) == 0 {
		return
	}
	w := focusedWindow()
	if w == nil {
		w = newWindow()
	}
	enqueue(w.ID(), args)
}

// notifyWindow shows a short notice in one window's status bar, so a refused
// request is not lost in the log (PRD §9.2.4).
func notifyWindow(id int, text string) {
	for _, w := range mygo.Windows() {
		if w.ID() == id {
			_ = appNotice.Emit(w, contract.Notice{Text: text})
			return
		}
	}
}

// focusedWindow is the window the user is working in, if any.
func focusedWindow() *mygo.Window {
	all := mygo.Windows()
	for _, w := range all {
		if w.IsFocused() && !isPrintWindow(w.ID()) {
			return w
		}
	}
	for i := len(all) - 1; i >= 0; i-- {
		if !isPrintWindow(all[i].ID()) {
			return all[i]
		}
	}
	return nil
}

// enqueue adds open requests to a window's queue. A full queue is reported to
// the user rather than dropping the request silently (PRD §9.2.3).
// windowViewState reads the per-window values the View menu shows.
func windowViewState(w *mygo.Window) contract.WindowViewState {
	return contract.WindowViewState{
		FullScreen:  w.IsFullScreen(),
		AlwaysOnTop: w.IsAlwaysOnTop(),
		Zoom:        w.Page().ZoomFactor(),
	}
}

// applyAppearance switches every open window at once: the native controls
// through Theme.SetSource, and each page through an event (PRD FR-10.12).
func applyAppearance(appearance string) {
	switch appearance {
	case appstate.AppearanceLight:
		mygo.Theme.SetSource(mygo.ThemeLight)
	case appstate.AppearanceDark:
		mygo.Theme.SetSource(mygo.ThemeDark)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
	for _, w := range mygo.Windows() {
		_ = themeChange.Emit(w, contract.ThemeChange{Appearance: appearance})
	}
}

// preloadTheme sets the theme before the page's first paint when the user
// chose one, so an explicit light or dark preference never flashes the other
// (DESIGN.md §1). With "system" the page's own script follows the desktop.
func preloadTheme() string {
	if appState == nil {
		return ""
	}
	switch appState.Get().Appearance {
	case appstate.AppearanceLight:
		return `document.documentElement.dataset.theme = "light";`
	case appstate.AppearanceDark:
		return `document.documentElement.dataset.theme = "dark";`
	default:
		return ""
	}
}

// enqueueKind adds one open request of a kind to a window.
func enqueueKind(id int, kind, path string) {
	w, ok := windows.Get(id)
	if !ok {
		return
	}
	if _, err := w.PushKind(kind, path); err != nil {
		log.Printf("window %d cannot take an open request: %v", id, err)
		notifyWindow(id, "打开请求太多，请稍后再试")
	}
}

func enqueue(id int, paths []string) {
	w, ok := windows.Get(id)
	if !ok {
		log.Printf("open request for unknown window %d dropped", id)
		return
	}
	for _, path := range paths {
		if path == "" {
			continue
		}
		// A folder argument opens the folder, not an error: the command line
		// and a drop on the executable ask for what the path is.
		kind := winctx.KindFile
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			kind = winctx.KindFolder
		}
		if _, err := w.PushKind(kind, path); err != nil {
			if errors.Is(err, winctx.ErrQueueFull) {
				log.Printf("window %d holds %d open requests already", id, winctx.MaxIntents)
				notifyWindow(id, "打开请求太多，请稍后再试")
				return
			}
			log.Printf("window %d cannot take an open request: %v", id, err)
			notifyWindow(id, "无法接受这次打开请求")
			return
		}
		// The path is user data: log the count, never the path (CLAUDE.md §6).
		log.Printf("window %d took an open request", id)
	}
}
