package service

import (
	"context"
	"errors"
	"strings"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/search"
)

// errSearchChannel means the page stopped reading the search channel.
var errSearchChannel = errors.New("search channel closed")

// SearchDirectory streams text matches from the window's authorized folder
// (M5-2 VIEW-05). Closing the channel cancels the walk.
func (s *WindowService) SearchDirectory(ctx context.Context, query string, frames *mygo.Channel[contract.SearchFrame]) error {
	w, err := s.callerWindow(ctx)
	if err != nil {
		return err
	}
	root, ok := w.Root()
	if !ok {
		_ = frames.Send(contract.SearchFrame{Done: true, Failure: &contract.Failure{
			Code:   "no_folder",
			Detail: "尚未打开文件夹",
		}})
		return nil
	}
	if strings.TrimSpace(query) == "" {
		_ = frames.Send(contract.SearchFrame{Done: true})
		return nil
	}
	result, err := search.Run(ctx, root, query, search.Options{}, func(matches []search.Match) error {
		out := make([]contract.SearchMatch, 0, len(matches))
		for _, match := range matches {
			out = append(out, contract.SearchMatch{
				Path:   match.Path,
				Name:   match.Name,
				Line:   match.Line,
				Text:   match.Text,
				IsName: match.IsName,
			})
		}
		if err := frames.Send(contract.SearchFrame{Matches: out}); err != nil {
			return errSearchChannel
		}
		return nil
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, errSearchChannel) || errors.Is(err, mygo.ErrChannelClosed) {
			return nil
		}
		_ = frames.Send(contract.SearchFrame{Done: true, Failure: &contract.Failure{
			Code:   "search_failed",
			Detail: "无法搜索此目录",
		}})
		return nil
	}
	_ = frames.Send(contract.SearchFrame{Done: true, Truncated: result.Truncated, Files: result.Files})
	return nil
}
