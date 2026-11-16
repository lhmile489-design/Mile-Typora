package winctx

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestPushKeepsOrderBeforeReady(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	for _, p := range []string{"a.md", "b.md", "c.md"} {
		if _, err := w.Push(p); err != nil {
			t.Fatalf("Push(%q): %v", p, err)
		}
	}
	w.MarkReady()
	got := w.PendingSince(0)
	if len(got) != 3 {
		t.Fatalf("PendingSince(0) returned %d requests, want 3", len(got))
	}
	for i, want := range []string{"a.md", "b.md", "c.md"} {
		if got[i].Path != want {
			t.Fatalf("request %d = %q, want %q", i, got[i].Path, want)
		}
		if got[i].Seq != int64(i+1) {
			t.Fatalf("request %d has seq %d, want %d", i, got[i].Seq, i+1)
		}
	}
}

func TestPendingIsRepeatableUntilAcknowledged(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	w.Push("a.md")
	w.MarkReady()
	if got := w.PendingSince(0); len(got) != 1 {
		t.Fatalf("first PendingSince = %d requests, want 1", len(got))
	}
	// A page that remounted asks again and still gets the request.
	if got := w.PendingSince(0); len(got) != 1 {
		t.Fatalf("second PendingSince = %d requests, want the request again", len(got))
	}
	w.Ack(1)
	if got := w.PendingSince(0); len(got) != 0 {
		t.Fatalf("PendingSince after Ack = %d requests, want 0", len(got))
	}
	if w.Pending() != 0 {
		t.Fatalf("Pending() = %d after Ack, want 0", w.Pending())
	}
}

func TestAckDropsOnlyHandledRequests(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	for _, p := range []string{"a.md", "b.md", "c.md"} {
		w.Push(p)
	}
	w.MarkReady()
	w.Ack(2)
	got := w.PendingSince(0)
	if len(got) != 1 || got[0].Path != "c.md" {
		t.Fatalf("PendingSince after Ack(2) = %+v, want only c.md", got)
	}
	// An older acknowledgement never rewinds.
	w.Ack(1)
	if w.Pending() != 1 {
		t.Fatalf("Pending() = %d after a stale Ack, want 1", w.Pending())
	}
}

func TestPushAfterReadyNotifiesInOrder(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	var got []Intent
	w.SetNotify(func(it Intent) error {
		got = append(got, it)
		return nil
	})
	w.Push("before.md")
	w.MarkReady()
	for _, p := range []string{"x.md", "y.md"} {
		if _, err := w.Push(p); err != nil {
			t.Fatalf("Push(%q): %v", p, err)
		}
	}
	if len(got) != 2 || got[0].Path != "x.md" || got[1].Path != "y.md" {
		t.Fatalf("delivered %+v, want x.md then y.md", got)
	}
	if got[0].Seq >= got[1].Seq {
		t.Fatalf("seqs %d, %d are not increasing", got[0].Seq, got[1].Seq)
	}
}

func TestFailedNotifyKeepsTheRequest(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	w.SetNotify(func(Intent) error { return errors.New("page closed") })
	w.MarkReady()
	if _, err := w.Push("again.md"); err != nil {
		t.Fatalf("Push: %v", err)
	}
	if got := w.PendingSince(0); len(got) != 1 {
		t.Fatalf("the request was lost when the event failed: %+v", got)
	}
}

func TestQueueFullKeepsExistingRequests(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	for i := range MaxIntents {
		if _, err := w.Push(fmt.Sprintf("%d.md", i)); err != nil {
			t.Fatalf("Push %d: %v", i, err)
		}
	}
	if _, err := w.Push("overflow.md"); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("Push beyond the limit = %v, want ErrQueueFull", err)
	}
	got := w.PendingSince(0)
	if len(got) != MaxIntents {
		t.Fatalf("PendingSince returned %d requests, want %d", len(got), MaxIntents)
	}
	// Acknowledging frees room again.
	w.Ack(int64(MaxIntents))
	if _, err := w.Push("after-ack.md"); err != nil {
		t.Fatalf("Push after Ack: %v", err)
	}
}

func TestUnreadyStopsNotifications(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	var delivered int
	w.SetNotify(func(Intent) error { delivered++; return nil })
	w.MarkReady()
	w.Unready()
	if _, err := w.Push("after-reload.md"); err != nil {
		t.Fatalf("Push: %v", err)
	}
	if delivered != 0 {
		t.Fatalf("delivered %d requests while not ready, want 0", delivered)
	}
	if got := w.PendingSince(0); len(got) != 1 {
		t.Fatalf("PendingSince after a reload = %d requests, want 1", len(got))
	}
}

func TestConcurrentPushesGetUniqueSeqs(t *testing.T) {
	r := NewRegistry()
	w := r.Add(1)
	const n = 32
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := w.Push(fmt.Sprintf("%d.md", i)); err != nil {
				t.Errorf("Push %d: %v", i, err)
			}
		}(i)
	}
	wg.Wait()
	w.MarkReady()
	got := w.PendingSince(0)
	if len(got) != n {
		t.Fatalf("PendingSince returned %d requests, want %d", len(got), n)
	}
	seen := make(map[int64]bool, n)
	for _, it := range got {
		if seen[it.Seq] {
			t.Fatalf("seq %d handed out twice", it.Seq)
		}
		seen[it.Seq] = true
	}
}
