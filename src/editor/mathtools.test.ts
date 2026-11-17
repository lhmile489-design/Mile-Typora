import { describe, expect, it } from "vitest";
import {
  convertMathDelimiter,
  insertInlineMath,
  insertMathSnippet,
  mathAt,
  mathInfo,
  mathProtected,
  mathRanges,
} from "./mathtools";

const snap = (text: string, anchor = 0, head = anchor) => ({ text, anchor, head });

describe("M6-2 math tools", () => {
  it("finds inline and block formulas but not code or front matter", () => {
    const text = "---\ntitle: $x$\n---\n\n行内 $a+b$ 与 \\(c\\)\n\n```\n$no$\n```\n\n$$\nd=e\n$$";
    const ranges = mathRanges(text);
    expect(ranges.map((range) => range.tex)).toEqual(["a+b", "c", "d=e"]);
    expect(ranges.map((range) => range.kind)).toEqual(["inline", "inline", "block"]);
    expect(mathAt(snap(text, text.indexOf("a+b") + 1))?.tex).toBe("a+b");
    expect(mathProtected(text, text.indexOf("$no$") + 1)).toBe(true);
    expect(mathInfo(snap(text, text.indexOf("d=e")))?.display).toBe(true);
  });

  it("wraps, unwraps and inserts an inline formula", () => {
    const wrapped = insertInlineMath(snap("前后", 1, 1));
    expect(wrapped?.text).toBe("前$公式$后");
    expect(wrapped?.anchor).toBe(2);
    expect(wrapped?.head).toBe(4);
    expect(insertInlineMath(snap("前$x$后", 3))?.text).toBe("前x后");
    expect(insertInlineMath(snap("x", 0, 1))?.text).toBe("$x$");
    expect(insertInlineMath(snap("`$x$`", 3))).toBeNull();
  });

  it("inserts templates with a selected placeholder", () => {
    const edit = insertMathSnippet(snap("", 0), "fraction");
    expect(edit?.text).toBe("\\frac{分子}{分母}");
    expect(edit?.head! - edit?.anchor!).toBe(2);
    expect(insertMathSnippet(snap("```\n", 4), "sqrt")).toBeNull();
  });

  it("converts formula delimiters and rejects a block inside prose", () => {
    expect(convertMathDelimiter(snap("$x+1$", 2), "paren")?.text).toBe("\\(x+1\\)");
    expect(convertMathDelimiter(snap("前 $x$ 后", 4), "block-dollar")).toBeNull();
    expect(convertMathDelimiter(snap("$$\nx+1\n$$", 5), "dollar")?.text).toBe("$x+1$");
    expect(convertMathDelimiter(snap("$$\nx\n$$", 4), "block-bracket")?.text).toContain("\\[");
  });
});
