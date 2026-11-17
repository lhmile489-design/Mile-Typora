package service

import (
	"context"
	"unicode/utf8"

	"github.com/lhmile489-design/mile-typora/internal/contract"
	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/markdown"
)

// ExtractOutline returns the headings of the page's buffer or document for the
// left outline (M5-2 VIEW-02). It parses the source with the same GFM rules as
// the renderer and never writes anything.
func (s *WindowService) ExtractOutline(ctx context.Context, text string) (contract.OutlineResult, error) {
	if _, err := s.callerWindow(ctx); err != nil {
		return contract.OutlineResult{}, err
	}
	if !utf8.ValidString(text) {
		return contract.OutlineResult{Failure: &contract.Failure{
			Code:   "encoding",
			Detail: "编辑内容不是有效的 UTF-8",
		}}, nil
	}
	if len(text) > docread.MaxBytes {
		return contract.OutlineResult{Failure: &contract.Failure{
			Code:   "too_large",
			Detail: "文档超过读取上限",
			Size:   int64(len(text)),
			Limit:  docread.MaxBytes,
		}}, nil
	}
	headings, truncated := markdown.Outline([]byte(text))
	out := make([]contract.OutlineHeading, 0, len(headings))
	for _, heading := range headings {
		out = append(out, contract.OutlineHeading{
			Level: heading.Level,
			Text:  heading.Text,
			Line:  heading.Line,
		})
	}
	return contract.OutlineResult{Headings: out, Truncated: truncated}, nil
}
