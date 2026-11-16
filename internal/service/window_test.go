package service

import (
	"context"
	"errors"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

func newTestService(callerID int, registered bool) (*WindowService, *winctx.Registry) {
	reg := winctx.NewRegistry()
	if registered {
		reg.Add(callerID)
	}
	return &WindowService{
		caller:  func(context.Context) (int, bool) { return callerID, true },
		version: func() string { return "0.1.0" },
		windows: reg,
		open:    func() (int, error) { return 99, nil },
	}, reg
}

func TestReadyReturnsCallerWindow(t *testing.T) {
	s, _ := newTestService(7, true)
	got, err := s.Ready(context.Background())
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got.WindowID != 7 || got.Version != "0.1.0" {
		t.Fatalf("Ready = %+v, want window 7 version 0.1.0", got)
	}
}

func TestReadyWithoutCallerWindow(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func TestReadyForUnregisteredWindow(t *testing.T) {
	s, _ := newTestService(5, false)
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrWindowNotOpen) {
		t.Fatalf("Ready error = %v, want ErrWindowNotOpen", err)
	}
}

func TestNewWindowWindowOpensAndRegisters(t *testing.T) {
	s, reg := newTestService(1, true)
	opened := 0
	s.open = func() (int, error) {
		opened++
		id := 100 + opened
		reg.Add(id) // main registers a window as it creates it
		return id, nil
	}
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("NewWindow failure = %+v, want none", got.Failure)
	}
	if got.WindowID != 101 {
		t.Fatalf("NewWindow window = %d, want 101", got.WindowID)
	}
	if reg.Len() != 2 {
		t.Fatalf("registry has %d windows, want 2", reg.Len())
	}
}

func TestNewWindowReportsExpectedFailure(t *testing.T) {
	s, _ := newTestService(1, true)
	s.open = func() (int, error) { return 0, errors.New("no display") }
	got, err := s.NewWindow(context.Background())
	if err != nil {
		t.Fatalf("NewWindow returned an unexpected error: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "window_failed" || got.Failure.Detail == "" {
		t.Fatalf("NewWindow = %+v, want a window_failed failure with a detail", got)
	}
}

func TestPendingReturnsQueuedRequestsInOrder(t *testing.T) {
	s, reg := newTestService(1, true)
	w, _ := reg.Get(1)
	for _, p := range []string{"a.md", "b.md"} {
		if _, err := w.Push(p); err != nil {
			t.Fatalf("Push(%q): %v", p, err)
		}
	}
	if _, err := s.Ready(context.Background()); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	got, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(got.Requests) != 2 || got.Requests[0].Path != "a.md" || got.Requests[1].Path != "b.md" {
		t.Fatalf("Pending requests = %+v, want a.md then b.md", got.Requests)
	}
	// Asking again, as a remounted page does, still returns them.
	again, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("second Pending: %v", err)
	}
	if len(again.Requests) != 2 {
		t.Fatalf("second Pending returned %d requests, want both again", len(again.Requests))
	}
	if err := s.Ack(context.Background(), 2); err != nil {
		t.Fatalf("Ack: %v", err)
	}
	after, err := s.Pending(context.Background(), 0)
	if err != nil {
		t.Fatalf("Pending after Ack: %v", err)
	}
	if len(after.Requests) != 0 {
		t.Fatalf("Pending after Ack = %+v, want none", after.Requests)
	}
}

func TestNewWindowRequiresCaller(t *testing.T) {
	s, _ := newTestService(1, true)
	s.caller = func(context.Context) (int, bool) { return 0, false }
	if _, err := s.NewWindow(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("NewWindow error = %v, want ErrNoCallerWindow", err)
	}
}

func TestNewWindowServiceOutsideCall(t *testing.T) {
	// A context that did not come from a page call has no window.
	s := NewWindowService(winctx.NewRegistry(), func() (int, error) { return 1, nil })
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}
