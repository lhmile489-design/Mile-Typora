package service

import (
	"context"
	"testing"

	"github.com/lhmile489-design/mile-typora/internal/contract"
)

func TestWindowViewAndZoomClamp(t *testing.T) {
	s, _ := newTestService(3, true)
	var zoom float64 = 1
	state := func() contract.WindowViewState {
		return contract.WindowViewState{Zoom: zoom}
	}
	s.viewState = func(int) (contract.WindowViewState, error) { return state(), nil }
	s.setZoom = func(_ int, factor float64) (contract.WindowViewState, error) {
		zoom = factor
		return state(), nil
	}
	if got, _ := s.GetWindowView(context.Background()); got.Zoom != 1 {
		t.Fatalf("initial view = %+v", got)
	}
	if got, _ := s.SetZoom(context.Background(), 3); got.Zoom != 2 {
		t.Fatalf("upper clamp = %+v", got)
	}
	if got, _ := s.SetZoom(context.Background(), 0.2); got.Zoom != 0.5 {
		t.Fatalf("lower clamp = %+v", got)
	}
}

func TestCycleWindowUsesMRUAndSkipsSingleWindow(t *testing.T) {
	s, reg := newTestService(1, true)
	reg.Add(2)
	reg.Add(3)
	focused := 0
	s.focusWindow = func(id int) bool {
		focused = id
		return true
	}
	// Focus history: 2 then 1, so 1 → 2 → 3 → 1.
	s.RecordFocus(2)
	s.RecordFocus(1)
	if result, _ := s.CycleWindow(context.Background(), false); result.Failure != nil || focused != 2 {
		t.Fatalf("forward: focused=%d result=%+v", focused, result)
	}
	focused = 0
	if result, _ := s.CycleWindow(context.Background(), true); result.Failure != nil || focused != 3 {
		t.Fatalf("backward: focused=%d result=%+v", focused, result)
	}

	single, singleReg := newTestService(9, true)
	single.focusWindow = func(int) bool {
		t.Fatal("single window must not focus another")
		return false
	}
	_ = singleReg
	if result, _ := single.CycleWindow(context.Background(), false); result.Failure != nil {
		t.Fatalf("single window result = %+v", result)
	}
}

func TestCountWordsBinding(t *testing.T) {
	s, _ := newTestService(4, true)
	count, err := s.CountWords(context.Background(), "# 标题\n\n正文", false)
	if err != nil || count.Words != 4 || count.Paragraphs != 2 {
		t.Fatalf("CountWords = %+v, %v", count, err)
	}
}
