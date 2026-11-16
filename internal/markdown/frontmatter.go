package markdown

import (
	"fmt"
	"strings"
)

// splitFrontMatter separates the YAML block a document may open with. It is
// shown folded and read-only, never parsed or executed (PRD FR-04): the app
// has no use for its values in P0 beyond telling the reader they are there.
func splitFrontMatter(src []byte) (meta string, body []byte) {
	text := string(src)
	if !strings.HasPrefix(text, "---") {
		return "", src
	}
	// The opening line must be exactly the delimiter.
	line, rest, ok := strings.Cut(text, "\n")
	if !ok || strings.TrimSpace(line) != "---" {
		return "", src
	}
	var yaml []string
	for {
		line, tail, found := strings.Cut(rest, "\n")
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" || trimmed == "..." {
			return strings.Join(yaml, "\n"), []byte(tail)
		}
		if !found {
			// No closing delimiter: the document starts with a rule, not
			// with front matter.
			return "", src
		}
		yaml = append(yaml, line)
		rest = tail
	}
}

// metaHTML renders the front matter block that precedes the document.
func metaHTML(yaml string) string {
	items := 0
	for _, line := range strings.Split(yaml, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "-") {
			continue
		}
		if strings.Contains(trimmed, ":") {
			items++
		}
	}
	return fmt.Sprintf(
		`<details class="fm"><summary>元信息 · %d 项</summary><pre>%s</pre></details>`+"\n",
		items, escapeText(yaml),
	)
}

// escapeText is the HTML escaping the renderer applies to raw text.
func escapeText(text string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&#34;",
	)
	return replacer.Replace(text)
}
