import { describe, expect, it } from "vitest";
import {
  clearFormatting,
  insertLink,
  toggleCode,
  toggleEmphasis,
  type InlineEdit,
} from "./inline";
import type { Snapshot } from "./paragraph";

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

function textOf(edit: InlineEdit): string {
  expect(edit).not.toBeNull();
  return edit!.text;
}

  it("removes an empty pair when toggling it again", () => {
    expect(textOf(toggleEmphasis(snap("****", 0, 2), "bold"))).toBe("");
    expect(textOf(toggleEmphasis(snap("**", 0, 1), "italic"))).toBe("");
    expect(textOf(toggleCode(snap("``", 0, 1)))).toBe("");
  });

describe("bold, italic and strikethrough", () => {
  it("inserts an empty bold pair and puts the cursor inside", () => {
    const edit = toggleEmphasis(snap(""), "bold");
    expect(textOf(edit)).toBe("****");
    expect(edit!.anchor).toBe(2);
    expect(edit!.head).toBe(2);
  });

  it("wraps and unwraps a bold selection", () => {
    const wrapped = toggleEmphasis(snap("text", 0, 0, 0, 4), "bold");
    expect(textOf(wrapped)).toBe("**text**");
    expect(wrapped!.anchor).toBe(2);
    expect(wrapped!.head).toBe(6);

    const inner = toggleEmphasis(wrapped!, "bold");
    expect(textOf(inner)).toBe("text");
    expect(inner!.anchor).toBe(0);
    expect(inner!.head).toBe(4);
  });

  it("removes bold markers that surround the selection", () => {
    const edit = toggleEmphasis(snap("**text**", 0, 2, 0, 6), "bold");
    expect(textOf(edit)).toBe("text");
  });
  it("removes a whole bold or struck span when only part of it is selected", () => {
    expect(textOf(toggleEmphasis(snap("**ab**", 0, 3, 0, 4), "bold"))).toBe("ab");
    expect(textOf(toggleEmphasis(snap("~~ab~~", 0, 3, 0, 4), "strikethrough"))).toBe("ab");
  });

  it("does not remove markers from two separate spans around a gap", () => {
    const source = "**a** and **b**";
    expect(clearFormatting(snap(source, 0, 5, 0, 10))).toBeNull();
  });

  it("removes underline tags with clear formatting", () => {
    const edit = clearFormatting(snap("<u>文字</u>", 0, 3, 0, 5));
    expect(textOf(edit)).toBe("文字");
  });


  it("removes two stars from a combined bold-italic span", () => {
    expect(textOf(toggleEmphasis(snap("***text***", 0, 0, 0, 10), "bold"))).toBe("*text*");
    expect(textOf(toggleEmphasis(snap("***text***", 0, 3, 0, 7), "bold"))).toBe("*text*");
  });

  it("toggles italic without stealing bold markers", () => {
    expect(textOf(toggleEmphasis(snap("text", 0, 0, 0, 4), "italic"))).toBe("*text*");
    expect(textOf(toggleEmphasis(snap("*text*", 0, 1, 0, 5), "italic"))).toBe("text");
    expect(textOf(toggleEmphasis(snap("**text**", 0, 0, 0, 8), "italic"))).toBe("***text***");
    expect(textOf(toggleEmphasis(snap("***text***", 0, 0, 0, 10), "italic"))).toBe("**text**");
  });

  it("toggles strikethrough", () => {
    expect(textOf(toggleEmphasis(snap("text", 0, 0, 0, 4), "strikethrough"))).toBe("~~text~~");
    expect(textOf(toggleEmphasis(snap("~~text~~", 0, 0, 0, 8), "strikethrough"))).toBe("text");
  });
});

describe("inline code", () => {
  it("inserts a pair with the cursor inside", () => {
    const edit = toggleCode(snap(""));
    expect(textOf(edit)).toBe("``");
    expect(edit!.anchor).toBe(1);
  });
  it("does not unwrap text that merely ends in backticks", () => {
    const source = "`x`y`z`";
    expect(textOf(toggleCode(snap(source, 0, 0, 0, source.length)))).toBe("`` `x`y`z` ``");
    expect(textOf(toggleCode(snap(source, 0, 3, 0, 4)))).toBe("`x``y``z`");
  });

  it("pads a code span whose content starts or ends with a backtick", () => {
    const wrapped = toggleCode(snap("a`", 0, 0, 0, 2));
    expect(textOf(wrapped)).toBe("`` a` ``");
    const source = "`` a` ``";
    expect(textOf(toggleCode(snap(source, 0, 0, 0, source.length)))).toBe("a`");
  });


  it("uses a longer fence when the selection contains backticks", () => {
    const edit = toggleCode(snap("a`b", 0, 0, 0, 3));
    expect(textOf(edit)).toBe("``a`b``");
    expect(edit!.anchor).toBe(2);
    expect(edit!.head).toBe(5);
  });

  it("unwraps a selected code span", () => {
    expect(textOf(toggleCode(snap("`code`", 0, 0, 0, 6)))).toBe("code");
    expect(textOf(toggleCode(snap("``a`b``", 0, 0, 0, 7)))).toBe("a`b");
  });
  it("unwraps a code span when only part of it is selected", () => {
    expect(textOf(toggleCode(snap("`code`", 0, 2, 0, 4)))).toBe("code");
    expect(textOf(clearFormatting(snap("`code`", 0, 2, 0, 4)))).toBe("code");
  });


  it("removes fences that surround the selection", () => {
    expect(textOf(toggleCode(snap("`code`", 0, 1, 0, 5)))).toBe("code");
  });
});

describe("links", () => {
  it("inserts a placeholder and selects the link text", () => {
    const edit = insertLink(snap(""));
    expect(textOf(edit)).toBe("[链接文字](https://)");
    expect(edit!.anchor).toBe(1);
    expect(edit!.head).toBe(5);
  });

  it("wraps a selection and selects the URL", () => {
    const edit = insertLink(snap("文档", 0, 0, 0, 2));
    expect(textOf(edit)).toBe("[文档](https://)");
    expect(edit!.anchor).toBe(5);
    expect(edit!.head).toBe(13);
  });
  it("re-targets an existing link when part of its text or URL is selected", () => {
    const edit = insertLink(snap("[ab](u)", 0, 1, 0, 3));
    expect(textOf(edit)).toBe("[ab](u)");
    expect(edit!.anchor).toBe(5);
    expect(edit!.head).toBe(6);
    const url = insertLink(snap("[ab](u)", 0, 5, 0, 6));
    expect(textOf(url)).toBe("[ab](u)");
    expect(url!.anchor).toBe(5);
  });

  it("does not wrap a selection that only partly overlaps a link", () => {
    expect(insertLink(snap("[ab](u)", 0, 0, 0, 3))).toBeNull();
  });

  it("refuses to wrap link text containing brackets", () => {
    expect(insertLink(snap("a[b]c", 0, 0, 0, 5))).toBeNull();
  });


  it("selects the URL of an existing link without changing the text", () => {
    const edit = insertLink(snap("[文档](https://x)", 0, 0, 0, 17));
    expect(textOf(edit)).toBe("[文档](https://x)");
    expect(edit!.anchor).toBe(5);
    expect(edit!.head).toBe(14);
  });
});

describe("clear formatting", () => {
  it("removes known markers and keeps the text", () => {
    const source = "**粗体** 与 *斜体*、~~删除~~、`代码`、[链接](https://x)";
    const edit = clearFormatting(snap(source, 0, 0, 0, source.length));
    expect(textOf(edit)).toBe("粗体 与 斜体、删除、代码、链接");
  });

  it("expands markers that surround the selection", () => {
    expect(textOf(clearFormatting(snap("**粗体**", 0, 2, 0, 4)))).toBe("粗体");
    expect(textOf(clearFormatting(snap("[链接](https://x)", 0, 1, 0, 3)))).toBe("链接");
  });

  it("removes inline code and the markers it was protecting", () => {
    expect(textOf(clearFormatting(snap("`**literal**`", 0, 0, 0, 13)))).toBe("literal");
  });
  it("expands partial selections when clearing formatting", () => {
    expect(textOf(clearFormatting(snap("**ab**", 0, 3, 0, 4)))).toBe("ab");
    expect(textOf(clearFormatting(snap("*ab*", 0, 2, 0, 3)))).toBe("ab");
  });

  it("keeps images and literal underscores untouched", () => {
    expect(clearFormatting(snap("\\*a\\*", 0, 0, 0, 6))).toBeNull();
    expect(clearFormatting(snap("\\*a\\*", 0, 0, 0, 6))).toBeNull();
    expect(clearFormatting(snap("snake_case_name", 0, 0, 0, 15))).toBeNull();
  });
  it("refuses inline formatting across a paragraph break", () => {
    expect(toggleEmphasis(snap("a\n\nb", 0, 0, 2, 1), "bold")).toBeNull();
    expect(toggleCode(snap("a\n\nb", 0, 0, 2, 1))).toBeNull();
    expect(insertLink(snap("a\n\nb", 0, 0, 2, 1))).toBeNull();
  });

  it("clears underscore emphasis only at word boundaries", () => {
    expect(textOf(clearFormatting(snap("_x_", 0, 0, 0, 3)))).toBe("x");
    expect(textOf(clearFormatting(snap("__x__", 0, 0, 0, 5)))).toBe("x");
    expect(textOf(clearFormatting(snap("_x_", 0, 1, 0, 2)))).toBe("x");
    expect(clearFormatting(snap("a_b_c", 0, 0, 0, 5))).toBeNull();
  });

  it("expands a selection that overlaps the edges of a bold span", () => {
    const source = "a **b**\nc";
    expect(textOf(clearFormatting(snap(source, 0, 3, 0, 6)))).toBe("a b\nc");
  });


  it("keeps escaped markers literal", () => {
    expect(clearFormatting(snap("\\*a\\*", 0, 0, 0, 6))).toBeNull();
  });


  it("does not touch images or plain text", () => {
    expect(clearFormatting(snap("![图](a.png)"))).toBeNull();
    expect(clearFormatting(snap("plain text", 0, 0, 0, 5))).toBeNull();
    expect(clearFormatting(snap("plain"))).toBeNull();
  });
});
