package service

import (
	"context"
	"errors"
	"testing"
)

func TestReadyReturnsCallerWindow(t *testing.T) {
	s := &WindowService{
		callerID: func(context.Context) (int, bool) { return 7, true },
		version:  func() string { return "0.1.0" },
	}
	got, err := s.Ready(context.Background())
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got.WindowID != 7 || got.Version != "0.1.0" {
		t.Fatalf("Ready = %+v, want window 7 version 0.1.0", got)
	}
}

func TestReadyWithoutCallerWindow(t *testing.T) {
	s := &WindowService{
		callerID: func(context.Context) (int, bool) { return 0, false },
		version:  func() string { return "0.1.0" },
	}
	if _, err := s.Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}

func TestNewWindowServiceOutsideCall(t *testing.T) {
	// A context that did not come from a page call has no window.
	if _, err := NewWindowService().Ready(context.Background()); !errors.Is(err, ErrNoCallerWindow) {
		t.Fatalf("Ready error = %v, want ErrNoCallerWindow", err)
	}
}
