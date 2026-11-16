package pathguard

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMarkdownExt(t *testing.T) {
	for name, want := range map[string]bool{
		"a.md": true, "a.MD": true, "a.Markdown": true, "a.markdown": true,
		"a.txt": false, "a.md.bak": false, "md": false, "a.md.txt": false,
	} {
		if got := MarkdownExt(name); got != want {
			t.Errorf("MarkdownExt(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestCanonRejectsUNCAndDevices(t *testing.T) {
	for _, p := range []string{
		`\\server\share\a.md`,
		`\\?\C:\a.md`,
		`\\.\COM1`,
	} {
		failure := mustFailure(t, p)
		if failure.Code != "out_of_scope" {
			t.Errorf("Canon(%q) code = %q, want out_of_scope", p, failure.Code)
		}
	}
}

func TestCanonResolvesAndCleans(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.md")
	if err := os.WriteFile(file, []byte("# a"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A path with .. and redundant separators resolves to the same file.
	roundabout := filepath.Join(dir, "sub", "..", ".", "a.md")
	got, failure := Canon(roundabout)
	if failure != nil {
		t.Fatalf("Canon: %+v", failure)
	}
	if !strings.EqualFold(got, file) {
		t.Fatalf("Canon = %q, want %q", got, file)
	}
}

func TestCanonMissingFile(t *testing.T) {
	if failure := mustFailure(t, filepath.Join(t.TempDir(), "absent.md")); failure.Code != "not_found" {
		t.Fatalf("code = %q, want not_found", failure.Code)
	}
}

func TestWithin(t *testing.T) {
	root := filepath.Clean(`C:\docs`)
	cases := []struct {
		target string
		want   bool
	}{
		{`C:\docs\a.md`, true},
		{`C:\docs`, true},
		{`C:\docs\sub\b.md`, true},
		// A prefix test would accept this one; filepath.Rel does not.
		{`C:\docs2\a.md`, false},
		{`C:\docs\..\secret.md`, false},
		{`D:\docs\a.md`, false},
	}
	for _, c := range cases {
		got, failure := Within(root, filepath.Clean(c.target))
		if got != c.want {
			t.Errorf("Within(%q, %q) = %v (%+v), want %v", root, c.target, got, failure, c.want)
			continue
		}
		if !c.want && (failure == nil || failure.Code != "out_of_scope") {
			t.Errorf("Within(%q, %q) failure = %+v, want out_of_scope", root, c.target, failure)
		}
	}
}

func TestCheckComponentsRefusesAJunction(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("junctions are a Windows feature")
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("# secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	junction := filepath.Join(root, "link")
	// mklink /J makes a directory junction without needing elevation.
	cmd := exec.Command("cmd", "/c", "mklink", "/J", junction, outside)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("cannot create a junction here: %v: %s", err, out)
	}
	target := filepath.Join(junction, "secret.md")
	failure := CheckComponents(root, target)
	if failure == nil || failure.Code != "out_of_scope" {
		t.Fatalf("CheckComponents = %+v, want out_of_scope for a junction", failure)
	}
}

func TestCheckComponentsAllowsRealFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "sub", "a.md")
	if err := os.WriteFile(file, []byte("# a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if failure := CheckComponents(root, file); failure != nil {
		t.Fatalf("CheckComponents = %+v, want none", failure)
	}
	if failure := CheckComponents(root, root); failure != nil {
		t.Fatalf("CheckComponents(root, root) = %+v, want none", failure)
	}
}

func mustFailure(t *testing.T, path string) *Failure {
	t.Helper()
	got, failure := Canon(path)
	if failure == nil {
		t.Fatalf("Canon(%q) = %q, want a failure", path, got)
	}
	return failure
}
