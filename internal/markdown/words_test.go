package markdown

import "testing"

func TestCountWordsKeepsBlocksSeparateAndSelectionIsNotFrontMatter(t *testing.T) {
	list := CountWords([]byte("- a\n- b\n- c"))
	if list.Words != 3 || list.Paragraphs != 3 {
		t.Fatalf("list = %+v", list)
	}
	table := CountWords([]byte("| a | b |\n| --- | --- |\n| 1 | 2 |"))
	if table.Words != 4 || table.Paragraphs != 2 {
		t.Fatalf("table = %+v", table)
	}
	selection := CountWordsSelection([]byte("---\n正文 hello\n---\n更多 more\n"))
	if selection.Words == 0 || selection.Characters == 0 {
		t.Fatalf("selection front matter stripped: %+v", selection)
	}
}

func TestCountWordsUsesTheFrozenRules(t *testing.T) {
	source := `---
title: 不应统计
---

# 标题

你好 world_test 123

` + "```python\n" + `def __init__(self):
` + "```" + `

<!-- 注释也不应统计 -->
`
	count := CountWords([]byte(source))
	// 标题(2) + 你好(2) + world_test(1) + 123(1) + def(1) + __init__(1) + self(1)
	without := "# 标题\n\n你好 world_test 123\n\n" + "```python\n" + "def __init__(self):\n" + "```\n"
	base := CountWords([]byte(without))
	if count.Words != 9 {
		t.Fatalf("Words = %d, want 9", count.Words)
	}
	if count.Paragraphs != 3 {
		t.Fatalf("Paragraphs = %d, want 3", count.Paragraphs)
	}
	if count.Characters == 0 || count.CharactersNoSpaces >= count.Characters {
		t.Fatalf("character counts = %d/%d", count.Characters, count.CharactersNoSpaces)
	}
	if count.Characters != base.Characters || count.Words != base.Words {
		t.Fatalf("front matter or comments changed counts: %+v vs %+v", count, base)
	}
}
