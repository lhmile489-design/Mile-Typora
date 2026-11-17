// Package search finds text in the Markdown files of an authorized folder
// (P2 VIEW-05). It only walks files scan already accepted: no links, no
// junctions, no files above the reader's size limit.
package search

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/lhmile489-design/mile-typora/internal/docread"
	"github.com/lhmile489-design/mile-typora/internal/scan"
)

// Bounds from P2 §5.2 and §14.
const (
	MaxMatches = 500
	MaxFiles   = 200
	MaxText    = 300
)

// Match is one result row. Path is relative to the search root, separated by
// slashes. Line is 1-based; IsName marks a file-name match, which has no line.
type Match struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Line   int    `json:"line,omitempty"`
	Text   string `json:"text,omitempty"`
	IsName bool   `json:"isName,omitempty"`
}

// Result is what a complete search found before a bound or cancellation.
type Result struct {
	Matches   []Match
	Files     int
	Truncated bool
}

// Options overrides the bounds; zero uses the constants above.
type Options struct {
	MaxMatches int
	MaxFiles   int
}

func (o Options) withDefaults() Options {
	if o.MaxMatches <= 0 {
		o.MaxMatches = MaxMatches
	}
	if o.MaxFiles <= 0 {
		o.MaxFiles = MaxFiles
	}
	return o
}

// Run searches root and calls emit with each file's matches as they are
// found. Returning an error from emit stops the walk (the page closed the
// channel). Search calls Run without an emitter.
func Run(ctx context.Context, root, query string, opts Options, emit func([]Match) error) (Result, error) {
	opts = opts.withDefaults()
	q := strings.TrimSpace(query)
	if q == "" {
		return Result{}, nil
	}
	needle := strings.ToLower(q)
	tree, err := scan.Scan(ctx, root, scan.Options{})
	if err != nil {
		return Result{}, err
	}
	var result Result
	result.Truncated = tree.Truncated
	for _, entry := range tree.Entries {
		if entry.IsDir {
			continue
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if result.Files >= opts.MaxFiles || len(result.Matches) >= opts.MaxMatches {
			result.Truncated = true
			break
		}
		matches := matchFile(root, entry, needle, opts, &result)
		if len(matches) == 0 {
			continue
		}
		result.Files++
		result.Matches = append(result.Matches, matches...)
		if emit != nil {
			if err := emit(matches); err != nil {
				return result, err
			}
		}
	}
	return result, nil
}

// Search is Run for callers that want the complete result at once.
func Search(ctx context.Context, root, query string, opts Options) (Result, error) {
	return Run(ctx, root, query, opts, nil)
}

// matchFile checks one scan entry: its name first, then its lines. A file
// counts against MaxFiles once it has at least one match; the bound limits
// result files, not how many files are inspected.
func matchFile(root string, entry scan.Entry, needle string, opts Options, result *Result) []Match {
	matches := make([]Match, 0, 4)
	if strings.Contains(strings.ToLower(entry.Name), needle) {
		matches = append(matches, Match{Path: entry.Path, Name: entry.Name, IsName: true})
		if len(result.Matches)+len(matches) >= opts.MaxMatches {
			result.Truncated = true
			return matches
		}
	}
	doc, failure := docread.Read(filepath.Join(root, filepath.FromSlash(entry.Path)))
	if failure != nil {
		return matches
	}
	for i, line := range strings.Split(doc.Text, "\n") {
		if !strings.Contains(strings.ToLower(line), needle) {
			continue
		}
		if len(result.Matches)+len(matches) >= opts.MaxMatches {
			result.Truncated = true
			break
		}
		matches = append(matches, Match{
			Path: entry.Path,
			Name: entry.Name,
			Line: i + 1,
			Text: truncate(line),
		})
	}
	return matches
}

func truncate(line string) string {
	line = strings.TrimSpace(line)
	runes := []rune(line)
	if len(runes) <= MaxText {
		return line
	}
	return string(runes[:MaxText]) + "…"
}
