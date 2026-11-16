package winctx

import (
	"errors"
	"sync"
)

// ErrQueueFull means a window holds as many unacknowledged open requests as it
// may. The caller reports it to the user; requests the page has not confirmed
// are never dropped for it (PRD §9.2.3).
var ErrQueueFull = errors.New("open request queue is full")

// MaxIntents is how many unacknowledged requests one window may hold.
const MaxIntents = 32

// Intent is one request to open something. Path is a command-line argument
// now; from M1-3 it is a file or folder the page asks for.
type Intent struct {
	// Seq orders requests within a window. The page drops anything it has
	// already handled, whatever order the transports deliver them in.
	Seq  int64
	Path string
}

// intentQueue is the source of truth for a window's open requests. A request
// stays here until the page acknowledges it, so a handshake response or an
// event that never arrives (a page remounting, a reload) loses nothing; the
// page finds it again from its acknowledged position.
type intentQueue struct {
	mu      sync.Mutex
	items   []Intent
	nextSeq int64
	acked   int64
	ready   bool
	notify  func(Intent) error
}

// SetNotify installs the delivery to the page. With none, requests only wait.
func (w *Window) SetNotify(fn func(Intent) error) {
	w.q.mu.Lock()
	w.q.notify = fn
	w.q.mu.Unlock()
}

// Push adds an open request and, once the page is ready, tells it to look.
// The request stays until acknowledged, so a failed delivery is not a loss.
func (w *Window) Push(path string) (Intent, error) {
	w.q.mu.Lock()
	defer w.q.mu.Unlock()
	w.q.nextSeq++
	it := Intent{Seq: w.q.nextSeq, Path: path}
	if len(w.q.items) >= MaxIntents {
		return Intent{}, ErrQueueFull
	}
	w.q.items = append(w.q.items, it)
	if w.q.ready && w.q.notify != nil {
		// Under the lock so concurrent pushes keep their order; notify only
		// posts an event and never calls back here.
		_ = w.q.notify(it)
	}
	return it, nil
}

// MarkReady is the page's handshake. Requests stay queued until the page
// acknowledges them, so it can ask again after a remount.
func (w *Window) MarkReady() {
	w.q.mu.Lock()
	w.q.ready = true
	w.q.mu.Unlock()
}

// PendingSince returns the requests after seq, in order.
func (w *Window) PendingSince(after int64) []Intent {
	w.q.mu.Lock()
	defer w.q.mu.Unlock()
	if after < w.q.acked {
		after = w.q.acked
	}
	out := make([]Intent, 0, len(w.q.items))
	for _, it := range w.q.items {
		if it.Seq > after {
			out = append(out, it)
		}
	}
	return out
}

// Ack records that the page handled every request up to seq, which frees the
// queue. An older seq changes nothing.
func (w *Window) Ack(seq int64) {
	w.q.mu.Lock()
	defer w.q.mu.Unlock()
	if seq <= w.q.acked {
		return
	}
	w.q.acked = seq
	kept := w.q.items[:0]
	for _, it := range w.q.items {
		if it.Seq > seq {
			kept = append(kept, it)
		}
	}
	w.q.items = kept
}

// Pending is how many requests wait for the page's acknowledgement.
func (w *Window) Pending() int {
	w.q.mu.Lock()
	defer w.q.mu.Unlock()
	return len(w.q.items)
}

// PageReady reports whether the page finished its handshake.
func (w *Window) PageReady() bool {
	w.q.mu.Lock()
	defer w.q.mu.Unlock()
	return w.q.ready
}

// Unready returns the window to the loading state, for a reloaded page that
// has not yet handshaked.
func (w *Window) Unready() {
	w.q.mu.Lock()
	w.q.ready = false
	w.q.mu.Unlock()
}
