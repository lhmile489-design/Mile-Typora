package markdown

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
)

// headingIDs makes anchors that keep Chinese: goldmark's own generator drops
// every non-ASCII character, which turns "安装步骤" into "heading" (PRD FR-04).
// It implements parser.IDs.
type headingIDs struct {
	used map[string]int
}

func newHeadingIDs() *headingIDs { return &headingIDs{used: make(map[string]int)} }

// Generate returns the id for a heading's text, unique within the document.
func (s *headingIDs) Generate(value []byte, kind ast.NodeKind) []byte {
	slug := slugify(string(value))
	if slug == "" {
		slug = "heading"
	}
	if n, seen := s.used[slug]; seen {
		s.used[slug] = n + 1
		slug = slug + "-" + strconv.Itoa(n)
	} else {
		s.used[slug] = 1
	}
	return []byte(slug)
}

// Put records an id a document set itself, so generated ones do not collide.
func (s *headingIDs) Put(value []byte) {
	s.used[string(value)]++
}

// slugify keeps letters and digits of any script, lowercases Latin letters,
// and turns runs of spaces, hyphens and underscores into one hyphen.
func slugify(text string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.TrimSpace(text) {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			dash = false
			b.WriteRune(unicode.ToLower(r))
		case r == ' ' || r == '-' || r == '_' || r == '\t' || r == '\n':
			dash = true
		default:
			// Punctuation and symbols carry no meaning in an anchor.
		}
	}
	return b.String()
}
