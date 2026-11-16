package markdown

import (
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// The math of PRD FR-04: an inline `$…$` or `\(…\)`, and a block that stands
// on its own lines, `$$…$$` or `\[…\]`. The page renders the TeX with KaTeX;
// this package only keeps it intact.
//
// Inline formulas are a parser here. Block delimiters are rewritten before
// parsing into a fence with the language "mtmath", because goldmark's block
// parsers swallowed the lines between the delimiters when tried directly.
// Pass-through v0.6.0 was tried too; its block form never produced a node.

// MathInline is a formula that sits in a line of text.
type MathInline struct {
	ast.BaseInline
	// Tex is the segment between the delimiters.
	Tex text.Segment
}

// KindMathInline is the node kind of MathInline.
var KindMathInline = ast.NewNodeKind("MathInline")

// Kind implements ast.Node.Kind.
func (n *MathInline) Kind() ast.NodeKind { return KindMathInline }

// Dump implements ast.Node.Dump.
func (n *MathInline) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

// mathExtension registers the inline parser.
type mathExtension struct{}

// Math returns the extension that parses formulas.
func Math() goldmark.Extender { return mathExtension{} }

// Extend implements goldmark.Extender.
func (mathExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithInlineParsers(util.Prioritized(&mathInlineParser{}, 500)),
	)
}

// mathInlineParser reads `$…$` and `\(…\)` formulas.
type mathInlineParser struct{}

// Trigger implements parser.InlineParser.
func (p *mathInlineParser) Trigger() []byte { return []byte{'$', '\\'} }

// Parse implements parser.InlineParser.
func (p *mathInlineParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, segment := block.PeekLine()
	open, ok := inlineOpener(line)
	if !ok {
		return nil
	}
	start := segment.Start + len(open)
	rest := line[len(open):]
	closeAt := indexDelimiter(rest, closerOf(open))
	if closeAt < 0 {
		return nil
	}
	block.Advance(len(open) + closeAt + len(closerOf(open)))
	return &MathInline{Tex: text.NewSegment(start, start+closeAt)}
}

func closerOf(open string) string {
	if open == `\(` {
		return `\)`
	}
	return open
}

func inlineOpener(line []byte) (string, bool) {
	for _, open := range []string{"$", `\(`} {
		if len(line) >= len(open) && string(line[:len(open)]) == open {
			return open, true
		}
	}
	return "", false
}

func indexDelimiter(line []byte, close string) int {
	for i := 0; i+len(close) <= len(line); i++ {
		if string(line[i:i+len(close)]) != close {
			continue
		}
		// An escaped dollar belongs to the text.
		if close == "$" && i > 0 && line[i-1] == '\\' {
			continue
		}
		return i
	}
	return -1
}

// blockMathLang is the fence language preprocessMath writes and renderFence
// answers for.
const blockMathLang = "mtmath"

// preprocessMath rewrites `$$…$$` and `\[…\]` blocks as fences, leaving code
// fences and unmatched delimiters alone.
func preprocessMath(src []byte) []byte {
	lines := strings.Split(string(src), "\n")
	out := make([]string, 0, len(lines))
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if fence, ok := fenceOpener(line); ok {
			// Copy the whole code fence untouched.
			out = append(out, line)
			for i++; i < len(lines); i++ {
				out = append(out, lines[i])
				if closesFence(lines[i], fence) {
					break
				}
			}
			continue
		}

		closer, ok := blockMathDelimiter(trimmed)
		if !ok {
			out = append(out, line)
			continue
		}
		end := -1
		for j := i + 1; j < len(lines); j++ {
			if strings.TrimSpace(lines[j]) == closer {
				end = j
				break
			}
		}
		if end < 0 {
			// No closer: the delimiters are ordinary text.
			out = append(out, line)
			continue
		}
		body := lines[i+1 : end]
		fence := strings.Repeat("`", fenceLength(body))
		out = append(out, fence+blockMathLang)
		out = append(out, body...)
		out = append(out, fence)
		i = end
	}
	return []byte(strings.Join(out, "\n"))
}

// blockMathDelimiter returns the closing delimiter for a block opening.
func blockMathDelimiter(trimmed string) (string, bool) {
	switch trimmed {
	case "$$":
		return "$$", true
	case `\[`:
		return `\]`, true
	}
	return "", false
}

// fenceLength picks a fence longer than any run of backticks in the body, so
// the body can never close it early.
func fenceLength(body []string) int {
	longest, run := 0, 0
	for _, line := range body {
		for _, c := range line {
			if c == '`' {
				run++
				if run > longest {
					longest = run
				}
			} else {
				run = 0
			}
		}
		run = 0
	}
	if longest < 3 {
		return 3
	}
	return longest + 1
}

// fenceOpener reports the fence that opens a code block, if the line opens one.
func fenceOpener(line string) (string, bool) {
	trimmed := strings.TrimLeft(line, " ")
	if len(line)-len(trimmed) > 3 {
		return "", false
	}
	for _, marker := range []string{"```", "~~~"} {
		if strings.HasPrefix(trimmed, marker) {
			n := 0
			for n < len(trimmed) && trimmed[n] == marker[0] {
				n++
			}
			if n >= 3 {
				return strings.Repeat(string(marker[0]), n), true
			}
		}
	}
	return "", false
}

// closesFence reports whether the line closes the fence that opened with open.
func closesFence(line, open string) bool {
	trimmed := strings.TrimSpace(line)
	if len(trimmed) < len(open) || trimmed[0] != open[0] {
		return false
	}
	n := 0
	for n < len(trimmed) && trimmed[n] == open[0] {
		n++
	}
	return n >= len(open) && strings.TrimSpace(trimmed[n:]) == ""
}
