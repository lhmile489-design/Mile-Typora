package main

import (
	"errors"
	"log"
	"net/url"
	"os"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/service"
	"github.com/lhmile489-design/mile-typora/internal/watch"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// windows holds every open window's context (CLAUDE.md §5.2). A window is
// registered as it is created and forgotten when it closes.
var windows = winctx.NewRegistry()

// openRequest tells one window to open something after its page is ready.
// Only the target window receives it (CLAUDE.md §5, decisions.md D-T01).
var openRequest = mygo.NewEvent[contract.OpenRequest]("open-request")

func main() {
	// The single instance lock is the first mygo call (CLAUDE.md §5.1). A
	// second instance passes its command line to the first and exits.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.OnSecondInstance(func(args []string, workingDir string) {
		routeOpenRequests(args)
	})

	// Set before the first window so its first frame has the right
	// appearance. M3-3 reads the saved preference instead.
	mygo.Theme.SetSource(mygo.ThemeSystem)

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

	// Images load through the app's own protocol, registered before any
	// window exists (decisions.md D-T01). Only registered files are served.
	resources := resource.New()
	if err := mygo.Protocol.HandleFunc(resource.Scheme, resources.ServeHTTP); err != nil {
		log.Fatal(err)
	}
	mygo.Bind(service.NewWindowService(service.Deps{
		Windows:    windows,
		Open:       openWindow,
		PickFile:   service.PickMarkdown,
		PickFolder: service.PickFolder,
		Resources:  resources,
		Watch:      watch.Start,
		State:      state,
	}))

	mygo.App.WhenReady(func() {
		// The window opened for this launch: its page loads next, so these
		// requests wait in its queue and arrive with the handshake.
		w := newWindow()
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
			DevTools: mygo.DevToolsAuto,
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
	// Closing the window cancels its context, so work started for it stops.
	w.OnClosed(func() {
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

// focusedWindow is the window the user is working in, if any.
func focusedWindow() *mygo.Window {
	all := mygo.Windows()
	for _, w := range all {
		if w.IsFocused() {
			return w
		}
	}
	if len(all) > 0 {
		return all[len(all)-1]
	}
	return nil
}

// enqueue adds open requests to a window's queue. A full queue is reported to
// the user rather than dropping the request silently (PRD §9.2.3).
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
		if _, err := w.Push(path); err != nil {
			if errors.Is(err, winctx.ErrQueueFull) {
				log.Printf("window %d holds %d open requests already", id, winctx.MaxIntents)
				return
			}
			log.Printf("window %d cannot take an open request: %v", id, err)
			return
		}
		// The path is user data: log the count, never the path (CLAUDE.md §6).
		log.Printf("window %d took an open request", id)
	}
}
