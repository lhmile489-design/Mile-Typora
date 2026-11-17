package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
	"github.com/lhmile489-design/mile-typora/internal/resource"
	"github.com/lhmile489-design/mile-typora/internal/scan"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

// tinyPNG is a real one-pixel PNG, so checks that decode it pass.
func tinyPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newTestService(callerID int, registered bool) (*WindowService, *winctx.Registry) {
	reg := winctx.NewRegistry()
	if registered {
		reg.Add(callerID)
	}
	return &WindowService{
		caller:    func(context.Context) (int, bool) { return callerID, true },
		version:   func() string { return "0.1.0" },
		windows:   reg,
		open:      func() (int, error) { return 99, nil },
		pick:      func(context.Context) (string, error) { return "", nil },
		pickDir:   func(context.Context) (string, error) { return "", nil },
		render:    markdown.New(),
		resources: resource.New(),
		confirm:   func(context.Context, string, string, string) bool { return false },
		external:  func(string) error { return nil },
	}, reg
}

func TestReadyReturnsCallerWindow(t *testing.T) {
	s, _ := newTestService(7, true)
	got, err := s.Ready(context.Background())
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got.WindowID != 7 || got.Version != "0.1.0" {
		t.Fatalf("Ready = %+v, want window 7 version 0.1.0", got)
	}
}

func TestReadyWithoutCallerWindow(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func TestReadyForUnregisteredWindow(t *testing.T) {
	s, _ := newTestService(5, false)
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrWindowNotOpen) {
		t.Fatalf("Ready error = %v, want ErrWindowNotOpen", err)
	}
}

func TestNewWindowWindowOpensAndRegisters(t *testing.T) {
	s, reg := newTestService(1, true)
	opened := 0
	s.open = func() (int, error) {
		opened++
		id := 100 + opened
		reg.Add(id) // main registers a window as it creates it
		return id, nil
	}
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("NewWindow failure = %+v, want none", got.Failure)
	}
	if got.WindowID != 101 {
		t.Fatalf("NewWindow window = %d, want 101", got.WindowID)
	}
	if reg.Len() != 2 {
		t.Fatalf("registry has %d windows, want 2", reg.Len())
	}
}

func TestNewWindowReportsExpectedFailure(t *testing.T) {
	s, _ := newTestService(1, true)
	s.open = func() (int, error) { return 0, errors.New("no display") }
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow returned an unexpected error: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "window_failed" || got.Failure.Detail == "" {
		t.Fatalf("NewWindow = %+v, want a window_failed failure with a detail", got)
	}
}

func TestPendingReturnsQueuedRequestsInOrder(t *testing.T) {
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	for _, p := range []string{"a.md", "b.md"} {
		if _, err := w.Push(p); err != nil {
			t.Fatalf("Push(%q): %v", p, err)
		}
	}
	if _, err := s.Ready(context.Background()); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	got, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(got.Requests) != 2 || got.Requests[0].Path != "a.md" || got.Requests[1].Path != "b.md" {
		t.Fatalf("Pending requests = %+v, want a.md then b.md", got.Requests)
	}
	// Asking again, as a remounted page does, still returns them.
	again, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("second Pending: %v", err)
	}
	if len(again.Requests) != 2 {
		t.Fatalf("second Pending returned %d requests, want both again", len(again.Requests))
	}
	if err := s.Ack(context.Background(), 2); err != nil {
		t.Fatalf("Ack: %v", err)
	}
	after, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending after Ack: %v", err)
	}
	if len(after.Requests) != 0 {
		t.Fatalf("Pending after Ack = %+v, want none", after.Requests)
	}
}

func TestNewWindowRequiresCaller(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.NewWindow(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("NewWindow error = %v, want ErrNoCallerWindow", err)
	}
}

func TestNewWindowServiceOutsideCall(t *testing.T) {
	// A context that did not come from a page call has no window.
	s := NewWindowService(Deps{Windows: winctx.NewRegistry(), Open: func() (int, error) { return 1, nil }, Resources: resource.New()})
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func writeSample(t *testing.T, dir, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenFileDialogReadsTheChosenFile(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 标题\n正文\n"))
	s, reg := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("failure = %+v, want none", got.Failure)
	}
	if got.Doc == nil || got.Doc.Name != "笔记.md" || !strings.HasPrefix(got.Doc.Text, "# 标题") {
		t.Fatalf("doc = %+v, want the chosen file's content", got.Doc)
	}
	if !strings.Contains(got.Doc.HTML, `id="标题"`) {
		t.Fatalf("html = %q, want the rendered heading", got.Doc.HTML)
	}
	if got.Doc.LineEnding != "LF" || got.Doc.Size != int64(len("# 标题\n正文\n")) {
		t.Fatalf("doc = %+v, want LF and the file's size", got.Doc)
	}
	w, _ := reg.Get(1)
	if open, ok := w.OpenFile(); !ok || open == "" {
		t.Fatal("the window did not record the open file")
	}
}

func TestOpenFileDialogCancelledChangesNothing(t *testing.T) {
	s, reg := newTestService(1, true)
	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Doc != nil || got.Failure != nil {
		t.Fatalf("result = %+v, want an empty result for a cancelled dialog", got)
	}
	if w, _ := reg.Get(1); w.PageReady() || func() bool { _, ok := w.OpenFile(); return ok }() {
		t.Fatal("a cancelled dialog changed the window")
	}
}

func TestOpenFileDialogRejectsOtherFileTypes(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "notes.txt", []byte("plain"))
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "unsupported_type" {
		t.Fatalf("failure = %+v, want unsupported_type", got.Failure)
	}
}

func TestOpenFileDialogReportsEncoding(t *testing.T) {
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) {
		return filepath.Join("..", "..", "testdata", "docs", "invalid-utf8.md"), nil
	}
	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "encoding" || got.Failure.Detail == "" {
		t.Fatalf("failure = %+v, want encoding with a detail", got.Failure)
	}
}

func TestOpenFileDialogReportsMissingFile(t *testing.T) {
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return filepath.Join(t.TempDir(), "gone.md"), nil }
	got, _ := s.OpenFileDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "not_found" {
		t.Fatalf("failure = %+v, want not_found", got.Failure)
	}
}

func TestImageResolverScope(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "images")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	pngBytes := tinyPNG(t)
	if err := os.WriteFile(filepath.Join(sub, "a.png"), pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	s, _ := newTestService(1, true)
	resolve := s.imageResolver(1, dir)

	if url, reason := resolve("images/a.png"); !strings.HasPrefix(url, "http://mtres.localhost/") || reason != "" {
		t.Fatalf("inside image: %q %q, want a token URL", url, reason)
	}
	for ref, wantReason := range map[string]string{
		"https://example.com/x.png":    "远程图片未加载",
		"javascript:alert(1)":          "不支持此图片地址",
		"b.svg":                        "不支持的图片格式",
		"missing.png":                  "图片不存在",
		"../" + filepath.Base(outside): "只能显示文档目录内的图片",
		"images/../../x.png":           "只能显示文档目录内的图片",
		"":                             "图片地址为空",
	} {
		url, reason := resolve(ref)
		if url != "" || reason != wantReason {
			t.Errorf("resolve(%q) = %q, %q; want %q", ref, url, reason, wantReason)
		}
	}
}

func TestImageResolverRejectsADamagedImage(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.png"), []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, _ := newTestService(1, true)
	url, reason := s.imageResolver(1, dir)("bad.png")
	if url != "" || reason != "不支持的图片格式" {
		t.Fatalf("resolve = %q, %q; want a local reason", url, reason)
	}
}

func TestOpenFileDialogServesImagesThroughTokens(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "图.png"), tinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(dir, "笔记.md")
	if err := os.WriteFile(docPath, []byte("# 图\n\n![图](图.png)\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, _ := newTestService(1, true)
	s.pick = func(context.Context) (string, error) { return docPath, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Failure != nil || got.Doc == nil {
		t.Fatalf("result = %+v, want a document", got)
	}
	if !strings.Contains(got.Doc.HTML, "http://mtres.localhost/") {
		t.Fatalf("html = %s, want a token URL for the image", got.Doc.HTML)
	}
	if strings.Contains(got.Doc.HTML, "图.png\"") {
		t.Fatalf("the raw image path reached the page: %s", got.Doc.HTML)
	}
}

func TestOpenFolderDialogSetsTheWindowRoot(t *testing.T) {
	dir := t.TempDir()
	s, reg := newTestService(1, true)
	s.pickDir = func(context.Context) (string, error) { return dir, nil }

	got, err := s.OpenFolderDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFolderDialog: %v", err)
	}
	if got.Failure != nil || got.Root == "" {
		t.Fatalf("result = %+v, want a root", got)
	}
	w, _ := reg.Get(1)
	if root, ok := w.Root(); !ok || root != got.Root {
		t.Fatalf("window root = %q, %v; want %q", root, ok, got.Root)
	}
}

func TestOpenFolderDialogRejectsAFile(t *testing.T) {
	dir := t.TempDir()
	file := writeSample(t, dir, "a.md", []byte("# a"))
	s, _ := newTestService(1, true)
	s.pickDir = func(context.Context) (string, error) { return file, nil }

	got, _ := s.OpenFolderDialog(context.Background())
	if got.Failure == nil || got.Failure.Code != "unsupported_type" {
		t.Fatalf("failure = %+v, want unsupported_type", got.Failure)
	}
}

func TestOpenFolderDialogCancelled(t *testing.T) {
	s, reg := newTestService(1, true)
	got, err := s.OpenFolderDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFolderDialog: %v", err)
	}
	if got.Root != "" || got.Failure != nil {
		t.Fatalf("result = %+v, want an empty result", got)
	}
	if w, _ := reg.Get(1); func() bool { _, ok := w.Root(); return ok }() {
		t.Fatal("a cancelled dialog set a root")
	}
}

func TestScanWithoutRootReportsIt(t *testing.T) {
	s, _ := newTestService(1, true)
	// A channel that takes nothing: the frame is dropped, but the call must
	// still answer without an error.
	if err := s.Scan(context.Background(), &mygo.Channel[contract.ScanFrame]{}); err != nil {
		t.Fatalf("Scan: %v", err)
	}
}

func TestScanFramesBatching(t *testing.T) {
	entries := make([]scan.Entry, ScanBatch*2+1)
	for i := range entries {
		entries[i] = scan.Entry{Path: fmt.Sprintf("%d.md", i), Name: fmt.Sprintf("%d.md", i)}
	}
	frames := scanFrames(scan.Result{Entries: entries, Truncated: true, Bound: "entries", Skipped: 2, Unreadable: 1})
	if len(frames) != 4 {
		t.Fatalf("frames = %d, want 4 (3 batches and a done frame)", len(frames))
	}
	total := 0
	for _, f := range frames[:3] {
		total += len(f.Entries)
	}
	if total != len(entries) {
		t.Fatalf("entries in frames = %d, want %d", total, len(entries))
	}
	last := frames[len(frames)-1]
	if !last.Done || !last.Truncated || last.Bound != "entries" || last.Skipped != 2 || last.Unreadable != 1 {
		t.Fatalf("last frame = %+v, want the outcome", last)
	}
}

func TestOpenRequestedOpensTheQueuedPath(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "关联.md", []byte("# 关联打开\n"))
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	request, err := w.Push(path)
	if err != nil {
		t.Fatalf("Push: %v", err)
	}

	got, callErr := s.OpenRequested(context.Background(), request.Seq)
	if callErr != nil {
		t.Fatalf("OpenRequested: %v", callErr)
	}
	if got.Failure != nil || got.Doc == nil || got.Doc.Name != "关联.md" {
		t.Fatalf("result = %+v, want the document", got)
	}
	if _, still := w.Intent(request.Seq); still {
		t.Fatal("the request was not acknowledged")
	}
}

func TestOpenRequestedAgainReturnsTheSameDocument(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "a.md", []byte("# a\n"))
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	request, _ := w.Push(path)
	if _, err := s.OpenRequested(context.Background(), request.Seq); err != nil {
		t.Fatal(err)
	}
	// A page that remounted asks again with the same seq.
	again, err := s.OpenRequested(context.Background(), request.Seq)
	if err != nil {
		t.Fatalf("second OpenRequested: %v", err)
	}
	if again.Failure != nil || again.Doc == nil || again.Doc.Name != "a.md" {
		t.Fatalf("result = %+v, want the document again", again)
	}
}

func TestOpenRequestedWithoutAnythingOpen(t *testing.T) {
	s, _ := newTestService(1, true)
	got, err := s.OpenRequested(context.Background(), 99)
	if err != nil {
		t.Fatalf("OpenRequested: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "request_expired" {
		t.Fatalf("failure = %+v, want request_expired", got.Failure)
	}
}

func TestOpenRequestedReportsAMissingFile(t *testing.T) {
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	request, _ := w.Push(filepath.Join(t.TempDir(), "gone.md"))
	got, err := s.OpenRequested(context.Background(), request.Seq)
	if err != nil {
		t.Fatalf("OpenRequested: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "not_found" {
		t.Fatalf("failure = %+v, want not_found", got.Failure)
	}
	if _, still := w.Intent(request.Seq); still {
		t.Fatal("a failed request was not acknowledged")
	}
}

// registerOpener makes the service's opener create a window in the registry,
// as main does.
func registerOpener(s *WindowService, reg *winctx.Registry) *int {
	opened := 0
	s.open = func() (int, error) {
		opened++
		id := 100 + opened
		reg.Add(id)
		return id, nil
	}
	return &opened
}

func TestBlankWindowOpensInPlace(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "a.md", []byte("# a\n"))
	s, reg := newTestService(1, true)
	opened := registerOpener(s, reg)
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil || got.Doc == nil {
		t.Fatalf("result = %+v, err = %v; want the document here", got, err)
	}
	if *opened != 0 {
		t.Fatalf("opened %d windows, want none for a blank window", *opened)
	}
}

func TestWindowShowingSomethingOpensAFileInANewWindow(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "b.md", []byte("# b\n"))
	s, reg := newTestService(1, true)
	opened := registerOpener(s, reg)
	w, _ := reg.Get(1)
	w.SetOpenFile(filepath.Join(dir, "a.md")) // the window already shows a file
	s.pick = func(context.Context) (string, error) { return path, nil }

	got, err := s.OpenFileDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFileDialog: %v", err)
	}
	if got.Doc != nil {
		t.Fatalf("result = %+v, want nothing opened in this window", got)
	}
	if *opened != 1 {
		t.Fatalf("opened %d windows, want 1", *opened)
	}
	other, ok := reg.Get(101)
	if !ok {
		t.Fatal("the new window is not registered")
	}
	if other.Pending() != 1 {
		t.Fatalf("the new window holds %d requests, want the file", other.Pending())
	}
	request, _ := other.PendingSince(0)[0].Path, true
	if request != path {
		t.Fatalf("request path = %q, want %q", request, path)
	}
}

func TestWindowShowingSomethingOpensAFolderInANewWindow(t *testing.T) {
	folder := t.TempDir()
	s, reg := newTestService(1, true)
	opened := registerOpener(s, reg)
	w, _ := reg.Get(1)
	w.SetRoot(t.TempDir())
	s.pickDir = func(context.Context) (string, error) { return folder, nil }

	got, err := s.OpenFolderDialog(context.Background())
	if err != nil {
		t.Fatalf("OpenFolderDialog: %v", err)
	}
	if got.Root != "" {
		t.Fatalf("result = %+v, want the folder handed to a new window", got)
	}
	if *opened != 1 {
		t.Fatalf("opened %d windows, want 1", *opened)
	}
	other, _ := reg.Get(101)
	requests := other.PendingSince(0)
	if len(requests) != 1 || requests[0].Kind != winctx.KindFolder {
		t.Fatalf("requests = %+v, want one folder request", requests)
	}
}

func TestOpenRequestedOpensAFolder(t *testing.T) {
	folder := t.TempDir()
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	request, _ := w.PushKind(winctx.KindFolder, folder)

	got, err := s.OpenRequested(context.Background(), request.Seq)
	if err != nil {
		t.Fatalf("OpenRequested: %v", err)
	}
	if got.Kind != "folder" || got.Folder == nil || got.Folder.Root == "" {
		t.Fatalf("result = %+v, want the folder", got)
	}
	if root, ok := w.Root(); !ok || root == "" {
		t.Fatal("the window root was not set")
	}
}

func TestOpenTreeFileStaysInTheFolder(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := writeSample(t, filepath.Join(root, "sub"), "c.md", []byte("# c\n"))
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	got, err := s.OpenTreeFile(context.Background(), "sub/c.md", false)
	if err != nil {
		t.Fatalf("OpenTreeFile: %v", err)
	}
	if got.Doc == nil || got.Doc.Path != path {
		t.Fatalf("result = %+v, want the document", got)
	}

	outside := filepath.Join("..", filepath.Base(root), "..", "x.md")
	if got, _ := s.OpenTreeFile(context.Background(), outside, false); got.Failure == nil || got.Failure.Code != "out_of_scope" {
		t.Fatalf("result = %+v, want out_of_scope", got)
	}
}

func TestOpenTreeFileInANewWindow(t *testing.T) {
	root := t.TempDir()
	writeSample(t, root, "d.md", []byte("# d\n"))
	s, reg := newTestService(1, true)
	opened := registerOpener(s, reg)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	got, err := s.OpenTreeFile(context.Background(), "d.md", true)
	if err != nil {
		t.Fatalf("OpenTreeFile: %v", err)
	}
	if got.Doc != nil || got.Kind != "" {
		t.Fatalf("result = %+v, want the file handed to a new window", got)
	}
	if *opened != 1 {
		t.Fatalf("opened %d windows, want 1", *opened)
	}
	// The original window keeps its folder.
	if r, ok := w.Root(); !ok || r != root {
		t.Fatalf("root = %q, %v; want %q kept", r, ok, root)
	}
}

func TestOpenLinkAnchor(t *testing.T) {
	s, _ := newTestService(1, true)
	got, err := s.OpenLink(context.Background(), "#安装步骤")
	if err != nil {
		t.Fatalf("OpenLink: %v", err)
	}
	if got.Kind != "anchor" || got.Anchor != "安装步骤" {
		t.Fatalf("target = %+v, want the anchor", got)
	}
}

func TestOpenLinkExternalNeedsConfirmation(t *testing.T) {
	s, _ := newTestService(1, true)
	opened := ""
	s.external = func(url string) error { opened = url; return nil }

	// Declining leaves the browser alone.
	s.confirm = func(context.Context, string, string, string) bool { return false }
	if got, _ := s.OpenLink(context.Background(), "https://example.com/a"); got.Kind != "cancelled" {
		t.Fatalf("target = %+v, want cancelled", got)
	}
	if opened != "" {
		t.Fatal("the browser was opened without confirmation")
	}

	s.confirm = func(context.Context, string, string, string) bool { return true }
	if got, _ := s.OpenLink(context.Background(), "https://example.com/a"); got.Kind != "handled" {
		t.Fatalf("target = %+v, want handled", got)
	}
	if opened != "https://example.com/a" {
		t.Fatalf("opened %q, want the link", opened)
	}
}

func TestOpenLinkRefusesDangerousSchemes(t *testing.T) {
	s, _ := newTestService(1, true)
	confirmed := false
	s.confirm = func(context.Context, string, string, string) bool { confirmed = true; return true }
	for _, href := range []string{"javascript:alert(1)", "data:text/html,x", "file:///C:/a.md", "mtres://localhost/x"} {
		got, _ := s.OpenLink(context.Background(), href)
		if got.Kind != "blocked" {
			t.Errorf("OpenLink(%q) = %+v, want blocked", href, got)
		}
	}
	if confirmed {
		t.Fatal("a dangerous link asked for confirmation")
	}
}

func TestOpenLinkDocumentInsideTheFolder(t *testing.T) {
	root := t.TempDir()
	writeSample(t, root, "a b.md", []byte("# a\n"))
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	got, err := s.OpenLink(context.Background(), "a%20b.md")
	if err != nil {
		t.Fatalf("OpenLink: %v", err)
	}
	if got.Kind != "document" || got.Rel != "a b.md" {
		t.Fatalf("target = %+v, want the document's relative path", got)
	}
}

func TestOpenLinkAttachment(t *testing.T) {
	root := t.TempDir()
	writeSample(t, root, "x.png", []byte("png"))
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	got, _ := s.OpenLink(context.Background(), "x.png")
	if got.Kind != "attachment" || got.Reason == "" {
		t.Fatalf("target = %+v, want an attachment note", got)
	}
}

func TestOpenLinkMissingDocument(t *testing.T) {
	root := t.TempDir()
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	if got, _ := s.OpenLink(context.Background(), "gone.md"); got.Kind != "blocked" {
		t.Fatalf("target = %+v, want blocked", got)
	}
}

func TestOpenLinkOutsideTheFolderNeedsConfirmation(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := writeSample(t, outside, "other.md", []byte("# o\n"))
	_ = target
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	w.SetRoot(root)

	// The path climbs out of the folder, so it is refused outright.
	if got, _ := s.OpenLink(context.Background(), "../other.md"); got.Kind != "blocked" {
		t.Fatalf("target = %+v, want blocked for a climbing link", got)
	}
}

func withState(t *testing.T, s *WindowService) *appstate.Store {
	t.Helper()
	store, err := appstate.Open(t.TempDir())
	if err != nil {
		t.Fatalf("appstate.Open: %v", err)
	}
	s.state = store
	return store
}

func TestSettingsWithoutAStore(t *testing.T) {
	s, _ := newTestService(1, true)
	got, err := s.GetSettings(context.Background())
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "settings_unavailable" {
		t.Fatalf("result = %+v, want settings_unavailable", got)
	}
	if got.Settings.Startup != appstate.StartupBlank {
		t.Fatalf("startup = %q, want the default", got.Settings.Startup)
	}
	if _, err := s.SaveSettings(context.Background(), got.Settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	s, _ := newTestService(1, true)
	store := withState(t, s)

	out, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup:    appstate.StartupResume,
		Appearance: appstate.AppearanceDark,
	})
	if err != nil || out.Failure != nil {
		t.Fatalf("SaveSettings = %+v, %v", out, err)
	}
	got, _ := s.GetSettings(context.Background())
	if got.Settings.Startup != appstate.StartupResume || got.Settings.Appearance != appstate.AppearanceDark {
		t.Fatalf("settings = %+v, want what was saved", got.Settings)
	}
	if stored := store.Get(); stored.Startup != appstate.StartupResume {
		t.Fatalf("the file holds %+v", stored)
	}
}

func TestSmartPunctuationRoundTripAndChange(t *testing.T) {
	s, _ := newTestService(1, true)
	withState(t, s)
	var broadcast contract.SettingsChange
	calls := 0
	s.settingsChanged = func(change contract.SettingsChange) {
		calls++
		broadcast = change
	}

	// A save that only flips smartPunctuation still reports both fields so a
	// late-joining window learns the whole preference pair (P3-AC-07).
	out, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup:          appstate.StartupBlank,
		Appearance:       appstate.AppearanceSystem,
		ShowStatusBar:    true,
		SmartPunctuation: true,
	})
	if err != nil || out.Failure != nil {
		t.Fatalf("SaveSettings = %+v, %v", out, err)
	}
	if calls != 1 || !broadcast.SmartPunctuation || !broadcast.ShowStatusBar {
		t.Fatalf("settingsChanged = %+v x%d, want both fields on", broadcast, calls)
	}
	got, _ := s.GetSettings(context.Background())
	if !got.Settings.SmartPunctuation {
		t.Fatalf("settings = %+v, want smartPunctuation saved", got.Settings)
	}

	// Saving the same value again must not re-broadcast.
	if _, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup:          appstate.StartupBlank,
		Appearance:       appstate.AppearanceSystem,
		ShowStatusBar:    true,
		SmartPunctuation: true,
	}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("settingsChanged fired %d times, want 1", calls)
	}
}

func TestSpellCheckRoundTripAndChange(t *testing.T) {
	s, _ := newTestService(1, true)
	withState(t, s)
	var broadcast contract.SettingsChange
	calls := 0
	s.settingsChanged = func(change contract.SettingsChange) {
		calls++
		broadcast = change
	}

	// A save that only flips spellCheck still reports every field so a
	// late-joining window learns the whole preference set (P3-AC-09).
	out, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup:    appstate.StartupBlank,
		Appearance: appstate.AppearanceSystem,
		SpellCheck: true,
	})
	if err != nil || out.Failure != nil {
		t.Fatalf("SaveSettings = %+v, %v", out, err)
	}
	if calls != 1 || !broadcast.SpellCheck {
		t.Fatalf("settingsChanged = %+v x%d, want spellCheck on", broadcast, calls)
	}
	got, _ := s.GetSettings(context.Background())
	if !got.Settings.SpellCheck {
		t.Fatalf("settings = %+v, want spellCheck saved", got.Settings)
	}

	// Saving the same value again must not re-broadcast.
	if _, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup:    appstate.StartupBlank,
		Appearance: appstate.AppearanceSystem,
		SpellCheck: true,
	}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("settingsChanged fired %d times, want 1", calls)
	}
}

func TestSettingsSaveFailureKeepsTheOldValue(t *testing.T) {
	s, _ := newTestService(1, true)
	store := withState(t, s)
	if _, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup: appstate.StartupResume, Appearance: appstate.AppearanceSystem,
	}); err != nil {
		t.Fatal(err)
	}
	// A directory where the file should be makes every write fail.
	if err := os.Remove(store.Path()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(store.Path(), 0o755); err != nil {
		t.Fatal(err)
	}

	out, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup: appstate.StartupBlank, Appearance: appstate.AppearanceLight,
	})
	if err != nil {
		t.Fatalf("SaveSettings returned an unexpected error: %v", err)
	}
	if out.Failure == nil || out.Failure.Code != "settings_write_failed" {
		t.Fatalf("outcome = %+v, want settings_write_failed", out)
	}
	if got, _ := s.GetSettings(context.Background()); got.Settings.Startup != appstate.StartupResume {
		t.Fatalf("settings = %+v, want the previous value kept", got.Settings)
	}
}

func TestSettingsCorruptIsReported(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{ broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := appstate.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newTestService(1, true)
	s.state = store

	got, _ := s.GetSettings(context.Background())
	if !got.Corrupt || got.Failure == nil || got.Failure.Code != "settings_corrupt" {
		t.Fatalf("result = %+v, want the damage reported", got)
	}
}

func TestRecentListRecordsWhatWasOpened(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "笔记.md", []byte("# 笔记\n"))
	s, _ := newTestService(1, true)
	withState(t, s)
	s.pick = func(context.Context) (string, error) { return path, nil }
	if _, err := s.OpenFileDialog(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetSettings(context.Background())
	if len(got.Settings.Recent) != 1 || got.Settings.Recent[0].Name != "笔记.md" {
		t.Fatalf("recent = %+v, want the opened file", got.Settings.Recent)
	}
}

func TestOpenRecentRejectsAnUnknownPath(t *testing.T) {
	s, _ := newTestService(1, true)
	withState(t, s)
	got, err := s.OpenRecent(context.Background(), filepath.Join(t.TempDir(), "x.md"))
	if err != nil {
		t.Fatalf("OpenRecent: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "not_found" {
		t.Fatalf("result = %+v, want not_found", got)
	}
}

func TestOpenRecentOpensARecordedFile(t *testing.T) {
	dir := t.TempDir()
	path := writeSample(t, dir, "a.md", []byte("# a\n"))
	s, _ := newTestService(1, true)
	store := withState(t, s)
	if err := store.AddRecent(path, false); err != nil {
		t.Fatal(err)
	}
	got, err := s.OpenRecent(context.Background(), path)
	if err != nil {
		t.Fatalf("OpenRecent: %v", err)
	}
	if got.Doc == nil || got.Doc.Name != "a.md" {
		t.Fatalf("result = %+v, want the document", got)
	}
}

func TestClearRecentEmptiesTheList(t *testing.T) {
	s, _ := newTestService(1, true)
	store := withState(t, s)
	if err := store.AddRecent(filepath.Join(t.TempDir(), "a.md"), false); err != nil {
		t.Fatal(err)
	}
	if out, err := s.ClearRecent(context.Background()); err != nil || out.Failure != nil {
		t.Fatalf("ClearRecent = %+v, %v", out, err)
	}
	if got, _ := s.GetSettings(context.Background()); len(got.Settings.Recent) != 0 {
		t.Fatalf("recent = %+v, want none", got.Settings.Recent)
	}
}

func TestSavingSettingsKeepsTheResumeTarget(t *testing.T) {
	s, _ := newTestService(1, true)
	store := withState(t, s)
	target := &appstate.Resume{Path: filepath.Join(t.TempDir(), "a.md")}
	if err := store.SetResume(target); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveSettings(context.Background(), contract.SettingsView{
		Startup: appstate.StartupResume, Appearance: appstate.AppearanceSystem,
	}); err != nil {
		t.Fatal(err)
	}
	if got := store.Get().Resume; got == nil || got.Path != target.Path {
		t.Fatalf("resume = %+v, want it kept across a settings save", got)
	}
}

func TestRecordFocusKeepsTheFolderAndDocument(t *testing.T) {
	root := t.TempDir()
	path := writeSample(t, root, "a.md", []byte("# a\n"))
	s, reg := newTestService(1, true)
	store := withState(t, s)
	w, _ := reg.Get(1)
	w.SetRoot(root)
	w.SetOpenFile(path)

	s.RecordFocus(1)
	got := store.Get().Resume
	if got == nil || !got.IsDir || got.Path != root || got.Selected != "a.md" {
		t.Fatalf("resume = %+v, want the folder and the document", got)
	}
}

func TestGetSettingsReportsAFailedImplicitWriteOnce(t *testing.T) {
	s, _ := newTestService(1, true)
	store, err := appstate.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.state = store
	s.metaFailed.Store(true)

	first, err := s.GetSettings(context.Background())
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if first.Failure == nil || first.Failure.Code != "settings_write_failed" {
		t.Fatalf("failure = %+v, want settings_write_failed", first.Failure)
	}
	second, err := s.GetSettings(context.Background())
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if second.Failure != nil {
		t.Fatalf("failure repeated: %+v", second.Failure)
	}
}
