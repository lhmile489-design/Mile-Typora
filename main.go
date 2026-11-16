package main

import (
	"errors"
	"log"
	"os"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/service"
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

	mygo.Bind(service.NewWindowService(windows, openWindow, service.PickMarkdown))

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
	})
	id := w.ID()
	ctx := windows.Add(id)
	// A page that is already ready gets later requests as events.
	ctx.SetNotify(func(it winctx.Intent) error {
		return openRequest.Emit(w, contract.OpenRequest{Seq: it.Seq, Path: it.Path})
	})
	// Closing the window cancels its context, so work started for it stops.
	w.OnClosed(func() {
		windows.Remove(id)
	})
	return w
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
