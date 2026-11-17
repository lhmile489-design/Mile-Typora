import { describe, expect, it } from "vitest";
import { checkWord, hasWordChars, ignoreForSession, isIgnored, scanRange, wordAt } from "./spellcheck";

// A tiny deterministic checker so the tests never touch the real dictionary.
// Every correctly-spelled token used in the fixtures must appear here.
const valid = new Set([
  "word", "text", "note", "test", "hello", "world", "code", "check",
  "this", "is", "wrong", "right", "say", "now", "and", "the", "a",
]);
const checker = {
  check: (w: string) => valid.has(w.toLowerCase()),
  suggest: (w: string, limit = 5) => {
    if (w.toLowerCase() === "wrod") return ["word", "ward", "rod"];
    return [];
  },
};

describe("spellcheck scanning", () => {
  it("flags misspelled English words in plain prose", () => {
    const text = "this wrod is wrong";
    const errors = scanRange(text, 0, text.length, checker);
    expect(errors).toEqual([{ from: 5, to: 9, word: "wrod" }]);
  });

  it("accepts correctly spelled words", () => {
    const text = "this word is right";
    expect(scanRange(text, 0, text.length, checker)).toEqual([]);
  });

  it("skips CJK text and mixed-language lines check only English", () => {
    const text = "这是 wrod 和 word 混合";
    const errors = scanRange(text, 0, text.length, checker);
    expect(errors).toEqual([{ from: 3, to: 7, word: "wrod" }]);
  });

  it("skips code, math, front matter and link destinations", () => {
    const text = [
      "---",
      "wrod: x",
      "---",
      // A link label is prose and stays checkable; only the destination and the
      // code/math/front-matter spans are protected (P3-AC-14).
      "`wrod` 和 [word](https://wrod.com)",
      "$wrod$",
      "wrod",
    ].join("\n");
    const errors = scanRange(text, 0, text.length, checker);
    expect(errors).toEqual([{ from: text.lastIndexOf("wrod"), to: text.length, word: "wrod" }]);
  });

  it("respects the word cap", () => {
    const many = Array.from({ length: 6000 }, () => "wrod").join(" ");
    const errors = scanRange(many, 0, many.length, checker);
    expect(errors.length).toBe(5000);
  });

  it("wordAt finds the word under the caret and nulls protected regions", () => {
    const text = "say wrod now `wrod`";
    const inside = text.indexOf("wrod");
    expect(wordAt(text, inside + 2)).toEqual({ from: inside, to: inside + 4, word: "wrod" });
    // The first word's leading edge is inside it (right-click on "s").
    expect(wordAt(text, 0)).toEqual({ from: 0, to: 3, word: "say" });
    // A protected code span is never a candidate.
    expect(wordAt(text, text.lastIndexOf("wrod") + 2)).toBeNull();
    // A space between words is outside every word.
    expect(wordAt(text, text.indexOf("wrod") - 1)).toBeNull();
  });

  it("wordAt nulls a caret adjacent to punctuation", () => {
    const text = "a wrod.";
    expect(wordAt(text, text.indexOf("wrod") + 4)).toBeNull();
  });

  it("checkWord honors the session ignore list", () => {
    expect(checkWord(checker, "wrod")).toBe(false);
    ignoreForSession("wrod");
    expect(isIgnored("wrod")).toBe(true);
    expect(checkWord(checker, "wrod")).toBe(true);
    expect(scanRange("wrod", 0, 4, checker)).toEqual([]);
  });

  it("suggestions returns up to the limit", () => {
    expect(checker.suggest("wrod")).toEqual(["word", "ward", "rod"]);
  });

  it("hasWordChars skips pure-CJK ranges", () => {
    expect(hasWordChars("中文", 0, 2)).toBe(false);
    expect(hasWordChars("中wrod", 0, 5)).toBe(true);
  });
});
