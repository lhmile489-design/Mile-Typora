package service

import (
	"context"

	"github.com/egoist/mygo"
)

// ClipboardReadText returns the system clipboard's plain text (P1 EDIT-06).
func (s *WindowService) ClipboardReadText(ctx context.Context) (string, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return "", err
	}
	return mygo.Clipboard.ReadText(), nil
}

// ClipboardWriteText puts plain text on the system clipboard.
func (s *WindowService) ClipboardWriteText(ctx context.Context, text string) error {
	if _, err := s.callerWindow(ctx); err != nil {
		return err
	}
	mygo.Clipboard.WriteText(text)
	return nil
}
