package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
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

	mu          sync.Mutex
	deliver     func(watch.Event)
	starts      int
	stops       int
	treeDeliver func(watch.Event)
	treeStarts  int
	treeStops   int

	treeChanged chan struct{}
	trashed     chan contract.FileTrashed
}

func newRefreshHarness(t *testing.T, id int) *refreshHarness {
	t.Helper()
	reg := winctx.NewRegistry()
	h := &refreshHarness{
		reg:         reg,
		window:      reg.Add(id),
		updates:     make(chan contract.DocUpdate, 8),
		treeChanged: make(chan struct{}, 4),
		trashed:     make(chan contract.FileTrashed, 4),
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
	treePool := watch.NewPool(func(path string, onEvent func(watch.Event)) (func(), error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.treeDeliver = onEvent
		h.treeStarts++
		return func() {
			h.mu.Lock()
			h.treeStops++
			h.mu.Unlock()
		}, nil
	})
	h.service = &WindowService{
		caller:      func(context.Context) (int, bool) { return id, true },
		version:     func() string { return "0.1.0" },
		windows:     reg,
		open:        func() (int, error) { return 0, nil },
		pick:        func(context.Context) (string, error) { return "", nil },
		pickDir:     func(context.Context) (string, error) { return "", nil },
		render:      markdown.New(),
		resources:   resource.New(),
		watcher:     pool,
		treeWatcher: treePool,
		treeChanged: func(int) {
			select {
			case h.treeChanged <- struct{}{}:
			default:
			}
		},
		confirm:  func(context.Context, string, string, string) bool { return false },
		external: func(string) error { return nil },
		docUpdated: func(_ int, update contract.DocUpdate) {
			h.updates <- update
		},
		trash:  func(string) error { return nil },
		reveal: func(string) {},
		fileTrashed: func(_ int, event contract.FileTrashed) {
			h.trashed <- event
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

func (h *refreshHarness) fireTree(event watch.Event) {
	h.mu.Lock()
	deliver := h.treeDeliver
	h.mu.Unlock()
	if deliver == nil {
		panic("no folder watch was started")
	}
	deliver(event)
}

func (h *refreshHarness) treeCounts() (starts, stops int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.treeStarts, h.treeStops
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

func TestOpeningAFolderWatchesItsStructure(t *testing.T) {
	dir := t.TempDir()
	other := t.TempDir()
	h := newRefreshHarness(t, 21)

	if got, err := h.service.openFolderPath(h.window, dir); err != nil || got.Failure != nil {
		t.Fatalf("openFolderPath = %+v, %v", got, err)
	}
	if starts, _ := h.treeCounts(); starts != 1 {
		t.Fatalf("tree watches started %d, want 1", starts)
	}

	h.fireTree(watch.Event{Op: watch.Write})
	select {
	case <-h.treeChanged:
	case <-time.After(2 * time.Second):
		t.Fatal("the page was not told the folder changed")
	}

	// Another folder replaces the watch, releasing the first.
	if got, _ := h.service.openFolderPath(h.window, other); got.Failure != nil {
		t.Fatalf("second openFolderPath failed: %+v", got.Failure)
	}
	if starts, stops := h.treeCounts(); starts != 2 || stops != 1 {
		t.Fatalf("starts/stops = %d/%d, want 2/1", starts, stops)
	}

	h.reg.Remove(h.window.ID())
	if _, stops := h.treeCounts(); stops != 2 {
		t.Fatalf("stops = %d, want the folder watch released with the window", stops)
	}
}

func TestDialogOpenedFolderWatchesAndRecords(t *testing.T) {
	dir := t.TempDir()
	h := newRefreshHarness(t, 30)
	store, err := appstate.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h.service.state = store
	h.service.pickDir = func(context.Context) (string, error) { return dir, nil }

	got, err := h.service.OpenFolderDialog(context.Background())
	if err != nil || got.Failure != nil || got.Root == "" {
		t.Fatalf("OpenFolderDialog = %+v, %v", got, err)
	}
	if starts, _ := h.treeCounts(); starts != 1 {
		t.Fatalf("tree watches started %d, want 1 for a dialog-opened folder", starts)
	}
	recent := store.Get().Recent
	if len(recent) != 1 || recent[0].Path != dir {
		t.Fatalf("recent = %+v, want the dialog folder", recent)
	}
}

func TestTheWatchEndingMarksTheDocumentStale(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# one\n"))
	h := newRefreshHarness(t, 12)

	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	// The folder itself going away ends the watch with Gone, without a
	// Remove for the file in between.
	h.fire(watch.Event{Op: watch.Gone})

	update := waitUpdate(t, h)
	if update.Failure == nil || update.Failure.Code != "not_found" {
		t.Fatalf("update = %+v, want not_found after the watch ended", update)
	}
}

func TestTheFolderWatchEndingMarksTheDocumentStale(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "note.md", []byte("# one\n"))
	h := newRefreshHarness(t, 31)
	if got, _ := h.service.openFolderPath(h.window, dir); got.Failure != nil {
		t.Fatalf("openFolderPath failed: %+v", got.Failure)
	}
	if got, _ := h.service.openPath(context.Background(), h.window, path); got.Failure != nil {
		t.Fatalf("openPath failed: %+v", got.Failure)
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	h.fireTree(watch.Event{Op: watch.Gone})

	update := waitUpdate(t, h)
	if update.Failure == nil || update.Failure.Code != "not_found" {
		t.Fatalf("update = %+v, want not_found after the folder ended", update)
	}
}

// tokenOf pulls the first mtres token out of rendered HTML.
func tokenOf(t *testing.T, html string) string {
	t.Helper()
	const prefix = "http://mtres.localhost/"
	at := strings.Index(html, prefix)
	if at < 0 {
		t.Fatalf("no token URL in %q", html)
	}
	rest := html[at+len(prefix):]
	end := strings.IndexAny(rest, `"'< `)
	if end < 0 {
		end = len(rest)
	}
	return rest[:end]
}

func TestRenderSourceUsesTheFileRenderer(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.png"), tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	docPath := writeSample(t, dir, "note.md", []byte("# 文件\n\n![图](a.png)\n"))
	h := newRefreshHarness(t, 40)

	opened, _ := h.service.openPath(context.Background(), h.window, docPath)
	if opened.Failure != nil {
		t.Fatalf("openPath: %+v", opened.Failure)
	}
	readingToken := tokenOf(t, opened.Doc.HTML)

	got, err := h.service.RenderSource(context.Background(), "# 预览\n\n![图](a.png)\n")
	if err != nil || got.Failure != nil {
		t.Fatalf("RenderSource = %+v, %v", got, err)
	}
	if !strings.Contains(got.HTML, `id="预览"`) {
		t.Fatalf("html = %s, want the edited heading", got.HTML)
	}
	previewToken := tokenOf(t, got.HTML)
	if previewToken == readingToken {
		t.Fatal("preview reused the reading token")
	}
	if _, ok := h.service.resources.Lookup(readingToken); !ok {
		t.Fatal("rendering the preview dropped the reading token")
	}
	if _, ok := h.service.resources.Lookup(previewToken); !ok {
		t.Fatal("the preview image was not registered")
	}

	// A later preview replaces only its own tokens.
	_, _ = h.service.RenderSource(context.Background(), "# 第二次\n")
	if _, ok := h.service.resources.Lookup(previewToken); ok {
		t.Fatal("an old preview token was kept")
	}
	if _, ok := h.service.resources.Lookup(readingToken); !ok {
		t.Fatal("the second preview dropped the reading token")
	}
}

func TestRenderSourceEnforcesLimits(t *testing.T) {
	h := newRefreshHarness(t, 41)
	if got, _ := h.service.RenderSource(context.Background(), strings.Repeat("x", 10<<20+1)); got.Failure == nil || got.Failure.Code != "too_large" {
		t.Fatalf("too large = %+v", got.Failure)
	}
	if got, _ := h.service.RenderSource(context.Background(), "\xff"); got.Failure == nil || got.Failure.Code != "encoding" {
		t.Fatalf("invalid UTF-8 = %+v", got.Failure)
	}
}
