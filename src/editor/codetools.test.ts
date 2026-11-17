import { describe, expect, it } from "vitest";
import { codeFences, fenceAt, isMakefile, lowercaseLanguage, reindent, toTabs } from "./codetools";

const snap = (text: string, position: number) => ({ text, anchor: position, head: position });

const caretIn = (text: string, marker = "|") => {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error("fixture has no caret marker");
  return snap(text.replace(marker, ""), at);
};

const selectIn = (text: string, open = "[", close = "]") => {
  const from = text.indexOf(open);
  const to = text.indexOf(close);
  if (from < 0 || to < 0 || to < from) throw new Error("fixture has no selection markers");
  const text2 = text.replace(open, "").replace(close, "");
  return { text: text2, anchor: from, head: to - open.length };
};

describe("codeFences", () => {
  it("finds one fenced block with its language", () => {
    const { fences } = codeFences("before\n```TS\nlet a = 1\n```\nafter");
    expect(fences).toHaveLength(1);
    expect(fences[0]!.language).toBe("ts");
    expect(fences[0]!.open).toBe(1);
    expect(fences[0]!.close).toBe(3);
    expect(fences[0]!.bodyStart).toBe(2);
    expect(fences[0]!.bodyEnd).toBe(2);
  });

  it("runs an unclosed fence to the buffer end", () => {
    const { fences } = codeFences("```js\nlet a = 1\nlet b = 2");
    expect(fences).toHaveLength(1);
    expect(fences[0]!.close).toBe(2);
    expect(fences[0]!.bodyEnd).toBe(2);
  });

  it("skips front matter before scanning fences", () => {
    const { fences } = codeFences("---\ntitle: `x`\n---\n```py\nprint(1)\n```");
    expect(fences).toHaveLength(1);
    expect(fences[0]!.open).toBe(3);
  });

  it("accepts tilde fences and longer closing fences", () => {
    const { fences } = codeFences("~~~js\nlet a\n~~~~~");
    expect(fences).toHaveLength(1);
    expect(fences[0]!.close).toBe(2);
  });

  it("ignores a fence opener inside a fenced block", () => {
    const text = "```md\nsome ```js fake\n```\nreal";
    const { fences } = codeFences(text);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.bodyEnd).toBe(1);
  });

  it("does not treat an indented code block as a fence", () => {
    const { fences } = codeFences("    let a = 1\n    let b = 2");
    expect(fences).toHaveLength(0);
  });
});

describe("fenceAt", () => {
  const doc = "intro\n```js\nlet a = 1\nlet b = 2\n```\noutro";

  it("returns the fence when the caret is in the body", () => {
    const target = fenceAt(snap(doc, doc.indexOf("a = 1")));
    expect(target?.kind).toBe("ok");
  });

  it("returns the fence when the caret is on a fence line", () => {
    const target = fenceAt(snap(doc, doc.indexOf("```js") + 2));
    expect(target?.kind).toBe("ok");
  });

  it("returns null outside any fence", () => {
    expect(fenceAt(snap(doc, 0))).toBeNull();
    expect(fenceAt(snap(doc, doc.length))).toBeNull();
  });

  it("accepts a selection that stays inside one fence", () => {
    const target = fenceAt(selectIn("intro\n```js\nlet [a = 1\nlet b = ]2\n```\noutro"));
    expect(target?.kind).toBe("ok");
  });

  it("refuses a selection crossing the fence boundary", () => {
    const crossing = fenceAt(selectIn("intro\n```js\nlet a = 1\nle[t b = 2\n```\nout]ro"));
    expect(crossing?.kind).toBe("cross");
  });

  it("returns null for a selection that never touches a fence", () => {
    expect(fenceAt(selectIn("op[en text only] here"))).toBeNull();
  });

  it("refuses a selection spanning two fences", () => {
    const crossing = fenceAt(selectIn("```a\n[x\n```\nmid\n```b\ny]\n```"));
    expect(crossing?.kind).toBe("cross");
  });
});

describe("isMakefile", () => {
  it("flags makefile and make languages", () => {
    expect(isMakefile({ open: 0, close: 2, bodyStart: 1, bodyEnd: 1, language: "makefile", hasInfo: true })).toBe(true);
    expect(isMakefile({ open: 0, close: 2, bodyStart: 1, bodyEnd: 1, language: "make", hasInfo: true })).toBe(true);
    expect(isMakefile({ open: 0, close: 2, bodyStart: 1, bodyEnd: 1, language: "ts", hasInfo: true })).toBe(false);
    expect(isMakefile({ open: 0, close: 2, bodyStart: 1, bodyEnd: 1, language: "", hasInfo: false })).toBe(false);
  });
});

describe("reindent", () => {
  it("expands tabs and re-indents to 2-space multiples", () => {
    const text = "```ts\n\tlet a = 1\n\t\tlet b = 2\n```";
    const edit = reindent(snap(text, text.indexOf("a = 1")), 2);
    expect(edit?.text).toBe("```ts\n  let a = 1\n    let b = 2\n```");
  });

  it("re-indents to 4-space multiples, rounding to the nearest level", () => {
    const text = "```ts\n  let a = 1\n      let b = 2\n```";
    const edit = reindent(snap(text, text.indexOf("a = 1")), 4);
    // 2 cols -> level 1 -> 4; 6 cols -> level 2 (nearest) -> 8.
    expect(edit?.text).toBe("```ts\n    let a = 1\n        let b = 2\n```");
  });

  it("keeps a shared leading indent instead of dedenting to zero", () => {
    const text = "```ts\n    let a = 1\n      let b = 2\n```";
    const edit = reindent(snap(text, text.indexOf("a = 1")), 2);
    // 4/6 cols -> levels 1/2 -> 2/4 spaces: still indented, structure kept.
    expect(edit?.text).toBe("```ts\n  let a = 1\n    let b = 2\n```");
  });

  it("returns null when already aligned to the width", () => {
    const text = "```ts\n    let a = 1\n        let b = 2\n```";
    expect(reindent(snap(text, text.indexOf("a = 1")), 4)).toBeNull();
  });

  it("never touches the fence lines or inline whitespace", () => {
    const text = "```ts extra\n\tlet   a = 1\n```";
    const edit = reindent(snap(text, text.indexOf("a = 1")), 2);
    expect(edit?.text.startsWith("```ts extra\n")).toBe(true);
    expect(edit?.text.endsWith("\n```")).toBe(true);
    expect(edit?.text).toContain("let   a = 1"); // inline spacing kept
  });

  it("returns null outside a fence", () => {
    expect(reindent(snap("plain\ntext", 0), 2)).toBeNull();
  });

  it("keeps the caret inside the transformed block", () => {
    const text = "```ts\n\t\t\tlet a = 1\n```";
    const at = text.indexOf("let");
    const edit = reindent(snap(text, at), 2);
    expect(edit).not.toBeNull();
    const lineStart = edit!.text.indexOf("      let");
    const lineEnd = edit!.text.indexOf("\n", lineStart);
    expect(edit!.head).toBeGreaterThanOrEqual(lineStart);
    expect(edit!.head).toBeLessThanOrEqual(lineEnd);
  });
});

describe("toTabs", () => {
  it("converts multiples of four columns into tabs", () => {
    const text = "```ts\n        let a = 1\n    let b = 2\n```";
    const { edit, skipped } = toTabs(snap(text, text.indexOf("a = 1")));
    expect(skipped).toBe(0);
    expect(edit?.text).toBe("```ts\n\t\tlet a = 1\n\tlet b = 2\n```");
  });

  it("leaves non-multiple lines alone and reports them", () => {
    const text = "```ts\n      let a = 1\n    let b = 2\n```";
    const { edit, skipped } = toTabs(snap(text, text.indexOf("a = 1")));
    expect(skipped).toBe(1);
    expect(edit?.text).toBe("```ts\n      let a = 1\n\tlet b = 2\n```");
  });

  it("returns no edit when nothing is convertible", () => {
    const text = "```ts\nlet a = 1\nlet b = 2\n```";
    const { edit, skipped } = toTabs(snap(text, text.indexOf("a = 1")));
    expect(edit).toBeNull();
    expect(skipped).toBe(0);
  });

  it("leaves makefile recipes convertible (tabs stay tabs)", () => {
    const text = "```makefile\nall:\n\tbuild\n```";
    const { edit } = toTabs(snap(text, text.indexOf("build")));
    expect(edit).toBeNull(); // already tabs -> nothing to change
  });
});

describe("lowercaseLanguage", () => {
  it("lowercases the first info token only", () => {
    const text = "```TS {1,2}\nlet a = 1\n```";
    const edit = lowercaseLanguage(snap(text, text.indexOf("a = 1")));
    expect(edit?.text).toBe("```ts {1,2}\nlet a = 1\n```");
  });

  it("leaves unknown languages untouched", () => {
    const text = "```FROBNICATE\nlet a = 1\n```";
    expect(lowercaseLanguage(snap(text, text.indexOf("a = 1")))).toBeNull();
  });

  it("leaves already-lowercase tags alone (no dirty mark)", () => {
    const text = "```ts\nlet a = 1\n```";
    expect(lowercaseLanguage(snap(text, text.indexOf("a = 1")))).toBeNull();
  });

  it("returns null when the fence has no info string", () => {
    const text = "```\nlet a = 1\n```";
    expect(lowercaseLanguage(snap(text, text.indexOf("a = 1")))).toBeNull();
  });

  it("returns null outside a fence", () => {
    expect(lowercaseLanguage(snap("just text", 0))).toBeNull();
  });
});
