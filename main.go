package main

import (
	"log"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/service"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// windows holds every open window's context (CLAUDE.md §5.2). A window is
// registered as it is created and forgotten when it closes.
var windows = winctx.NewRegistry()

func main() {
	// The single instance lock is the first mygo call (CLAUDE.md §5.1). A
	// second instance passes its command line to the first and exits.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.OnSecondInstance(func(args []string, workingDir string) {
		// M1-2 turns args into open requests; until then, show a window.
		newWindow()
	})

	// Set before the first window so its first frame has the right
	// appearance. M3-3 reads the saved preference instead.
	mygo.Theme.SetSource(mygo.ThemeSystem)

	mygo.Bind(service.NewWindowService(windows, openWindow))

	mygo.App.WhenReady(func() {
		newWindow()
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
	windows.Add(id)
	// Closing the window cancels its context, so work started for it stops.
	w.OnClosed(func() {
		windows.Remove(id)
	})
	return w
}
