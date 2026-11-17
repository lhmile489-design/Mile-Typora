// Package appstate keeps the app's own settings and recent list in one JSON
// file under the application's data directory (PRD FR-08, FR-10, CLAUDE.md
// §5.7). It never touches the user's documents, writes atomically, and keeps a
// damaged file instead of overwriting it.
package appstate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MaxRecent is how many entries the recent list keeps (PRD FR-08.1).
const MaxRecent = 20

// Startup modes of PRD FR-10.1.
const (
	StartupBlank  = "blank"
	StartupResume = "resume"
)

// Appearance modes of PRD FR-10.12.
const (
	AppearanceSystem = "system"
	AppearanceLight  = "light"
	AppearanceDark   = "dark"
)

// Recent is one entry of the recent list.
type Recent struct {
	// Path is the absolute path of a file or a folder.
	Path string `json:"path"`
	// IsDir tells a folder from a file.
	IsDir bool `json:"isDir"`
}

// Resume is what the next launch restores (PRD FR-10.4, FR-10.5).
type Resume struct {
	// Path is the file, or the folder, that was last read in front.
	Path string `json:"path"`
	// IsDir tells a folder from a file.
	IsDir bool `json:"isDir"`
	// Selected is the document shown inside the folder, as a path relative
	// to it; empty for a single file.
	Selected string `json:"selected,omitempty"`
}

// Settings is everything the app remembers between runs.
type Settings struct {
	// Startup is StartupBlank or StartupResume.
	Startup string `json:"startup"`
	// Appearance is AppearanceSystem, AppearanceLight or AppearanceDark.
	Appearance string `json:"appearance"`
	// Recent is newest first.
	Recent []Recent `json:"recent"`
	// Resume is the target of the next "resume" launch, if there is one.
	Resume *Resume `json:"resume,omitempty"`
	// ShowStatusBar is the shared status-bar preference (M5-7 VIEW-09).
	// A pointer keeps old files without the field defaulting to shown.
	ShowStatusBar *bool `json:"showStatusBar,omitempty"`
}

// Defaults are what a fresh install uses.
func Defaults() Settings {
	show := true
	return Settings{Startup: StartupBlank, Appearance: AppearanceSystem, Recent: nil, ShowStatusBar: &show}
}

// Store owns the settings file. It is safe for concurrent use: native events
// and page calls arrive on different goroutines.
type Store struct {
	mu   sync.Mutex
	path string
	data Settings
	// corrupt is the path of a damaged file that was preserved, if any.
	corrupt string
}

// Open reads the settings in dir, or starts from the defaults. A damaged file
// is renamed and kept; the store then works on defaults until the next save
// replaces it (PRD FR-10.11).
func Open(dir string) (*Store, error) {
	store := &Store{path: filepath.Join(dir, "settings.json"), data: Defaults()}
	raw, err := os.ReadFile(store.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return store, nil
	case err != nil:
		return nil, err
	}
	// An editor may add a byte order mark; it is not part of the JSON.
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	var loaded Settings
	if err := json.Unmarshal(raw, &loaded); err != nil {
		preserved, renameErr := preserve(store.path)
		if renameErr != nil {
			return nil, renameErr
		}
		store.corrupt = preserved
		return store, nil
	}
	store.data = normalize(loaded)
	return store, nil
}

// Path is where the settings file lives, for logs and diagnostics. It never
// holds document text.
func (s *Store) Path() string { return s.path }

// Corrupt is the path of a damaged settings file that was kept, if there was
// one: the page tells the user so (PRD FR-10.11).
func (s *Store) Corrupt() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.corrupt, s.corrupt != ""
}

// Get returns a copy of the settings.
func (s *Store) Get() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return copyOf(s.data)
}

// Save writes next atomically. When the write fails, the previous settings
// stay in memory and on disk (PRD FR-10.2).
func (s *Store) Save(next Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	clean := normalize(next)
	if err := writeAtomic(s.path, clean); err != nil {
		return err
	}
	s.data = clean
	s.corrupt = ""
	return nil
}

// AddRecent puts path at the front of the recent list and saves.
func (s *Store) AddRecent(path string, isDir bool) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("appstate: empty recent path")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyOf(s.data)
	next.Recent = pushRecent(next.Recent, Recent{Path: path, IsDir: isDir})
	clean := normalize(next)
	if err := writeAtomic(s.path, clean); err != nil {
		return err
	}
	s.data = clean
	return nil
}

// RemoveRecent drops one entry, as the row of an unavailable target does
// (PRD §7.2). A path that is not listed changes nothing.
func (s *Store) RemoveRecent(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyOf(s.data)
	kept := make([]Recent, 0, len(next.Recent))
	for _, entry := range next.Recent {
		if strings.EqualFold(entry.Path, path) {
			continue
		}
		kept = append(kept, entry)
	}
	next.Recent = kept
	if next.Resume != nil && strings.EqualFold(next.Resume.Path, path) {
		next.Resume = nil
	}
	clean := normalize(next)
	if err := writeAtomic(s.path, clean); err != nil {
		return err
	}
	s.data = clean
	return nil
}

// SetResume records what the next resume launch restores. A nil target clears
// it, as "clear the recent list" does (PRD FR-10.10).
func (s *Store) SetResume(target *Resume) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyOf(s.data)
	next.Resume = target
	clean := normalize(next)
	if err := writeAtomic(s.path, clean); err != nil {
		return err
	}
	s.data = clean
	return nil
}

// ClearRecent empties the list and the resume target, and saves (PRD FR-10.10).
func (s *Store) ClearRecent() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := copyOf(s.data)
	next.Recent = nil
	next.Resume = nil
	if err := writeAtomic(s.path, next); err != nil {
		return err
	}
	s.data = next
	return nil
}

// pushRecent puts entry first, dropping any entry with the same path. Windows
// paths compare without case.
func pushRecent(list []Recent, entry Recent) []Recent {
	out := make([]Recent, 0, len(list)+1)
	out = append(out, entry)
	for _, existing := range list {
		if strings.EqualFold(existing.Path, entry.Path) {
			continue
		}
		out = append(out, existing)
	}
	return out
}

// normalize enforces the enums, the limit and the deduplication, so a file
// written by another version cannot put the app in a strange state.
func normalize(s Settings) Settings {
	if s.Startup != StartupResume {
		s.Startup = StartupBlank
	}
	switch s.Appearance {
	case AppearanceLight, AppearanceDark:
	default:
		s.Appearance = AppearanceSystem
	}
	if s.ShowStatusBar == nil {
		show := true
		s.ShowStatusBar = &show
	}

	seen := make(map[string]struct{}, len(s.Recent))
	recent := make([]Recent, 0, len(s.Recent))
	for _, entry := range s.Recent {
		path := strings.TrimSpace(entry.Path)
		if path == "" || !filepath.IsAbs(path) {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		recent = append(recent, Recent{Path: filepath.Clean(path), IsDir: entry.IsDir})
		if len(recent) == MaxRecent {
			break
		}
	}
	s.Recent = recent

	if s.Resume != nil {
		target := Resume{
			Path:     strings.TrimSpace(s.Resume.Path),
			IsDir:    s.Resume.IsDir,
			Selected: strings.TrimSpace(s.Resume.Selected),
		}
		if target.Path == "" || !filepath.IsAbs(target.Path) ||
			strings.HasPrefix(target.Selected, "..") || filepath.IsAbs(target.Selected) {
			s.Resume = nil
		} else {
			target.Path = filepath.Clean(target.Path)
			target.Selected = filepath.ToSlash(filepath.Clean(filepath.FromSlash(target.Selected)))
			if target.Selected == "." {
				target.Selected = ""
			}
			s.Resume = &target
		}
	}
	return s
}

func copyOf(s Settings) Settings {
	out := s
	out.Recent = append([]Recent(nil), s.Recent...)
	if s.Resume != nil {
		resume := *s.Resume
		out.Resume = &resume
	}
	if s.ShowStatusBar != nil {
		show := *s.ShowStatusBar
		out.ShowStatusBar = &show
	}
	return out
}

// writeAtomic writes a temporary file next to path and renames it over, so a
// crash never leaves half a settings file.
func writeAtomic(path string, value Settings) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".settings-*.tmp")
	if err != nil {
		return fmt.Errorf("appstate: %w", err)
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("appstate: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("appstate: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("appstate: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("appstate: %w", err)
	}
	return nil
}

// preserve renames a damaged file so nothing is lost, and returns the new path.
func preserve(path string) (string, error) {
	dir := filepath.Dir(path)
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	stamp := time.Now().Format("20060102-150405")
	for attempt := 0; attempt < 100; attempt++ {
		name := filepath.Join(dir, fmt.Sprintf("%s.corrupt-%s.json", base, stamp))
		if attempt > 0 {
			name = filepath.Join(dir, fmt.Sprintf("%s.corrupt-%s-%d.json", base, stamp, attempt))
		}
		if _, err := os.Stat(name); err == nil {
			continue
		}
		if err := os.Rename(path, name); err != nil {
			return "", fmt.Errorf("appstate: cannot preserve the damaged file: %w", err)
		}
		return name, nil
	}
	return "", errors.New("appstate: cannot find a name for the damaged file")
}
