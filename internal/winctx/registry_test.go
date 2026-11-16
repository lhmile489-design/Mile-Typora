package winctx

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestAddGetRemove(t *testing.T) {
	r := NewRegistry()
	w := r.Add(3)
	if got, ok := r.Get(3); !ok || got != w {
		t.Fatalf("Get(3) = %v, %v; want the added window", got, ok)
	}
	if !r.Remove(3) {
		t.Fatal("Remove(3) = false, want true")
	}
	if _, ok := r.Get(3); ok {
		t.Fatal("Get(3) still reports the removed window")
	}
	if r.Remove(3) {
		t.Fatal("Remove(3) twice = true, want false")
	}
}

func TestRemoveCancelsContext(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	r.Remove(1)
	select {
	case <-w.Context().Done():
	case <-time.After(time.Second):
		t.Fatal("context not cancelled after Remove")
	}
	if err := w.Context().Err(); err != context.Canceled {
		t.Fatalf("Err() = %v, want context.Canceled", err)
	}
}

func TestAddTwiceKeepsTheFirstContext(t *testing.T) {
	r := NewRegistry()
	first := r.Add(2)
	second := r.Add(2)
	if first != second {
		t.Fatal("Add(2) twice returned different windows")
	}
	select {
	case <-first.Context().Done():
		t.Fatal("the second Add cancelled work of the first")
	default:
	}
}

func TestCloseCancelsAllAndRefusesLaterAdds(t *testing.T) {
	r := NewRegistry()
	a, b := r.Add(1), r.Add(2)
	r.Close()
	for _, w := range []*Window{a, b} {
		select {
		case <-w.Context().Done():
		default:
			t.Fatalf("window %d still running after Close", w.ID())
		}
	}
	if r.Len() != 0 {
		t.Fatalf("Len() = %d after Close, want 0", r.Len())
	}
	if late := r.Add(3); late.Context().Err() == nil {
		t.Fatal("a window added after Close was not cancelled")
	}
}

func TestConcurrentUse(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	for i := range 32 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			w := r.Add(id)
			if got, ok := r.Get(id); !ok || got != w {
				t.Errorf("Get(%d) missing after Add", id)
			}
			_ = r.Len()
			_ = r.IDs()
			r.Remove(id)
		}(i)
	}
	wg.Wait()
	if r.Len() != 0 {
		t.Fatalf("Len() = %d after removing all, want 0", r.Len())
	}
}
