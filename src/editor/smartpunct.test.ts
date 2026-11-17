import { describe, expect, it } from "vitest";
import { smartPunct } from "./smartpunct";

// Simulates typing `typed` at `from` in `text` and applies the conversion
// the same way the editor's input handler does.
const type = (text: string, typed: string, from = text.length) => {
  const edit = smartPunct(text, from, from, typed);
  if (!edit) return text.slice(0, from) + typed + text.slice(from);
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
};

const typeAll = (keys: string, initial = "") => {
  let text = initial;
  for (const key of keys) text = type(text, key);
  return text;
};

describe("smart punctuation quotes (P3-AC-07)", () => {
  it("converts a double quote in CJK context only", () => {
    expect(type("他说", '"')).toBe("他说”");
    expect(type("你好", '"', 0)).toBe("“你好");
    expect(type("“你好", '"')).toBe("“你好”");
    expect(type("他（", '"')).toBe("他（“");
    // English context stays half-width.
    expect(type('say "hi', '"')).toBe('say "hi"');
    expect(type('a "b', '"')).toBe('a "b"');
  });

  it("converts a single quote only between two CJK characters", () => {
    expect(type("他", "'", 1)).toBe("他'");
    expect(type("他x", "'", 1)).toBe("他'x");
    expect(type("dont", "'", 3)).toBe("don't");
    expect(type("ab", "'", 1)).toBe("a'b");
    // Between two CJK characters.
    expect(type("他好", "'", 1)).toBe("他’好");
  });
});

describe("ellipsis and dashes (P3-AC-07)", () => {
  it("converts three dots to an ellipsis", () => {
    expect(typeAll("...")).toBe("…");
    expect(typeAll("等等...")).toBe("等等…");
    expect(typeAll("....")).toBe("….");
  });

  it("converts -- to en dash and --- to em dash", () => {
    expect(typeAll("a--")).toBe("a–");
    expect(typeAll("a---")).toBe("a—");
    expect(typeAll("他--说")).toBe("他–说");
  });

  it("keeps a line of only --- as a thematic break", () => {
    expect(typeAll("---")).toBe("---");
    expect(typeAll("  ---")).toBe("  ---");
    expect(typeAll("上\n\n---")).toBe("上\n\n---");
  });
});

describe("protected regions (P3-AC-08)", () => {
  it("does not convert inside code, math, front matter or links", () => {
    const fenced = "```\nco--\n```";
    expect(type(fenced, "-", 6)).toBe("```\nco---\n```");
    expect(type("`x--`", "-", 4)).toBe("`x---`");
    // Inside front matter the dash never becomes a dash character.
    expect(type("---\na: 1\n---\n正", "-", 3)).toBe("----\na: 1\n---\n正");
    expect(type("$a--$", "-", 4)).toBe("$a---$");
    expect(type("[t](https://a--b)", "-", 13)).toBe("[t](https://a---b)");
    expect(type('他说`--`之后', '"')).toBe('他说`--`之后”');
  });

  it("passes multi-character input and non-target keys through", () => {
    expect(smartPunct("a", 1, 1, "粘贴")).toBeNull();
    expect(smartPunct("a", 1, 1, "x")).toBeNull();
  });
});
