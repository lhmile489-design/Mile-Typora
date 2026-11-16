package service

import (
	"context"
	"errors"
	"testing"
)

func TestCloseWindowClosesTheCallingWindow(t *testing.T) {
	s, _ := newTestService(5, true)
	closed := 0
	s.closeWindow = func(id int) error {
		closed = id
		return nil
	}
	if err := s.CloseWindow(context.Background()); err != nil {
		t.Fatalf("CloseWindow: %v", err)
	}
	if closed != 5 {
		t.Fatalf("closed window %d, want 5", closed)
	}
}

func TestCloseWindowRefusesAnUnregisteredWindow(t *testing.T) {
	s, _ := newTestService(6, false)
	err := s.CloseWindow(context.Background())
	if !errors.Is(err, ErrWindowNotOpen) {
		t.Fatalf("error = %v, want ErrWindowNotOpen", err)
	}
}
