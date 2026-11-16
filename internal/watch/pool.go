package watch

import (
	"strings"
	"sync"
)

// Starter opens one underlying watch; Start is the production one, tests
// supply a fake.
type Starter func(path string, onEvent func(Event)) (stop func(), err error)

// Pool watches a path once, however many windows show it (PRD FR-07.4, §9.2:
// a shared watch lives while any window needs it).
type Pool struct {
	mu      sync.Mutex
	start   Starter
	nextID  int
	entries map[string]*poolEntry
}

type listener struct {
	id int
	fn func(Event)
}

type poolEntry struct {
	stop      func()
	listeners []listener
}

// NewPool returns a pool over the given starter.
func NewPool(start Starter) *Pool {
	return &Pool{start: start, entries: make(map[string]*poolEntry)}
}

// Acquire subscribes to path and returns the release for this subscriber.
// The first subscriber starts the watch; the last release stops it.
func (p *Pool) Acquire(path string, onEvent func(Event)) (release func(), err error) {
	key := strings.ToLower(path)
	p.mu.Lock()
	defer p.mu.Unlock()

	entry, ok := p.entries[key]
	if !ok {
		entry = &poolEntry{}
		fanOut := func(event Event) {
			p.mu.Lock()
			listeners := append([]listener(nil), entry.listeners...)
			p.mu.Unlock()
			for _, l := range listeners {
				l.fn(event)
			}
		}
		stop, startErr := p.start(path, fanOut)
		if startErr != nil {
			return nil, startErr
		}
		entry.stop = stop
		p.entries[key] = entry
	}
	p.nextID++
	id := p.nextID
	entry.listeners = append(entry.listeners, listener{id: id, fn: onEvent})

	released := false
	return func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if released {
			return
		}
		released = true
		current, ok := p.entries[key]
		if !ok {
			return
		}
		kept := current.listeners[:0]
		for _, l := range current.listeners {
			if l.id != id {
				kept = append(kept, l)
			}
		}
		current.listeners = kept
		if len(current.listeners) == 0 {
			current.stop()
			delete(p.entries, key)
		}
	}, nil
}

// Refs is how many subscribers a path has, for logs and tests.
func (p *Pool) Refs(path string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if entry, ok := p.entries[strings.ToLower(path)]; ok {
		return len(entry.listeners)
	}
	return 0
}
