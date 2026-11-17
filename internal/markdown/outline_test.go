package markdown

import "testing"

func TestOutlineSkipsFrontMatterAndCodeFences(t *testing.T) {
	src := []byte("---\ntitle: 示例\n---\n# 一级\n\n```md\n# 不是标题\n```\n\n## 二级\n### *强调* 标题\n")
	headings, truncated := Outline(src)
	if truncated {
		t.Fatal("a small outline was truncated")
	}
	if len(headings) != 3 {
		t.Fatalf("headings = %+v", headings)
	}
	want := []OutlineHeading{
		{Level: 1, Text: "一级", Line: 4},
		{Level: 2, Text: "二级", Line: 10},
		{Level: 3, Text: "强调 标题", Line: 11},
	}
	for i, heading := range headings {
		if heading != want[i] {
			t.Fatalf("heading %d = %+v, want %+v", i, heading, want[i])
		}
	}
}

func TestOutlineDoesNotTreatFormulaLinesAsHeadings(t *testing.T) {
	src := []byte("$$\n# 不是标题\n$$\n\n# 真标题\n")
	headings, truncated := Outline(src)
	if truncated {
		t.Fatal("a small outline was truncated")
	}
	if len(headings) != 1 || headings[0].Text != "真标题" || headings[0].Line != 5 {
		t.Fatalf("headings = %+v", headings)
	}
}

func TestOutlineStopsAtTheHeadingLimit(t *testing.T) {
	src := make([]byte, 0, MaxOutlineHeadings*8)
	for i := 0; i < MaxOutlineHeadings+5; i++ {
		src = append(src, []byte("# h\n")...)
	}
	headings, truncated := Outline(src)
	if !truncated || len(headings) != MaxOutlineHeadings {
		t.Fatalf("headings=%d truncated=%v", len(headings), truncated)
	}
}
