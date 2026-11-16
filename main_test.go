package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/appstate"
)

func TestIsAppURL(t *testing.T) {
	t.Setenv("MYGO_DEV", "")
	cases := map[string]bool{
		"":                                  true,
		"about:blank":                       true,
		"http://mygo.localhost/":            true,
		"http://mygo.localhost/index.html":  true,
		"https://example.com/":              false,
		"http://localhost:5273/":            false, // the dev server is not allowed outside development
		"javascript:alert(1)":               false,
		"file:///C:/Windows/System32/a.txt": false,
		"mtres://localhost/abc":             false,
	}
	for raw, want := range cases {
		if got := isAppURL(raw); got != want {
			t.Errorf("isAppURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestIsAppURLAllowsTheDevServerWhileDeveloping(t *testing.T) {
	t.Setenv("MYGO_DEV", "1")
	for _, raw := range []string{
		"http://localhost:5273/",
		"http://127.0.0.1:5273/index.html",
	} {
		if !isAppURL(raw) {
			t.Errorf("isAppURL(%q) = false during development, want true", raw)
		}
	}
	// Another port is not the app's page.
	if isAppURL("http://localhost:5173/") {
		t.Error("isAppURL allowed a different dev port")
	}
}

func TestStartupTarget(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name       string
		settings   appstate.Settings
		wantReqs   int
		wantNotice bool
	}{
		{"blank mode", appstate.Settings{Startup: appstate.StartupBlank}, 0, false},
		{"resume without a target", appstate.Settings{Startup: appstate.StartupResume}, 0, false},
		{"resume a file", appstate.Settings{Startup: appstate.StartupResume, Resume: &appstate.Resume{Path: doc}}, 1, false},
		{"resume a missing file", appstate.Settings{Startup: appstate.StartupResume, Resume: &appstate.Resume{Path: filepath.Join(dir, "gone.md")}}, 0, true},
		{"resume a folder", appstate.Settings{Startup: appstate.StartupResume, Resume: &appstate.Resume{Path: dir, IsDir: true}}, 1, false},
		{"resume a folder and its document", appstate.Settings{Startup: appstate.StartupResume, Resume: &appstate.Resume{Path: dir, IsDir: true, Selected: "a.md"}}, 2, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store, err := appstate.Open(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Save(c.settings); err != nil {
				t.Fatal(err)
			}
			requests, notice := startupTarget(store)
			if len(requests) != c.wantReqs {
				t.Fatalf("requests = %+v, want %d", requests, c.wantReqs)
			}
			if (notice != "") != c.wantNotice {
				t.Fatalf("notice = %q, want one: %v", notice, c.wantNotice)
			}
		})
	}
}

func TestStartupTargetPrefersNothingForAnExplicitCommandLine(t *testing.T) {
	// The explicit argument path is decided in main before this runs; here it
	// is enough that a programme state is not required.
	if requests, notice := startupTarget(nil); len(requests) != 0 || notice != "" {
		t.Fatalf("startupTarget(nil) = %+v, %q; want nothing", requests, notice)
	}
}
