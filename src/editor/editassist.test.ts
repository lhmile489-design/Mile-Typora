import { describe, expect, it } from "vitest";
import { deleteLine, deleteParagraph, deleteWord, ensureFinalNewline, trimTrailingWhitespace } from "./editassist";

const snap = (text: string, anchor = text.length, head = anchor) => ({ text, anchor, head });

describe("M5-8 editing aids", () => {
  it("deletes a CJK character or a Latin word before the caret", () => {
    expect(deleteWord(snap("你好世界"))?.text).toBe("你好世");
    expect(deleteWord(snap("hello world"))?.text).toBe("hello ");
    expect(deleteWord(snap("hello world", 8, 11))?.text).toBe("hello wo");
    expect(deleteWord(snap("abc", 1, 2))?.text).toBe("ac");
  });

  it("deletes the current line without overflowing the last line", () => {
    expect(deleteLine(snap("a\nb\nc", 2))?.text).toBe("a\nc");
    expect(deleteLine(snap("a\nb", 3))?.text).toBe("a");
    expect(deleteLine(snap("only", 1))?.text).toBe("");
  });

  it("deletes the paragraph and one separating blank line", () => {
    const text = "第一段\n\n第二段\n\n第三段";
    expect(deleteParagraph(snap(text, text.indexOf("第二")))?.text).toBe("第一段\n\n第三段");
  });

  it("trims trailing spaces but keeps hard breaks and protected code", () => {
    const text = "普通   \n硬换行  \n```\n代码  \n```\n反斜杠\\ \n";
    const edit = trimTrailingWhitespace(snap(text));
    expect(edit?.text).toBe("普通  \n硬换行  \n```\n代码  \n```\n反斜杠\\\n");
  });

  it("ensures exactly one final newline and reports no change", () => {
    expect(ensureFinalNewline(snap("a\n\n\n"))?.text).toBe("a\n");
    expect(ensureFinalNewline(snap("a"))?.text).toBe("a\n");
    expect(ensureFinalNewline(snap("a\n"))).toBeNull();
    expect(ensureFinalNewline(snap(""))).toBeNull();
  });
});
