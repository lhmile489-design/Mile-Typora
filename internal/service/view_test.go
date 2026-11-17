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

// M6-6 VIEW-17: the inspector stays shut unless the diagnostic mode armed it,
// and the isolated print views never get one.
func TestOpenDevToolsRefusesWithoutDiagnosticMode(t *testing.T) {
	s, _ := newTestService(5, true)
	withState(t, s)
	opened := -1
	s.openDevTools = func(id int) { opened = id }
	s.isPrintWindow = func(int) bool { return false }

	got, err := s.OpenDevTools(context.Background())
	if err != nil {
		t.Fatalf("OpenDevTools: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "devtools_disabled" {
		t.Fatalf("result = %+v, want devtools_disabled", got)
	}
	if opened != -1 {
		t.Fatalf("opened = %d, want no inspector without the mode", opened)
	}
}

func TestOpenDevToolsRefusesPrintWindow(t *testing.T) {
	s, _ := newTestService(6, true)
	store := withState(t, s)
	on := true
	settings := store.Get()
	settings.DiagnosticMode = &on
	if err := store.Save(settings); err != nil {
		t.Fatalf("Save: %v", err)
	}
	opened := -1
	s.openDevTools = func(id int) { opened = id }
	s.isPrintWindow = func(id int) bool { return id == 6 }

	got, err := s.OpenDevTools(context.Background())
	if err != nil {
		t.Fatalf("OpenDevTools: %v", err)
	}
	if got.Failure == nil || got.Failure.Code != "devtools_unavailable" {
		t.Fatalf("result = %+v, want devtools_unavailable", got)
	}
	if opened != -1 {
		t.Fatalf("opened = %d, want no inspector on a print view", opened)
	}
}

func TestOpenDevToolsOpensArmedWindow(t *testing.T) {
	s, _ := newTestService(7, true)
	store := withState(t, s)
	on := true
	settings := store.Get()
	settings.DiagnosticMode = &on
	if err := store.Save(settings); err != nil {
		t.Fatalf("Save: %v", err)
	}
	opened := -1
	s.openDevTools = func(id int) { opened = id }
	s.isPrintWindow = func(int) bool { return false }

	got, err := s.OpenDevTools(context.Background())
	if err != nil {
		t.Fatalf("OpenDevTools: %v", err)
	}
	if got.Failure != nil {
		t.Fatalf("result = %+v, want the inspector open", got)
	}
	if opened != 7 {
		t.Fatalf("opened = %d, want the calling window's inspector", opened)
	}
}
