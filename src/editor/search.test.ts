import { describe, expect, it } from "vitest";
import { findMatches, replaceEvery, replaceOne } from "./search";

describe("source search", () => {
  it("matches literal text, ignoring ASCII letter case", () => {
    expect(findMatches("Hello hello 世界", "hello")).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
    ]);
    expect(findMatches("世界世界", "世界")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
    expect(findMatches("École école", "école")).toHaveLength(2);
  });

  it("treats punctuation literally and returns nothing for an empty query", () => {
    expect(findMatches("a.b a*b", "a.")).toEqual([{ from: 0, to: 2 }]);
    expect(findMatches("abc", "")).toEqual([]);
    expect(findMatches("abc", "   ")).toEqual([]);
  });

  it("replaces one match and moves to the next hit", () => {
    const result = replaceOne("a A a", "a", "x", 0);
    expect(result.text).toBe("x A a");
    expect(result.replaced).toBe(true);
    expect(result.index).toBe(0);
    expect(result.matches).toHaveLength(2);
  });

  it("replaces every match with one result buffer", () => {
    const result = replaceEvery("a A a", "a", "xy");
    expect(result.text).toBe("xy xy xy");
    expect(result.count).toBe(3);
  });
});
