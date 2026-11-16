// Package resource serves the images a document refers to, and only those:
// the renderer registers each one under a random token, and the page loads it
// through the app's own protocol (PRD FR-06, CLAUDE.md §6).
package resource

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Scheme is the URL scheme the page loads resources with. On Windows the page
// addresses it as http://mtres.localhost/<token>.
const Scheme = "mtres"

// Limits of one image (PRD §8.3).
const (
	MaxBytes  = 20 << 20
	MaxPixels = 25_000_000
)

// Item is one registered resource.
type Item struct {
	// Path is the canonical path of the file.
	Path string
	// Window is the window whose document referred to it.
	Window int
}

// Kinds of token a window can hold. Reading and preview tokens are separate
// so rendering an edited buffer never invalidates the reading view's images.
const (
	KindRead    = "read"
	KindPreview = "preview"
)

// Store maps tokens to files. A token is 128 random bits, so a document
// cannot name a file it was not given a token for.
type Store struct {
	mu       sync.RWMutex
	byToken  map[string]Item
	byWindow map[int]map[string]string // token -> kind
}

// New returns an empty store.
func New() *Store {
	return &Store{
		byToken:  make(map[string]Item),
		byWindow: make(map[int]map[string]string),
	}
}

// Add registers path for window's reading view and returns its token.
func (s *Store) Add(window int, path string) string {
	return s.AddKind(window, KindRead, path)
}

// AddKind registers path under a kind of window token and returns it.
func (s *Store) AddKind(window int, kind, path string) string {
	token := newToken()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byToken[token] = Item{Path: path, Window: window}
	if s.byWindow[window] == nil {
		s.byWindow[window] = make(map[string]string)
	}
	s.byWindow[window][token] = kind
	return token
}

// Lookup returns the item a token names.
func (s *Store) Lookup(token string) (Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.byToken[token]
	return item, ok
}

// ForgetWindow drops every token of a window, as when its document changes.
func (s *Store) ForgetWindow(window int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token := range s.byWindow[window] {
		delete(s.byToken, token)
	}
	delete(s.byWindow, window)
}

// ForgetKind drops the tokens of one kind for a window, as each preview
// render does before registering its own images.
func (s *Store) ForgetKind(window int, kind string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token, tokenKind := range s.byWindow[window] {
		if tokenKind != kind {
			continue
		}
		delete(s.byToken, token)
		delete(s.byWindow[window], token)
	}
	if len(s.byWindow[window]) == 0 {
		delete(s.byWindow, window)
	}
}

func newToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand does not fail on a healthy system, and a token has to
		// be unguessable: there is no weaker fallback.
		panic("resource: cannot read random bytes: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
