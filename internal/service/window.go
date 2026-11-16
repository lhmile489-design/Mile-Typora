// Package service holds the bound services the frontend calls.
package service

import (
	"context"
	"errors"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/winctx"
)

var (
	// ErrNoCallerWindow means a call arrived without a calling window.
	ErrNoCallerWindow = errors.New("no calling window")
	// ErrWindowNotOpen means the calling window is not in the registry, which
	// is a program defect: every window is registered when it is created.
	ErrWindowNotOpen = errors.New("calling window is not open")
)

// Opener creates a native window and returns its ID. main supplies one that
// registers the window; tests supply their own.
type Opener func() (int, error)

// WindowService manages the windows of the app.
type WindowService struct {
	// caller finds the calling window's ID; tests replace it.
	caller  func(ctx context.Context) (int, bool)
	version func() string
	windows *winctx.Registry
	open    Opener
}

// NewWindowService returns a WindowService over the open windows.
func NewWindowService(windows *winctx.Registry, open Opener) *WindowService {
	return &WindowService{
		caller: func(ctx context.Context) (int, bool) {
			w := mygo.CallerWindow(ctx)
			if w == nil {
				return 0, false
			}
			return w.ID(), true
		},
		version: mygo.App.Version,
		windows: windows,
		open:    open,
	}
}

// callerWindow resolves the window a call came from. The window ID the page
// might send is never trusted (CLAUDE.md §5.3).
func (s *WindowService) callerWindow(ctx context.Context) (*winctx.Window, error) {
	id, ok := s.caller(ctx)
	if !ok {
		return nil, ErrNoCallerWindow
	}
	w, ok := s.windows.Get(id)
	if !ok {
		return nil, ErrWindowNotOpen
	}
	return w, nil
}

// Ready is the page's handshake: it identifies the calling window. The page
// then asks for its open requests with Pending, and acknowledges each one.
func (s *WindowService) Ready(ctx context.Context) (contract.ReadyInfo, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.ReadyInfo{}, err
	}
	w.MarkReady()
	return contract.ReadyInfo{WindowID: w.ID(), Version: s.version()}, nil
}

// Pending returns the open requests after seq that the page has not
// acknowledged. A page that remounts or reloads asks again and loses nothing
// (PRD §9.2.3: no request is dropped silently).
func (s *WindowService) Pending(ctx context.Context, after int64) (contract.PendingResult, error) {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return contract.PendingResult{}, err
	}
	return contract.PendingResult{Requests: openRequests(w.PendingSince(after))}, nil
}

// Ack confirms that the page handled every request up to seq, which frees the
// window's queue.
func (s *WindowService) Ack(ctx context.Context, seq int64) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	w.Ack(seq)
	return nil
}

// openRequests converts queued requests to the page's contract type.
func openRequests(intents []winctx.Intent) []contract.OpenRequest {
	out := make([]contract.OpenRequest, len(intents))
	for i, it := range intents {
		out[i] = contract.OpenRequest{Seq: it.Seq, Path: it.Path}
	}
	return out
}

// NewWindow opens another window (PRD FR-02). The reuse matrix of M2-2 decides
// whether a blank window is taken over instead; the toolbar's "新建窗口" always
// opens one.
func (s *WindowService) NewWindow(ctx context.Context) (contract.NewWindowResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.NewWindowResult{}, err
	}
	id, err := s.open()
	if err != nil {
		// Expected failure: the page shows it and keeps reading (PRD §7.2).
		return contract.NewWindowResult{Failure: &contract.Failure{
			Code:   "window_failed",
			Detail: "无法创建新窗口，请关闭其他窗口后重试",
		}}, nil
	}
	return contract.NewWindowResult{WindowID: id}, nil
}
