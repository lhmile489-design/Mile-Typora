package watch

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestPoolSharesOneWatch(t *testing.T) {
	var starts, stops atomic.Int32
	pool := NewPool(func(path string, onEvent func(Event)) (func(), error) {
		starts.Add(1)
		return func() { stops.Add(1) }, nil
	})

	releaseA, err := pool.Acquire(`C:\notes\a.md`, func(Event) {})
	if err != nil {
		t.Fatal(err)
	}
	releaseB, err := pool.Acquire(`c:\notes\A.md`, func(Event) {})
	if err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 {
		t.Fatalf("started %d watches, want one shared one", starts.Load())
	}
	if got := pool.Refs(`C:\notes\a.md`); got != 2 {
		t.Fatalf("Refs = %d, want 2", got)
	}

	releaseA()
	if stops.Load() != 0 {
		t.Fatal("the watch stopped while a window still needs it")
	}
	releaseB()
	if stops.Load() != 1 {
		t.Fatalf("stopped %d watches, want one after the last release", stops.Load())
	}
	if pool.Refs(`C:\notes\a.md`) != 0 {
		t.Fatal("the entry was not forgotten")
	}
}

func TestPoolFansOutToEverySubscriber(t *testing.T) {
	var deliver func(Event)
	pool := NewPool(func(path string, onEvent func(Event)) (func(), error) {
		deliver = onEvent
		return func() {}, nil
	})

	seenA, seenB := 0, 0
	releaseA, _ := pool.Acquire(`C:\a.md`, func(Event) { seenA++ })
	releaseB, _ := pool.Acquire(`C:\a.md`, func(Event) { seenB++ })
	deliver(Event{Op: Write})

	if seenA != 1 || seenB != 1 {
		t.Fatalf("listeners saw %d and %d events, want 1 each", seenA, seenB)
	}

	// A released window hears nothing more.
	releaseA()
	deliver(Event{Op: Write})
	if seenA != 1 || seenB != 2 {
		t.Fatalf("after release: %d and %d, want 1 and 2", seenA, seenB)
	}
	releaseB()
}

func TestReleaseIsIdempotent(t *testing.T) {
	var stops atomic.Int32
	pool := NewPool(func(string, func(Event)) (func(), error) {
		return func() { stops.Add(1) }, nil
	})
	release, _ := pool.Acquire(`C:\a.md`, func(Event) {})
	release()
	release()
	if stops.Load() != 1 {
		t.Fatalf("stopped %d times, want 1", stops.Load())
	}
}

func TestAcquireReportsAStartFailure(t *testing.T) {
	pool := NewPool(func(string, func(Event)) (func(), error) {
		return nil, ErrLoopStopped
	})
	if _, err := pool.Acquire(`C:\a.md`, func(Event) {}); err == nil {
		t.Fatal("Acquire hid the starter's error")
	}
	if pool.Refs(`C:\a.md`) != 0 {
		t.Fatal("a failed watch left an entry behind")
	}
	_ = time.Second
}
