package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

func TestMoveDocumentMovesAndUpdatesEveryWindow(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	targetDir := filepath.Join(dir, "归档")
	if err := os.Mkdir(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 10)
	h.reg.Add(11)
	second, _ := h.reg.Get(11)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	if _, err := h.service.openPath(context.Background(), second, source); err != nil {
		t.Fatal(err)
	}
	h.service.pickMove = func(context.Context) (string, error) { return targetDir, nil }

	result, err := h.service.MoveDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("MoveDocument: %v", err)
	}
	if result.Failure != nil {
		t.Fatalf("MoveDocument failure = %+v", result.Failure)
	}
	target := filepath.Join(targetDir, "笔记.md")
	if result.Path != target {
		t.Fatalf("path = %q, want %q", result.Path, target)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("the source file still exists")
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "# 一\n" {
		t.Fatalf("target = %q, %v", data, err)
	}
	for _, w := range []string{"first", "second"} {
		window := h.window
		if w == "second" {
			window = second
		}
		if got, ok := window.OpenFile(); !ok || got != target {
			t.Fatalf("%s window path = %q, %v", w, got, ok)
		}
	}
}

func TestMoveDocumentRefusesAnExistingTarget(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	targetDir := filepath.Join(dir, "归档")
	if err := os.Mkdir(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeSample(t, targetDir, "笔记.md", []byte("# 已有\n"))
	h := newRefreshHarness(t, 20)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	h.service.pickMove = func(context.Context) (string, error) { return targetDir, nil }

	result, err := h.service.MoveDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("MoveDocument: %v", err)
	}
	if result.Failure == nil || result.Failure.Code != "move_exists" {
		t.Fatalf("failure = %+v", result.Failure)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("source disappeared: %v", err)
	}
}

func TestMoveDocumentRefusesWhenAnotherWindowIsDirty(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	targetDir := filepath.Join(dir, "归档")
	if err := os.Mkdir(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 30)
	h.reg.Add(31)
	second, _ := h.reg.Get(31)
	for _, w := range []*winctx.Window{h.window, second} {
		if _, err := h.service.openPath(context.Background(), w, source); err != nil {
			t.Fatal(err)
		}
	}
	second.SetEditState(true, "", false, "LF")
	h.service.pickMove = func(context.Context) (string, error) { return targetDir, nil }

	result, err := h.service.MoveDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("MoveDocument: %v", err)
	}
	if result.Failure == nil || result.Failure.Code != "dirty_other" {
		t.Fatalf("failure = %+v", result.Failure)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("source disappeared: %v", err)
	}
}

func TestTrashDocumentKeepsTheBufferForSaveAs(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 40)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	h.service.trash = func(path string) error { return os.Remove(path) }

	result, err := h.service.TrashDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("TrashDocument: %v", err)
	}
	if result.Failure != nil {
		t.Fatalf("TrashDocument failure = %+v", result.Failure)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("the file is still on disk")
	}
	if got, ok := h.window.OpenFile(); !ok || got != source {
		t.Fatalf("window path = %q, %v; want it kept for save-as", got, ok)
	}
	select {
	case event := <-h.trashed:
		if event.Path != source || event.Name != "笔记.md" {
			t.Fatalf("event = %+v", event)
		}
	default:
		t.Fatal("the page was not told the file was trashed")
	}
}

func TestTrashDocumentLeavesTheFileWhenTheRecycleBinFails(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 50)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	h.service.trash = func(string) error { return os.ErrPermission }

	result, err := h.service.TrashDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("TrashDocument: %v", err)
	}
	if result.Failure == nil || result.Failure.Code != "trash_failed" {
		t.Fatalf("failure = %+v", result.Failure)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("the file was removed after a failed trash: %v", err)
	}
}

func TestTrashDocumentNotifiesEveryWindowShowingTheFile(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 45)
	h.reg.Add(46)
	second, _ := h.reg.Get(46)
	for _, w := range []*winctx.Window{h.window, second} {
		if _, err := h.service.openPath(context.Background(), w, source); err != nil {
			t.Fatal(err)
		}
	}
	h.service.trash = func(path string) error { return os.Remove(path) }

	result, err := h.service.TrashDocument(context.Background(), "")
	if err != nil || result.Failure != nil {
		t.Fatalf("TrashDocument = %+v, %v", result, err)
	}
	for i := 0; i < 2; i++ {
		select {
		case event := <-h.trashed:
			if event.Path != source {
				t.Fatalf("event = %+v", event)
			}
		default:
			t.Fatalf("only %d windows were told about the trash", i)
		}
	}
}

func TestSaveRefusesToRecreateTheOldPathAfterAMove(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	targetDir := filepath.Join(dir, "归档")
	if err := os.Mkdir(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := newRefreshHarness(t, 90)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	h.service.pickMove = func(context.Context) (string, error) { return targetDir, nil }
	if result, err := h.service.MoveDocument(context.Background(), ""); err != nil || result.Failure != nil {
		t.Fatalf("MoveDocument = %+v, %v", result, err)
	}
	saved := h.service.saveText(h.window, source, "# stale\n", false, false)
	if saved.Failure == nil || saved.Failure.Code != "save_failed" {
		t.Fatalf("saveText = %+v, want a stale-path failure", saved)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("the stale save recreated the old path")
	}
}

func TestAttachParentFolderKeepsTheDocumentOpen(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 60)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}

	result, err := h.service.AttachParentFolder(context.Background())
	if err != nil {
		t.Fatalf("AttachParentFolder: %v", err)
	}
	if result.Failure != nil || result.Folder == nil {
		t.Fatalf("result = %+v", result)
	}
	if result.Folder.Root != dir || result.Rel != "笔记.md" {
		t.Fatalf("result = %+v", result)
	}
	if got, ok := h.window.OpenFile(); !ok || got != source {
		t.Fatalf("document changed: %q, %v", got, ok)
	}
	if root, ok := h.window.Root(); !ok || root != dir {
		t.Fatalf("root = %q, %v", root, ok)
	}
}

func TestMoveFileFallsBackToVerifiedCopy(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	target := filepath.Join(dir, "移动后.md")
	previous := renameFile
	renameFile = func(string, string) error { return errors.New("cross volume") }
	t.Cleanup(func() { renameFile = previous })

	if err := moveFile(source, target); err != nil {
		t.Fatalf("moveFile: %v", err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("the source file still exists after the copy fallback")
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "# 一\n" {
		t.Fatalf("target = %q, %v", data, err)
	}
}

func TestMoveDocumentToTheSameFolderIsANoOp(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# 一\n"))
	h := newRefreshHarness(t, 85)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	h.service.pickMove = func(context.Context) (string, error) { return dir, nil }

	result, err := h.service.MoveDocument(context.Background(), "")
	if err != nil {
		t.Fatalf("MoveDocument: %v", err)
	}
	if result.Failure != nil || result.Path != "" {
		t.Fatalf("result = %+v, want a silent no-op", result)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("source disappeared: %v", err)
	}
}

func TestDocumentPropertiesReportsEncodingAndLineEnding(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte{0xEF, 0xBB, 0xBF, '#', ' ', 'x', '\r', '\n'})
	h := newRefreshHarness(t, 70)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}

	properties, err := h.service.DocumentProperties(context.Background(), "")
	if err != nil {
		t.Fatalf("DocumentProperties: %v", err)
	}
	if properties.Failure != nil {
		t.Fatalf("failure = %+v", properties.Failure)
	}
	if properties.Encoding != "UTF-8 BOM" || properties.LineEnding != "CRLF" {
		t.Fatalf("properties = %+v", properties)
	}
	if properties.Path != source || properties.Modified == "" {
		t.Fatalf("properties = %+v", properties)
	}
}

func TestDocumentPropertiesReportsMixedLineEndings(t *testing.T) {
	dir := t.TempDir()
	source := writeSample(t, dir, "笔记.md", []byte("# a\r\n# b\n"))
	h := newRefreshHarness(t, 71)
	if _, err := h.service.openPath(context.Background(), h.window, source); err != nil {
		t.Fatal(err)
	}
	properties, err := h.service.DocumentProperties(context.Background(), "")
	if err != nil {
		t.Fatalf("DocumentProperties: %v", err)
	}
	if properties.LineEnding != "混合" {
		t.Fatalf("line ending = %q, want 混合", properties.LineEnding)
	}
}

func TestFileTargetRejectsAPathOutsideTheRoot(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "root")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	writeSample(t, dir, "outside.md", []byte("# 外\n"))
	h := newRefreshHarness(t, 80)
	h.window.SetRoot(root)

	_, failure := h.service.fileTarget(h.window, "../outside.md")
	if failure == nil || failure.Code != "out_of_scope" {
		t.Fatalf("failure = %+v", failure)
	}
}
