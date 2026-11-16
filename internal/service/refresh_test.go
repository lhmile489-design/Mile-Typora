package service

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/watch"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// refreshHarness builds a service whose watches a test drives itself: the
// starter keeps the fan-out function instead of watching the disk.
type refreshHarness struct {
	service *WindowService
	reg     *winctx.Registry
	window  *winctx.Window
	updates chan contract.DocUpdate

	mu      sync.Mutex
	deliver func(watch.Event)
	starts  int
	stops   int
}

func newRefreshHarness(t *testing.T, id int) *refreshHarness {
	t.Helper()
	reg := winctx.NewRegistry()
	h := &refreshHarness{
		reg:     reg,
		window:  reg.Add(id),
		updates: make(chan contract.DocUpdate, 4),
	}
	pool := watch.NewPool(func(path string, onEvent func(watch.Event)) (func(), error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.deliver = onEvent
		h.starts++
		return func() {
			h.mu.Lock()
			h.stops++
			h.mu.Unlock()
		}, nil
	})
	h.service = &WindowService{
		caller:    func(context.Context) (int, bool) { return id, true },
		version:   func() string { return "0.1.0" },
		windows:   reg,
		open:      func() (int, error) { return 0, nil },
		pick:      func(context.Context) (string, error) { return "", nil },
		pickDir:   func(context.Context) (string, error) { return "", nil },
		render:    markdown.New(),
		resources: resource.New(),
		watcher:   pool,
		confirm:   func(context.Context, string, string, string) bool { return false },
		external:  func(string) error { return nil },
		docUpdated: func(_ int, update contract.DocUpdate) {
			h.updates <- update
		},
	}
	t.Cleanup(reg.Close)
	return h
}

func (h *refreshHarness) fire(event watch.Event) {
	h.mu.Lock()
	deliver := h.deliver
	h.mu.Unlock()
	if deliver == nil {
		panic("no watch was started")
	}
	deliver(event)
}

func (h *refreshHarness) counts() (starts, stops int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.starts, h.stops
}

func waitUpdate(t *testing.T, h *refreshHarness) contract.DocUpdate {
	t.Helper()
	select {
	case update := <-h.updates:
		return update
	case <-time.After(2 * time.Second):
		t.Fatal("the page was not told about the change")
		return contract.DocUpdate{}
	}
}

func TestAnExternalWriteRefreshesTheDocument(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 3)

	if got, err := h.service.openPath(context.Background(), h.window, path); err != nil || got.Failure != nil {
		t.Fatalf("openPath = %+v, %v", got, err)
	}
	if err := os.WriteFile(path, []byte("# 二\n\n改过\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.fire(watch.Event{Op: watch.Write})

	update := waitUpdate(t, h)
	if update.Doc == nil || update.Failure != nil {
		t.Fatalf("update = %+v, want the new document", update)
	}
	if !strings.Contains(update.Doc.HTML, "改过") {
		t.Fatalf("HTML does not hold the new text: %s", update.Doc.HTML)
	}
	if update.Doc.Text == "" || !strings.HasPrefix(update.Doc.Text, "# 二") {
		t.Fatalf("text = %q, want the new source", update.Doc.Text)
	}
}

func TestADeletedFileMarksTheDocumentStale(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 5)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	h.fire(watch.Event{Op: watch.Remove})

	update := waitUpdate(t, h)
	if update.Doc != nil || update.Failure == nil {
		t.Fatalf("update = %+v, want a failure that leaves the old content", update)
	}
	if update.Failure.Code != "not_found" {
		t.Fatalf("code = %q, want not_found", update.Failure.Code)
	}
}

func TestRefreshReadsTheFileAgain(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 6)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	if err := os.WriteFile(path, []byte("# 二\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := h.service.Refresh(context.Background())
	if err != nil || got.Failure != nil {
		t.Fatalf("Refresh = %+v, %v", got, err)
	}
	if got.Doc == nil || !strings.Contains(got.Doc.HTML, "二") {
		t.Fatalf("doc = %+v, want the changed content", got.Doc)
	}
}

func TestRefreshWithoutADocumentSaysSo(t *testing.T) {
	h := newRefreshHarness(t, 7)
	got, err := h.service.Refresh(context.Background())
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "not_found" {
		t.Fatalf("result = %+v, want not_found", got)
	}
}

func TestTwoWindowsShareOneWatch(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 8)
	second := h.reg.Add(9)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("first open failed: %+v", got.Failure)
	}
	// A second window showing the same file subscribes to the same watch.
	if got, _ := h.service.openPath(context.Background(), second, path); got.Failure != nil {
		t.Fatalf("other window open failed: %+v", got.Failure)
	}
	if starts, _ := h.counts(); starts != 1 {
		t.Fatalf("started %d watches for one file, want 1", starts)
	}
}

func TestClosingAWindowReleasesItsWatch(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 10)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	h.reg.Remove(h.window.ID())
	if _, stops := h.counts(); stops != 1 {
		t.Fatalf("stops = %d, want the watch released with the window", stops)
	}
}

func TestCloseDocumentForgetsTheFileAndStopsWatching(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 11)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	if err := h.service.CloseDocument(context.Background()); err != nil {
		t.Fatalf("CloseDocument: %v", err)
	}
	if _, open := h.window.OpenFile(); open {
		t.Fatal("the window still holds a document")
	}
	if _, stops := h.counts(); stops != 1 {
		t.Fatalf("stops = %d, want the watch released", stops)
	}
	if got, _ := h.service.Refresh(context.Background()); got.Failure == nil {
		t.Fatal("Refresh still had a document to read")
	}
}
