import { describe, expect, it } from "vitest";
import {
  indentList,
  insertFence,
  insertHorizontalRule,
  insertParagraph,
  setHeading,
  setTaskStatus,
  shiftHeading,
  toggleList,
  toggleQuote,
  type ParagraphEdit,
  type Snapshot,
} from "./paragraph";

/** pos converts a zero-based line and column to a document offset. */
function pos(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", offset);
    offset = next === -1 ? text.length : next + 1;
  }
  return Math.min(offset + column, text.length);
}

function snap(text: string, line = 0, column = 0, endLine = line, endColumn = column): Snapshot {
  return { text, anchor: pos(text, line, column), head: pos(text, endLine, endColumn) };
}

function textOf(edit: ParagraphEdit): string {
  expect(edit).not.toBeNull();
  return edit!.text;
}

describe("headings", () => {
  it("converts the cursor line and keeps the body", () => {
    const source = "标题\n正文";
    const edit = setHeading(snap(source), 2);
    expect(textOf(edit)).toBe("## 标题\n正文");
    expect(edit!.anchor).toBe(3);
  });

  it("converts every selected line independently", () => {
    const source = "一\n二\n三";
    const edit = setHeading(snap(source, 0, 0, 2, 1), 1);
    expect(textOf(edit)).toBe("# 一\n# 二\n# 三");
  });

  it("does not accumulate hashes or touch an already matching line", () => {
    expect(setHeading(snap("## 标题"), 2)).toBeNull();
    expect(textOf(setHeading(snap("### 标题"), 2))).toBe("## 标题");
  });

  it("turns a blank line into a heading marker so typing can continue", () => {
    const edit = setHeading(snap(""), 3);
    expect(textOf(edit)).toBe("### ");
  });

  it("skips blank separator lines in a multi-line selection", () => {
    const source = "一\n\n二";
    const edit = setHeading(snap(source, 0, 0, 2, 1), 1);
    expect(textOf(edit)).toBe("# 一\n\n# 二");
  });
  it("parses bare block markers at end of line", () => {
    expect(textOf(setHeading(snap("##"), 1))).toBe("# ");
    expect(textOf(toggleList(snap("1."), "ordered"))).toBe("");
    expect(textOf(toggleList(snap("-"), "unordered"))).toBe("");
    expect(textOf(toggleList(snap("- [ ]"), "task"))).toBe("- ");
  });

  it("does not treat an info string containing backticks as a fence", () => {
    const source = "``` x ```\ny";
    expect(textOf(setHeading(snap(source, 1, 0), 1))).toBe("``` x ```\n# y");
  });


  it("keeps trailing hashes that are body text, and preserves a heading's closing marker", () => {
    expect(textOf(toggleQuote(snap("C #")))).toBe("> C #");
    expect(textOf(toggleQuote(snap("## 标题 ##")))).toBe("> ## 标题 ##");
    expect(textOf(toggleList(snap("C #"), "unordered"))).toBe("- C #");
    expect(textOf(setHeading(snap("## 标题 ##"), 1))).toBe("# 标题");
  });

  it("paragraph strips heading, quote, list and task markers", () => {
    const source = "# 标题\n> 引用\n- 项目\n- [x] 完成";
    const edit = setHeading(snap(source, 0, 0, 3, 5), 0);
    expect(textOf(edit)).toBe("标题\n引用\n项目\n完成");
  });

  it("paragraph leaves inline formatting and plain lines alone", () => {
    expect(setHeading(snap("**粗体**"), 0)).toBeNull();
    const edit = setHeading(snap("## **粗体**"), 0);
    expect(textOf(edit)).toBe("**粗体**");
  });

  it("promotes and demotes without crossing the bounds", () => {
    expect(shiftHeading(snap("# 一"), "promote")).toBeNull();
    expect(textOf(shiftHeading(snap("### 三"), "promote"))).toBe("## 三");
    expect(shiftHeading(snap("###### 六"), "demote")).toBeNull();
    expect(textOf(shiftHeading(snap("### 三"), "demote"))).toBe("#### 三");
  });

  it("promotes and demotes only headings", () => {
    expect(shiftHeading(snap("正文"), "promote")).toBeNull();
    expect(shiftHeading(snap("正文"), "demote")).toBeNull();
  });
  it("converts a setext heading to ATX and removes its underline", () => {
    expect(textOf(setHeading(snap("标题\n==="), 2))).toBe("## 标题");
    expect(textOf(setHeading(snap("标题\n---"), 3))).toBe("### 标题");
  });

  it("maps a selection that spans a setext title and underline", () => {
    const edit = setHeading(snap("标题\n===\nx", 0, 0, 1, 3), 1);
    expect(textOf(edit)).toBe("# 标题\nx");
    expect(edit!.anchor).toBe(2);
    expect(edit!.head).toBe(4);
  });

  it("converts a setext heading to a paragraph by removing the underline", () => {
    expect(textOf(setHeading(snap("标题\n==="), 0))).toBe("标题");
  });

  it("promotes and demotes setext headings through ATX", () => {
    expect(textOf(shiftHeading(snap("标题\n---"), "promote"))).toBe("# 标题");
    expect(textOf(shiftHeading(snap("标题\n==="), "demote"))).toBe("## 标题");
    expect(shiftHeading(snap("标题\n==="), "promote")).toBeNull();
  });


  it("keeps quote and list containers when changing heading level", () => {
    expect(textOf(setHeading(snap("> 引用"), 2))).toBe("> ## 引用");
    expect(textOf(setHeading(snap("- 项目"), 1))).toBe("# 项目");
    expect(textOf(setHeading(snap("  - 项目"), 1))).toBe("  # 项目");
  });
});

describe("quotes and lists", () => {
  it("toggles quote on and off", () => {
    const quoted = toggleQuote(snap("正文"));
    expect(textOf(quoted)).toBe("> 正文");
    expect(textOf(toggleQuote(quoted!))).toBe("正文");
  });

  it("quotes unquoted lines without nesting the already quoted ones", () => {
    const source = "> 一\n二";
    const edit = toggleQuote(snap(source, 0, 0, 1, 1));
    expect(textOf(edit)).toBe("> 一\n> 二");
  });

  it("removes every quote level and keeps a blank line marker", () => {
    expect(textOf(toggleQuote(snap("> > 深度")))).toBe("深度");
    expect(textOf(toggleQuote(snap("一\n二", 0, 0, 1, 1)))).toBe("> 一\n> 二");
  });

  it("converts selected paragraphs to an ordered list and off again", () => {
    const source = "一\n二";
    const edit = toggleList(snap(source, 0, 0, 1, 1), "ordered");
    expect(textOf(edit)).toBe("1. 一\n2. 二");
    expect(textOf(toggleList(edit!, "ordered"))).toBe("一\n二");
  });

  it("renumbers a mixed selection instead of keeping duplicate numbers", () => {
    expect(textOf(toggleList(snap("- a\n1. b", 0, 0, 1, 4), "ordered"))).toBe("1. a\n2. b");
    expect(textOf(toggleList(snap("5. a\nb", 0, 0, 1, 1), "ordered"))).toBe("5. a\n6. b");
  });

  it("continues an adjacent ordered list instead of restarting", () => {
    const source = "4. 四\n正文";
    const edit = toggleList(snap(source, 1, 0), "ordered");
    expect(textOf(edit)).toBe("4. 四\n5. 正文");
  });

  it("preserves a heading that lives inside a list item", () => {
    expect(textOf(toggleList(snap("- # 标题"), "unordered"))).toBe("# 标题");
    expect(textOf(toggleList(snap("1. # 标题"), "unordered"))).toBe("- # 标题");
    expect(textOf(toggleList(snap("# 标题"), "unordered"))).toBe("- 标题");
  });

  it("converts ordered to unordered and keeps the body", () => {
    expect(textOf(toggleList(snap("1. 项目"), "unordered"))).toBe("- 项目");
    expect(textOf(toggleList(snap("# 标题"), "unordered"))).toBe("- 标题");
  });

  it("converts to a task list and toggles it back to a bullet", () => {
    const edit = toggleList(snap("项目"), "task");
    expect(textOf(edit)).toBe("- [ ] 项目");
    expect(textOf(toggleList(edit!, "task"))).toBe("- 项目");
  });

  it("skips blank separator lines and fences when converting", () => {
    const source = "一\n\n二\n```\n三\n```";
    const edit = toggleList(snap(source, 0, 0, 5, 3), "unordered");
    expect(textOf(edit)).toBe("- 一\n\n- 二\n```\n三\n```");
  });

  it("sets task status only on task items", () => {
    const source = "- [ ] 一\n- [x] 二\n- 三";
    const edit = setTaskStatus(snap(source, 0, 0, 2, 3), true);
    expect(textOf(edit)).toBe("- [x] 一\n- [x] 二\n- 三");
    expect(setTaskStatus(snap("- 三"), true)).toBeNull();
  });
  it("indents a list inside a quote without moving the quote marker", () => {
    expect(textOf(indentList(snap("> - 项目"), "in"))).toBe(">   - 项目");
    expect(textOf(indentList(snap(">   - 项目"), "out"))).toBe("> - 项目");
  });


  it("indents and outdents list items with the document's 4-space style", () => {
    const source = "- 一\n    - 二";
    const edit = indentList(snap(source, 1, 0), "in");
    expect(textOf(edit)).toBe("- 一\n        - 二");
    const out = indentList(snap(source, 1, 6), "out");
    expect(textOf(out)).toBe("- 一\n- 二");
  });

  it("leaves non-list lines in place while indenting", () => {
    const source = "- 一\n正文";
    const edit = indentList(snap(source, 0, 0, 1, 2), "in");
    expect(textOf(edit)).toBe("  - 一\n正文");
  });
});

describe("formula, code, rules and inserted paragraphs", () => {
  it("wraps the selected block in a formula and puts the cursor in the body", () => {
    const source = "x = 1\ny = 2";
    const edit = insertFence(snap(source, 0, 0, 1, 5), "formula");
    expect(textOf(edit)).toBe("$$\nx = 1\ny = 2\n$$");
    expect(edit!.anchor).toBe("$$\nx = 1\ny = 2".length);
  });

  it("inserts an empty formula on an empty line", () => {
    const edit = insertFence(snap(""), "formula");
    expect(textOf(edit)).toBe("$$\n\n$$");
    expect(edit!.anchor).toBe(3);
  });
  it("uses a longer backtick fence when the body contains triple backticks", () => {
    const source = "use ``` inside";
    const edit = insertFence(snap(source, 0, 0, 0, source.length), "code", "md");
    expect(textOf(edit)).toBe("````md\nuse ``` inside\n````");
  });


  it("does not wrap a block that is already fenced", () => {
    expect(insertFence(snap("```\nx\n```", 1, 0), "formula")).toBeNull();
  });

  it("inserts a rule between blocks without creating a setext heading", () => {
    const source = "上\n\n下";
    const edit = insertHorizontalRule(snap(source, 1, 0));
    expect(textOf(edit)).toBe("上\n\n---\n\n下");
  });
  it("treats a setext heading as one block when inserting around it", () => {
    const source = "T\n===";
    expect(textOf(insertParagraph(snap(source, 0, 0), "below"))).toBe("T\n===\n\n");
    expect(textOf(insertParagraph(snap(source, 1, 3), "above"))).toBe("\n\nT\n===");
    expect(textOf(insertHorizontalRule(snap(source, 0, 0)))).toBe("T\n===\n\n---\n");
    expect(textOf(insertHorizontalRule(snap(source, 1, 3)))).toBe("T\n===\n\n---\n");
  });


  it("inserts an editable blank paragraph above and below", () => {
    expect(textOf(insertParagraph(snap("正文"), "above"))).toBe("\n\n正文");
    expect(textOf(insertParagraph(snap("正文"), "below"))).toBe("正文\n\n");
    expect(insertParagraph(snap(""), "below")).toBeNull();
  });
});

describe("literal blocks", () => {
  it("never rewrites lines inside a fenced code block", () => {
    const source = "```\n# comment\n- item\n```";
    expect(setHeading(snap(source, 1, 0), 2)).toBeNull();
    expect(toggleList(snap(source, 2, 0), "ordered")).toBeNull();
    expect(toggleQuote(snap(source, 1, 0))).toBeNull();
  });
  it("does not treat an indented fence as an open code block", () => {
    const source = "    ```\n\n标题";
    expect(textOf(setHeading(snap(source, 2, 0), 1))).toBe("    ```\n\n# 标题");
  });

  it("converts the setext title when the cursor is on its underline", () => {
    expect(textOf(setHeading(snap("标题\n===", 1, 3), 1))).toBe("# 标题");
    expect(textOf(shiftHeading(snap("标题\n---", 1, 3), "promote"))).toBe("# 标题");
  });
  it("keeps setext headings out of quote and list toggles", () => {
    const source = "标题\n===";
    expect(toggleQuote(snap(source, 0, 0, 1, 3))).toBeNull();
    expect(toggleList(snap(source, 0, 0, 1, 3), "unordered")).toBeNull();
  });

  it("wraps a whole setext heading in a fence", () => {
    const source = "标题\n---";
    const edit = insertFence(snap(source, 0, 2), "code");
    expect(textOf(edit)).toBe("```\n标题\n---\n```");
  });

  it("does not insert above YAML front matter", () => {
    const source = "---\ntitle: x\n---\nbody";
    expect(insertParagraph(snap(source, 1, 0), "above")).toBeNull();
  });


  it("protects front matter and thematic breaks", () => {
    const fm = "---\ntitle: x\n---\nbody";
    expect(setHeading(snap(fm, 1, 0), 1)).toBeNull();
    expect(textOf(setHeading(snap(fm, 3, 0), 1))).toBe("---\ntitle: x\n---\n# body");
    const rule = "a\n\n---\n\nb";
    expect(setHeading(snap(rule, 2, 0), 1)).toBeNull();
    expect(toggleQuote(snap(rule, 2, 0))).toBeNull();
    expect(textOf(toggleList(snap(rule, 0, 0, 4, 1), "unordered"))).toBe("- a\n\n---\n\n- b");
  });

  it("does not treat an indented $$ line as a math fence", () => {
    const source = "    $$\n\n标题";
    expect(textOf(setHeading(snap(source, 2, 0), 1))).toBe("    $$\n\n# 标题");
  });

  it("inserts a paragraph outside an enclosing fence", () => {
    const fence = "```\ncode\n```";
    expect(textOf(insertParagraph(snap(fence, 1, 0), "below"))).toBe(fence + "\n\n");
    expect(textOf(insertParagraph(snap(fence, 1, 0), "above"))).toBe("\n\n" + fence);
  });

  it("treats indented list and quote lookalikes as code, but allows a real nested item", () => {
    expect(setHeading(snap("    - 项目", 0, 6), 2)).toBeNull();
    expect(toggleQuote(snap("    > 引用", 0, 6))).toBeNull();
    expect(setTaskStatus(snap("    - [ ] 任务", 0, 8), true)).toBeNull();
    expect(indentList(snap("    - 项目", 0, 6), "in")).toBeNull();
    const nested = "- 父级\n    - 子项";
    expect(textOf(setHeading(snap(nested, 1, 6), 2))).toBe("- 父级\n    ## 子项");
  });


  it("never rewrites an indented code block", () => {
    expect(setHeading(snap("    # code", 0, 6), 2)).toBeNull();
  });

  it("never rewrites lines inside a $$ formula block", () => {
    const source = "$$\nx + y\n$$";
    expect(setHeading(snap(source, 1, 0), 2)).toBeNull();
  });

  it("leaves the rest of a mixed selection alone when part is fenced", () => {
    const source = "```\ncode\n```\n正文";
    const edit = setHeading(snap(source, 0, 0, 3, 2), 1);
    expect(textOf(edit)).toBe("```\ncode\n```\n# 正文");
  });
});
