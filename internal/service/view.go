package service

import (
	"context"
	"math"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
)

// CountWords returns the read-only word statistics for the source the page
// sends (VIEW-10).
func (s *WindowService) CountWords(ctx context.Context, source string, selection bool) (contract.WindowCount, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.WindowCount{}, err
	}
	count := markdown.CountWords([]byte(source))
	if selection {
		count = markdown.CountWordsSelection([]byte(source))
	}
	return contract.WindowCount{
		Characters:         count.Characters,
		CharactersNoSpaces: count.CharactersNoSpaces,
		Words:              count.Words,
		Paragraphs:         count.Paragraphs,
	}, nil
}

// GetWindowView returns the current window's fullscreen, topmost and zoom
// state for the View menu (M5-7 VIEW-11..15).
func (s *WindowService) GetWindowView(ctx context.Context) (contract.WindowViewState, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.WindowViewState{}, err
	}
	if s.viewState == nil {
		return contract.WindowViewState{Failure: nil, Zoom: 1}, nil
	}
	return s.viewState(w.ID())
}

// SetFullScreen changes only the calling window (M5-7 VIEW-11).
func (s *WindowService) SetFullScreen(ctx context.Context, value bool) (contract.WindowViewState, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.WindowViewState{}, err
	}
	if s.setFullScreen == nil {
		return contract.WindowViewState{Failure: failFile("view_unavailable", "窗口视图控制不可用")}, nil
	}
	return s.setFullScreen(w.ID(), value)
}

// SetAlwaysOnTop changes only the calling window (M5-7 VIEW-12).
func (s *WindowService) SetAlwaysOnTop(ctx context.Context, value bool) (contract.WindowViewState, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.WindowViewState{}, err
	}
	if s.setAlwaysOnTop == nil {
		return contract.WindowViewState{Failure: failFile("view_unavailable", "窗口视图控制不可用")}, nil
	}
	return s.setAlwaysOnTop(w.ID(), value)
}

// SetZoom sets the calling window's whole-page zoom, clamped to 50%..200%
// (M5-7 VIEW-13..15).
func (s *WindowService) SetZoom(ctx context.Context, factor float64) (contract.WindowViewState, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.WindowViewState{}, err
	}
	if s.setZoom == nil {
		return contract.WindowViewState{Failure: failFile("view_unavailable", "窗口视图控制不可用")}, nil
	}
	if math.IsNaN(factor) || math.IsInf(factor, 0) {
		return contract.WindowViewState{Failure: failFile("zoom_invalid", "缩放比例无效")}, nil
	}
	factor = math.Round(factor*100) / 100
	factor = math.Max(0.5, math.Min(2, factor))
	return s.setZoom(w.ID(), factor)
}

// CycleWindow activates the next app window in MRU order (M5-7 VIEW-16).
func (s *WindowService) CycleWindow(ctx context.Context, backwards bool) (contract.WindowCycleResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.WindowCycleResult{}, err
	}
	order := s.windows.Order()
	if len(order) <= 1 {
		return contract.WindowCycleResult{}, nil
	}
	s.touchWindowMRU(w.ID())
	sequence := s.windowSequence(order)
	if len(sequence) <= 1 {
		return contract.WindowCycleResult{}, nil
	}
	current := 0
	for i, id := range sequence {
		if id == w.ID() {
			current = i
			break
		}
	}
	step := 1
	if backwards {
		step = -1
	}
	target := sequence[(current+step+len(sequence))%len(sequence)]
	if target == w.ID() {
		return contract.WindowCycleResult{}, nil
	}
	if s.focusWindow == nil || !s.focusWindow(target) {
		return contract.WindowCycleResult{Failure: failFile("cycle_failed", "无法切换到另一个窗口")}, nil
	}
	return contract.WindowCycleResult{}, nil
}

func (s *WindowService) touchWindowMRU(id int) {
	s.windowMRUMu.Lock()
	defer s.windowMRUMu.Unlock()
	for i, current := range s.windowMRU {
		if current == id {
			s.windowMRU = append(s.windowMRU[:i], s.windowMRU[i+1:]...)
			break
		}
	}
	s.windowMRU = append([]int{id}, s.windowMRU...)
}

// windowSequence is the MRU order with creation order as a fallback for
// windows the user has not focused yet.
func (s *WindowService) windowSequence(order []int) []int {
	open := make(map[int]bool, len(order))
	for _, id := range order {
		open[id] = true
	}
	s.windowMRUMu.Lock()
	mru := append([]int(nil), s.windowMRU...)
	s.windowMRUMu.Unlock()
	seen := make(map[int]bool, len(order))
	sequence := make([]int, 0, len(order))
	for _, id := range mru {
		if open[id] && !seen[id] {
			sequence = append(sequence, id)
			seen[id] = true
		}
	}
	for _, id := range order {
		if !seen[id] {
			sequence = append(sequence, id)
			seen[id] = true
		}
	}
	return sequence
}
