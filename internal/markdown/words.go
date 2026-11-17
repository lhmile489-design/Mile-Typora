package markdown

import (
	"regexp"
	"strings"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// WordCount is the read-only statistics VIEW-10 shows.
type WordCount struct {
	Characters         int
	CharactersNoSpaces int
	Words              int
	Paragraphs         int
}

var htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)

// CountWords applies P2 §10.6 to a whole document: front matter is excluded.
func CountWords(src []byte) WordCount {
	return countWords(src, true)
}

// CountWordsSelection applies the same rules to a selected range. A selection
// is not a document, so a leading "---" is a thematic break, not front matter.
func CountWordsSelection(src []byte) WordCount {
	return countWords(src, false)
}

func countWords(src []byte, stripFrontMatter bool) WordCount {
	body := src
	if stripFrontMatter {
		_, body = splitFrontMatter(src)
	}
	body = preprocessMath(body)
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, extension.Footnote, Math()),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
	)
	doc := md.Parser().Parse(text.NewReader(body))
	builder := &wordCounter{}
	ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.Paragraph:
			builder.paragraphs++
			builder.inLatin = false
		case *ast.Heading:
			builder.paragraphs++
			builder.inLatin = false
		case *ast.ListItem:
			if !hasDirectParagraph(n) {
				builder.paragraphs++
			}
			builder.inLatin = false
		case *ast.TextBlock:
			builder.inLatin = false
		case *east.TableHeader, *east.TableRow:
			builder.paragraphs++
			builder.inLatin = false
		case *east.TableCell:
			builder.inLatin = false
		case *ast.Text:
			builder.add(string(n.Segment.Value(body)))
		case *ast.String:
			builder.add(string(n.Value))
		case *ast.CodeSpan:
			var code strings.Builder
			for child := n.FirstChild(); child != nil; child = child.NextSibling() {
				if t, ok := child.(*ast.Text); ok {
					code.Write(t.Segment.Value(body))
				}
			}
			builder.add(code.String())
			return ast.WalkSkipChildren, nil
		case *ast.FencedCodeBlock:
			builder.paragraphs++
			builder.inLatin = false
			builder.add(linesText(n.Lines(), body))
			return ast.WalkSkipChildren, nil
		case *ast.CodeBlock:
			builder.paragraphs++
			builder.inLatin = false
			builder.add(linesText(n.Lines(), body))
			return ast.WalkSkipChildren, nil
		case *ast.HTMLBlock:
			var raw strings.Builder
			for i := 0; i < n.Lines().Len(); i++ {
				segment := n.Lines().At(i)
				raw.WriteString(htmlComment.ReplaceAllString(string(segment.Value(body)), ""))
			}
			if strings.TrimSpace(raw.String()) != "" {
				builder.paragraphs++
				builder.inLatin = false
				builder.add(raw.String())
			}
			return ast.WalkSkipChildren, nil
		case *ast.RawHTML:
			for i := 0; i < n.Segments.Len(); i++ {
				segment := n.Segments.At(i)
				builder.add(htmlComment.ReplaceAllString(string(segment.Value(body)), ""))
			}
			return ast.WalkSkipChildren, nil
		case *MathInline:
			builder.add(string(n.Tex.Value(body)))
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return builder.result()
}

func hasDirectParagraph(node ast.Node) bool {
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if _, ok := child.(*ast.Paragraph); ok {
			return true
		}
	}
	return false
}

func linesText(lines *text.Segments, source []byte) string {
	var out strings.Builder
	for i := 0; i < lines.Len(); i++ {
		segment := lines.At(i)
		out.Write(segment.Value(source))
	}
	return out.String()
}

type wordCounter struct {
	chars      int
	noSpaces   int
	words      int
	paragraphs int
	inLatin    bool
}

func (c *wordCounter) add(text string) {
	for _, r := range text {
		c.chars++
		if !unicode.IsSpace(r) {
			c.noSpaces++
		}
		switch {
		case isCJK(r):
			c.words++
			c.inLatin = false
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			if !c.inLatin {
				c.words++
				c.inLatin = true
			}
		default:
			c.inLatin = false
		}
	}
}

func (c *wordCounter) result() WordCount {
	return WordCount{
		Characters:         c.chars,
		CharactersNoSpaces: c.noSpaces,
		Words:              c.words,
		Paragraphs:         c.paragraphs,
	}
}

func isCJK(r rune) bool {
	return r >= 0x4E00 && r <= 0x9FFF ||
		r >= 0x3400 && r <= 0x4DBF ||
		r >= 0x3000 && r <= 0x303F ||
		r >= 0x3040 && r <= 0x30FF ||
		r >= 0xAC00 && r <= 0xD7AF ||
		r >= 0xF900 && r <= 0xFAFF
}
