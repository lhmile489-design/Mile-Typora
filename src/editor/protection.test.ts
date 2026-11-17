import { describe, expect, it } from "vitest";
import { inlineProtected, protectedAt } from "./protection";
import { mathProtected } from "./mathtools";

// P3-AC-14: the same sample must give math, punctuation and (later) the spell
// checker the same exclusion verdict at every position.
describe("shared inline protection (P3-AC-14)", () => {
  const sample = [
    "---",
    "title: x",
    "---",
    "正文 \"引号\" 和 $a+b$ 公式",
    "`行内代码 --` 与 [链接](https://a.com/x-y) 和 <https://b.com>",
    "```",
    "代码 \" -- ...",
    "```",
    "$$",
    "块级公式 --",
    "$$",
    "纯文本 -- ... \" '",
  ].join("\n");

  const verdicts = (pos: number) => protectedAt(sample, pos);

it("mathProtected is the shared verdict without math regions", () => {
    for (let pos = 0; pos <= sample.length; pos++) {
      // Math commands still run inside formulas, so they use the same
      // shared scan with only math excluded — never a separate detector.
      expect(mathProtected(sample, pos), `position ${pos}`).toBe(protectedAt(sample, pos, false));
    }
  });

  it("blocks front matter, fences, math and link destinations", () => {
    expect(protectedAt(sample, 0)).toBe(true); // front matter ---
    const fence = sample.indexOf("代码");
    expect(protectedAt(sample, fence)).toBe(true);
    const block = sample.indexOf("块级公式");
    expect(protectedAt(sample, block)).toBe(true);
    const dest = sample.indexOf("x-y");
    expect(protectedAt(sample, dest)).toBe(true);
    const auto = sample.indexOf("b.com");
    expect(protectedAt(sample, auto)).toBe(true);
    const inline = sample.indexOf("行内代码");
    expect(protectedAt(sample, inline)).toBe(true);
  });

  it("allows plain prose positions", () => {
    const prose = sample.indexOf("纯文本");
    expect(protectedAt(sample, prose + 3)).toBe(false);
    const label = sample.indexOf("链接");
    expect(protectedAt(sample, label)).toBe(false);
    expect(verdicts(prose + 3)).toBe(false);
  });
});

describe("inlineProtected details", () => {
  it("marks only the destination of an inline link, not the label", () => {
    const line = "[标签](https://a.com/p)";
    const label = line.indexOf("标");
    const url = line.indexOf("a.com");
    expect(inlineProtected(line, label)).toBe(false);
    expect(inlineProtected(line, url)).toBe(true);
  });

  it("marks reference destinations and autolinks", () => {
    expect(inlineProtected("[id]: https://a.com", 10)).toBe(true);
    expect(inlineProtected("看 <mailto:a@b.c> 吧", 5)).toBe(true);
  });

  it("marks inline math but not the delimiters' outside", () => {
    const line = "前 $x$ 后";
    expect(inlineProtected(line, line.indexOf("x"))).toBe(true);
    expect(inlineProtected(line, 0)).toBe(false);
  });
});
