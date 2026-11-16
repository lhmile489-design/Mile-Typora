package docread

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const samples = "../../testdata/docs/"

func read(t *testing.T, name string) (*Doc, *Failure) {
	t.Helper()
	return Read(filepath.Join(samples, name))
}

func TestReadPlain(t *testing.T) {
	doc, failure := read(t, "plain.md")
	if failure != nil {
		t.Fatalf("Read: %+v", failure)
	}
	if !strings.HasPrefix(doc.Text, "# 普通文档") {
		t.Fatalf("text = %q, want the file's content", doc.Text)
	}
	if doc.HasBOM || doc.LineEnding != "LF" || doc.Size == 0 {
		t.Fatalf("doc = %+v, want no BOM, LF and a size", doc)
	}
}

func TestReadChineseNameWithSpaces(t *testing.T) {
	doc, failure := read(t, "中文 与 空格.md")
	if failure != nil {
		t.Fatalf("Read: %+v", failure)
	}
	if !strings.Contains(doc.Text, "文件名含中文和空格") {
		t.Fatalf("text = %q, want the Chinese content", doc.Text)
	}
}

func TestReadStripsBOM(t *testing.T) {
	doc, failure := read(t, "bom.md")
	if failure != nil {
		t.Fatalf("Read: %+v", failure)
	}
	if !doc.HasBOM {
		t.Fatal("HasBOM = false, want true")
	}
	if strings.HasPrefix(doc.Text, "\uFEFF") {
		t.Fatal("the BOM is still in the text")
	}
	if !strings.HasPrefix(doc.Text, "# 带 BOM") {
		t.Fatalf("text = %q, want the content after the BOM", doc.Text)
	}
}

func TestReadReportsCRLFAndNormalizes(t *testing.T) {
	doc, failure := read(t, "crlf.md")
	if failure != nil {
		t.Fatalf("Read: %+v", failure)
	}
	if doc.LineEnding != "CRLF" {
		t.Fatalf("LineEnding = %q, want CRLF", doc.LineEnding)
	}
	if strings.Contains(doc.Text, "\r") {
		t.Fatal("the text still holds carriage returns")
	}
}

func TestReadEmptyFileIsValid(t *testing.T) {
	doc, failure := read(t, "empty.md")
	if failure != nil {
		t.Fatalf("Read: %+v", failure)
	}
	if doc.Text != "" || doc.Size != 0 {
		t.Fatalf("doc = %+v, want an empty valid document", doc)
	}
}

func TestReadRejectsInvalidUTF8(t *testing.T) {
	if _, failure := read(t, "invalid-utf8.md"); failure == nil || failure.Code != "encoding" {
		t.Fatalf("failure = %+v, want encoding", failure)
	}
}

func TestReadMissingFile(t *testing.T) {
	if _, failure := Read(filepath.Join(samples, "absent.md")); failure == nil || failure.Code != "not_found" {
		t.Fatalf("failure = %+v, want not_found", failure)
	}
}

func TestReadDirectory(t *testing.T) {
	if _, failure := Read(samples); failure == nil || failure.Code != "unsupported_type" {
		t.Fatalf("failure = %+v, want unsupported_type", failure)
	}
}

func TestReadSizeLimit(t *testing.T) {
	dir := t.TempDir()
	small := filepath.Join(dir, "small.md")
	if err := os.WriteFile(small, make([]byte, MaxBytes), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, failure := Read(small); failure != nil {
		t.Fatalf("a file at the limit failed: %+v", failure)
	}
	big := filepath.Join(dir, "big.md")
	if err := os.WriteFile(big, make([]byte, MaxBytes+1), 0o644); err != nil {
		t.Fatal(err)
	}
	_, failure := Read(big)
	if failure == nil || failure.Code != "too_large" {
		t.Fatalf("failure = %+v, want too_large", failure)
	}
	if failure.Size != MaxBytes+1 || failure.Limit != MaxBytes {
		t.Fatalf("failure = %+v, want the real size and the limit", failure)
	}
}
