// Package watch reports changes to a document's file, so the page can refresh
// it (PRD FR-07). M1-7 proves the platform delivers the events; M3-4 turns
// them into automatic refreshes.
package watch

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/egoist/mygo"
)

// Op is what happened to the file.
type Op string

const (
	// Write means the file's content may have changed, including a save that
	// replaced it (PRD FR-07.1).
	Write Op = "write"
	// Remove means the file is gone.
	Remove Op = "remove"
	// Gone means the watch ended: its directory went away, or the app is
	// shutting down.
	Gone Op = "gone"
)

// Event is one change to the watched file.
type Event struct {
	Op Op
	// Path is relative to the watched directory, with slashes. It is the
	// document's name, never an absolute path (CLAUDE.md §6).
	Path string
}

// Debounce groups a burst of writes, as an editor's save makes, into one
// event. PRD FR-07 asks for a refresh within 2 seconds of a stable write.
const Debounce = 80 * time.Millisecond

// ErrLoopStopped means the app is quitting and takes no new watches.
var ErrLoopStopped = errors.New("watch: app is stopping")

// Start watches the file at path and calls onEvent for each change, on its
// own goroutine, until the returned stop is called or ctx ends. The watch
// follows the file through its directory, so an editor that saves by
// replacing the file is reported as a write.
func Start(ctx context.Context, path string, onEvent func(Event)) (stop func(), err error) {
	if ctx == nil {
		return nil, errors.New("watch: nil context")
	}
	ctx, cancel := context.WithCancel(ctx)
	w, err := mygo.WatchFiles(ctx, path, mygo.FileWatchOptions{
		Debounce: Debounce,
		// One document's directory holds few files; the default limit of
		// 8192 entries is generous for it.
		MaxEntries: 4096,
	})
	if err != nil {
		cancel()
		return nil, err
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			events, err := w.Next(ctx)
			if err != nil {
				if errors.Is(err, io.EOF) {
					onEvent(Event{Op: Gone})
					return
				}
				// A cancelled context is a normal stop.
				return
			}
			for _, ev := range events {
				if op, ok := mapOp(ev.Op); ok {
					onEvent(Event{Op: op, Path: ev.Path})
				}
			}
		}
	}()

	return func() {
		cancel()
		_ = w.Close()
		<-done
	}, nil
}

// TreeDebounce groups a burst of directory changes; one rescan is heavier
// than one file reload.
const TreeDebounce = 200 * time.Millisecond

// TreeMaxEntries bounds the directories one tree watch enrolls. A root with
// more is not watched; the page still refreshes with F5.
const TreeMaxEntries = 32768

// StartTree watches the folders under root and reports a structural change:
// a file or folder appeared, went away, or was renamed. A write to a file is
// the file watch's business, not the tree's. The watch ends with Gone when
// the root itself goes away.
func StartTree(ctx context.Context, root string, onEvent func(Event)) (stop func(), err error) {
	if ctx == nil {
		return nil, errors.New("watch: nil context")
	}
	ctx, cancel := context.WithCancel(ctx)
	w, err := mygo.WatchFiles(ctx, root, mygo.FileWatchOptions{
		Recursive:  true,
		Debounce:   TreeDebounce,
		MaxDelay:   time.Second,
		MaxEntries: TreeMaxEntries,
	})
	if err != nil {
		cancel()
		return nil, err
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			events, err := w.Next(ctx)
			if err != nil {
				if errors.Is(err, io.EOF) {
					onEvent(Event{Op: Gone})
					return
				}
				return
			}
			for _, ev := range events {
				switch ev.Op {
				case mygo.FileCreate, mygo.FileRemove, mygo.FileRename:
					// The tree only cares that the structure moved.
					onEvent(Event{Op: Write, Path: ev.Path})
				}
			}
		}
	}()

	return func() {
		cancel()
		_ = w.Close()
		<-done
	}, nil
}

// mapOp turns a platform event into the one the page will act on. A create and
// a rename matter as a write: the file's content is what the reader shows.
func mapOp(op mygo.FileOp) (Op, bool) {
	switch op {
	case mygo.FileWrite, mygo.FileCreate, mygo.FileRename:
		return Write, true
	case mygo.FileRemove:
		return Remove, true
	}
	return "", false
}
