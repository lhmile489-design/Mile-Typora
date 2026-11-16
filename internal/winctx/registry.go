// Package winctx keeps the per-window context of every open window, keyed by
// the native window's ID (CLAUDE.md §5.2).
package winctx

import (
	"context"
	"sync"
)

// Window is one window's context. Closing its Done channel means the window
// is gone: tasks started for it should stop.
type Window struct {
	id     int
	ctx    context.Context
	cancel context.CancelFunc
	// q holds the open requests that arrive before the page is ready.
	q intentQueue
	// state is what the window is showing. M1-3 tracks the open file, M1-7
	// the watch on it.
	stateMu    sync.Mutex
	refreshSeq int64
	openFile   string
	root       string
	stopWatch  func()
	stopTree   func()
	// What editing knows about the file: whether the buffer differs from
	// disk, the hash it started from, and the format saving must keep.
	dirty      bool
	untitled   bool
	closing    bool
	baseHash   string
	hasBOM     bool
	lineEnding string
	savedHash  string
}

// ID is the native window's ID, as mygo.Window.ID reports it.
func (w *Window) ID() int { return w.id }

// Context is cancelled when the window closes. Bind work that belongs to the
// window to it, so closing the window stops the work.
func (w *Window) Context() context.Context { return w.ctx }

// SetRoot records the folder the window browses, and forgets the file, which
// belonged to the previous folder.
func (w *Window) SetRoot(root string) {
	w.stateMu.Lock()
	w.root = root
	w.openFile = ""
	w.dirty = false
	w.baseHash = ""
	w.hasBOM = false
	w.lineEnding = ""
	w.stateMu.Unlock()
}

// NextRefresh numbers a reload, so a late result never replaces a newer one.
func (w *Window) NextRefresh() int64 {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	w.refreshSeq++
	return w.refreshSeq
}

// IsLatestRefresh reports whether seq is still the newest reload.
func (w *Window) IsLatestRefresh(seq int64) bool {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return seq == w.refreshSeq
}

// IsEmpty reports whether the window shows nothing yet: no document and no
// folder. PRD FR-02 reuses an empty window instead of opening another.
func (w *Window) IsEmpty() bool {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.openFile == "" && w.root == ""
}

// Root is the folder the window browses, if any.
func (w *Window) Root() (string, bool) {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.root, w.root != ""
}

// SetOpenFile records the file the window shows. The path is canonical and was
// authorized by the user's choice in the system dialog.
func (w *Window) SetOpenFile(path string) {
	w.stateMu.Lock()
	w.openFile = path
	if path == "" {
		w.dirty = false
		w.baseHash = ""
		w.hasBOM = false
		w.lineEnding = ""
	}
	w.stateMu.Unlock()
}

// SetEditState records what the page knows: whether its buffer is dirty and
// which file version it started from (PRD 10.2, 10.3).
func (w *Window) SetEditState(dirty bool, hash string, hasBOM bool, lineEnding string) {
	w.stateMu.Lock()
	w.dirty = dirty
	w.baseHash = hash
	w.hasBOM = hasBOM
	w.lineEnding = lineEnding
	w.stateMu.Unlock()
}

// EditState returns the dirty flag and the save baseline.
func (w *Window) EditState() (dirty bool, hash string, hasBOM bool, lineEnding string) {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.dirty, w.baseHash, w.hasBOM, w.lineEnding
}

// SetStartUntitled asks the next page handshake to start an unsaved document.
func (w *Window) SetStartUntitled(start bool) {
	w.stateMu.Lock()
	w.untitled = start
	w.stateMu.Unlock()
}

// StartUntitled reports whether this window should begin with an unsaved
// document. It stays true across ready handshakes (React StrictMode remounts).
func (w *Window) StartUntitled() bool {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.untitled
}

// ClearStartUntitled stops asking for an unsaved document.
func (w *Window) ClearStartUntitled() {
	w.stateMu.Lock()
	w.untitled = false
	w.stateMu.Unlock()
}

// SetClosing marks a close the page already resolved, so the native close
// handler lets it through.
func (w *Window) SetClosing(closing bool) {
	w.stateMu.Lock()
	w.closing = closing
	w.stateMu.Unlock()
}

// Closing reports whether a resolved close is under way.
func (w *Window) Closing() bool {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.closing
}

// SetSavedHash records the hash a save just wrote, so the watch can ignore
// the write it causes itself.
func (w *Window) SetSavedHash(hash string) {
	w.stateMu.Lock()
	w.savedHash = hash
	w.stateMu.Unlock()
}

// SavedHash is the last hash written by a save, if any.
func (w *Window) SavedHash() (string, bool) {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.savedHash, w.savedHash != ""
}

// SetStopWatch records how to stop watching the open file, replacing any
// earlier watch.
func (w *Window) SetStopWatch(stop func()) {
	w.stateMu.Lock()
	previous := w.stopWatch
	w.stopWatch = stop
	w.stateMu.Unlock()
	if previous != nil {
		previous()
	}
}

// StopWatch stops watching the open file, if a watch is running.
func (w *Window) StopWatch() {
	w.stateMu.Lock()
	stop := w.stopWatch
	w.stopWatch = nil
	w.stateMu.Unlock()
	if stop != nil {
		stop()
	}
}

// SetStopTreeWatch records how to stop watching the folder's structure,
// replacing any earlier watch.
func (w *Window) SetStopTreeWatch(stop func()) {
	w.stateMu.Lock()
	previous := w.stopTree
	w.stopTree = stop
	w.stateMu.Unlock()
	if previous != nil {
		previous()
	}
}

// StopTreeWatch stops watching the folder's structure, if a watch is running.
func (w *Window) StopTreeWatch() {
	w.stateMu.Lock()
	stop := w.stopTree
	w.stopTree = nil
	w.stateMu.Unlock()
	if stop != nil {
		stop()
	}
}

// OpenFile is the file the window shows, if any.
func (w *Window) OpenFile() (string, bool) {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	return w.openFile, w.openFile != ""
}

// Registry holds the windows that are open. It is safe for concurrent use:
// native events and page calls arrive on different goroutines.
type Registry struct {
	mu     sync.RWMutex
	byID   map[int]*Window
	closed bool
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{byID: make(map[int]*Window)}
}

// Add registers a window and returns its context. Adding the same ID twice
// keeps the first context, so a repeated registration never cancels work that
// is still running.
func (r *Registry) Add(id int) *Window {
	r.mu.Lock()
	defer r.mu.Unlock()
	if w, ok := r.byID[id]; ok {
		return w
	}
	ctx, cancel := context.WithCancel(context.Background())
	if r.closed {
		cancel()
	}
	w := &Window{id: id, ctx: ctx, cancel: cancel}
	r.byID[id] = w
	return w
}

// Remove forgets a window and cancels its context. It reports whether the
// window was registered.
func (r *Registry) Remove(id int) bool {
	r.mu.Lock()
	w, ok := r.byID[id]
	if ok {
		delete(r.byID, id)
	}
	r.mu.Unlock()
	if ok {
		w.StopWatch()
		w.StopTreeWatch()
		w.cancel()
	}
	return ok
}

// Get returns an open window's context.
func (r *Registry) Get(id int) (*Window, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	w, ok := r.byID[id]
	return w, ok
}

// Len is the number of open windows.
func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byID)
}

// IDs lists the open windows, for logs and tests.
func (r *Registry) IDs() []int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]int, 0, len(r.byID))
	for id := range r.byID {
		ids = append(ids, id)
	}
	return ids
}

// Close cancels every window's context and refuses later registrations. The
// app calls it when it quits.
func (r *Registry) Close() {
	r.mu.Lock()
	r.closed = true
	windows := r.byID
	r.byID = make(map[int]*Window)
	r.mu.Unlock()
	for _, w := range windows {
		w.cancel()
	}
}
