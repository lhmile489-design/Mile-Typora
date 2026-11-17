package appstate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestDefaultsWhenNoFile(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got := store.Get()
	if got.Startup != StartupBlank || got.Appearance != AppearanceSystem || len(got.Recent) != 0 {
		t.Fatalf("settings = %+v, want the defaults", got)
	}
	if _, corrupt := store.Corrupt(); corrupt {
		t.Fatal("a fresh store reports a damaged file")
	}
}

func TestSaveAndReload(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	want := Settings{
		Startup:    StartupResume,
		Appearance: AppearanceDark,
		Recent:     []Recent{{Path: filepath.Join(dir, "a.md")}},
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	again, err := Open(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got := again.Get()
	if got.Startup != StartupResume || got.Appearance != AppearanceDark || len(got.Recent) != 1 {
		t.Fatalf("reloaded = %+v, want %+v", got, want)
	}
}

func TestSmartPunctuationDefaultsOff(t *testing.T) {
	// A settings file written before M6-3 has no smartPunctuation key; it must
	// read as off rather than crash or default on (P3 §4).
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	body := []byte(`{"startup":"blank","appearance":"system","recent":[]}`)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got := store.Get()
	if got.SmartPunctuation == nil || *got.SmartPunctuation {
		t.Fatalf("smartPunctuation = %v, want a saved false", got.SmartPunctuation)
	}
}

func TestSmartPunctuationRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	on := true
	want := Settings{
		Startup:          StartupResume,
		Appearance:       AppearanceDark,
		ShowStatusBar:    &on,
		SmartPunctuation: &on,
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	again, err := Open(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got := again.Get()
	if got.SmartPunctuation == nil || !*got.SmartPunctuation {
		t.Fatalf("reloaded smartPunctuation = %v, want true", got.SmartPunctuation)
	}
}

func TestDamagedFileIsPreserved(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("{ this is not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	preserved, ok := store.Corrupt()
	if !ok {
		t.Fatal("the damaged file was not reported")
	}
	if _, err := os.Stat(preserved); err != nil {
		t.Fatalf("the damaged file is gone: %v", err)
	}
	if got := store.Get(); got.Startup != StartupBlank {
		t.Fatalf("settings = %+v, want the defaults after damage", got)
	}

	// The next save writes a valid file and leaves the damaged one alone.
	if err := store.Save(Settings{Startup: StartupResume, Appearance: AppearanceSystem}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, ok := store.Corrupt(); ok {
		t.Fatal("the store still reports damage after a good save")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed Settings
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("the new file is not valid JSON: %v", err)
	}
	if _, err := os.Stat(preserved); err != nil {
		t.Fatal("a good save deleted the damaged file")
	}
}

func TestFailedWriteKeepsTheOldValue(t *testing.T) {
	// A file where the directory should be makes every write fail.
	blocker := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &Store{path: filepath.Join(blocker, "settings.json"), data: Settings{Startup: StartupResume}}
	if err := store.Save(Settings{Startup: StartupBlank}); err == nil {
		t.Fatal("Save reported success although the directory is a file")
	}
	if got := store.Get(); got.Startup != StartupResume {
		t.Fatalf("settings = %+v, want the previous value kept", got)
	}
}

func TestRecentList(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	a := filepath.Join(dir, "a.md")
	b := filepath.Join(dir, "b.md")

	if err := store.AddRecent(a, false); err != nil {
		t.Fatal(err)
	}
	if err := store.AddRecent(b, false); err != nil {
		t.Fatal(err)
	}
	if err := store.AddRecent(a, false); err != nil {
		t.Fatal(err)
	}
	got := store.Get().Recent
	if len(got) != 2 || got[0].Path != a || got[1].Path != b {
		t.Fatalf("recent = %+v, want a first and b second without repeats", got)
	}

	// Windows paths compare without case.
	if err := store.AddRecent(strings.ToUpper(a), false); err != nil {
		t.Fatal(err)
	}
	if got := store.Get().Recent; len(got) != 2 {
		t.Fatalf("recent = %+v, want the case variant to replace the entry", got)
	}
}

func TestRecentListIsCapped(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	for i := 0; i < MaxRecent+5; i++ {
		path := filepath.Join(dir, "note"+string(rune('a'+i))+".md")
		if err := store.AddRecent(path, false); err != nil {
			t.Fatal(err)
		}
	}
	if got := len(store.Get().Recent); got != MaxRecent {
		t.Fatalf("recent holds %d entries, want %d", got, MaxRecent)
	}
}

func TestClearRecent(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	if err := store.AddRecent(filepath.Join(dir, "a.md"), false); err != nil {
		t.Fatal(err)
	}
	if err := store.ClearRecent(); err != nil {
		t.Fatalf("ClearRecent: %v", err)
	}
	if got := store.Get().Recent; len(got) != 0 {
		t.Fatalf("recent = %+v, want none", got)
	}
	again, _ := Open(dir)
	if got := again.Get().Recent; len(got) != 0 {
		t.Fatalf("after reload recent = %+v, want none", got)
	}
}

func TestConcurrentSavesDoNotCorrupt(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			path := filepath.Join(dir, "note"+string(rune('a'+i))+".md")
			if err := store.AddRecent(path, false); err != nil {
				t.Errorf("AddRecent: %v", err)
			}
		}(i)
	}
	wg.Wait()

	raw, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	var parsed Settings
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("the settings file is not valid JSON after concurrent saves: %v", err)
	}
	if len(parsed.Recent) != 16 {
		t.Fatalf("recent holds %d entries, want 16", len(parsed.Recent))
	}
}

func TestNormalizeDropsWhatItCannotUse(t *testing.T) {
	got := normalize(Settings{
		Startup:    "yesterday",
		Appearance: "neon",
		Recent: []Recent{
			{Path: ""},
			{Path: "relative.md"},
			{Path: `C:\notes\a.md`},
			{Path: `c:\notes\a.md`},
		},
	})
	if got.Startup != StartupBlank || got.Appearance != AppearanceSystem {
		t.Fatalf("enums = %q/%q, want the defaults", got.Startup, got.Appearance)
	}
	if len(got.Recent) != 1 {
		t.Fatalf("recent = %+v, want one entry", got.Recent)
	}
}

func TestAByteOrderMarkIsTolerated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	body := []byte(`{"startup":"resume","appearance":"dark","recent":[]}`)
	if err := os.WriteFile(path, append([]byte{0xEF, 0xBB, 0xBF}, body...), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, corrupt := store.Corrupt(); corrupt {
		t.Fatal("a file with a byte order mark was treated as damaged")
	}
	if got := store.Get(); got.Startup != StartupResume || got.Appearance != AppearanceDark {
		t.Fatalf("settings = %+v, want them read", got)
	}
}

func TestRemoveRecent(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	a := filepath.Join(dir, "a.md")
	b := filepath.Join(dir, "b.md")
	if err := store.AddRecent(a, false); err != nil {
		t.Fatal(err)
	}
	if err := store.AddRecent(b, false); err != nil {
		t.Fatal(err)
	}
	if err := store.SetResume(&Resume{Path: a}); err != nil {
		t.Fatal(err)
	}

	// Windows paths compare without case.
	if err := store.RemoveRecent(strings.ToUpper(a)); err != nil {
		t.Fatalf("RemoveRecent: %v", err)
	}
	got := store.Get()
	if len(got.Recent) != 1 || got.Recent[0].Path != b {
		t.Fatalf("recent = %+v, want only b", got.Recent)
	}
	if got.Resume != nil {
		t.Fatalf("resume = %+v, want it cleared with its entry", got.Resume)
	}

	again, _ := Open(dir)
	if got := again.Get(); len(got.Recent) != 1 || got.Recent[0].Path != b {
		t.Fatalf("after reload recent = %+v", got.Recent)
	}
}
