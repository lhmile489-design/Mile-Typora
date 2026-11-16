// Package service holds the bound services the frontend calls.
package service

import (
	"context"
	"errors"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
)

// ErrNoCallerWindow means a call arrived without a calling window, which is
// a program defect rather than an expected failure.
var ErrNoCallerWindow = errors.New("no calling window")

// WindowService manages the windows of the app.
type WindowService struct {
	// callerID finds the calling window's ID; tests replace it.
	callerID func(ctx context.Context) (int, bool)
	version  func() string
}

// NewWindowService returns a WindowService that uses the mygo runtime.
func NewWindowService() *WindowService {
	return &WindowService{
		callerID: func(ctx context.Context) (int, bool) {
			w := mygo.CallerWindow(ctx)
			if w == nil {
				return 0, false
			}
			return w.ID(), true
		},
		version: mygo.App.Version,
	}
}

// Ready is the page's handshake: it identifies the calling window. Later
// stages deliver the window's queued open requests from here.
func (s *WindowService) Ready(ctx context.Context) (contract.ReadyInfo, error) {
	id, ok := s.callerID(ctx)
	if !ok {
		return contract.ReadyInfo{}, ErrNoCallerWindow
	}
	return contract.ReadyInfo{WindowID: id, Version: s.version()}, nil
}
