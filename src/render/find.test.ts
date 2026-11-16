import { describe, expect, it } from "vitest";
import { advance, collectRanges } from "./find";

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  return el;
}

describe("collectRanges", () => {
  it("finds every literal match in document order", () => {
    const root = article("<p>Markdown 与 markdown</p><p>第三个 Markdown</p>");
    const ranges = collectRanges(root, "markdown");
    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.toString()).toBe("Markdown");
    expect(ranges[2]?.toString()).toBe("Markdown");
  });

  it("matches Chinese exactly", () => {
    const root = article("<p>安装步骤与安装</p>");
    expect(collectRanges(root, "安装")).toHaveLength(2);
  });

  it("skips formulas, diagrams and hidden sources", () => {
    const root = article(
      '<p>正文 Markdown</p><span class="math">Markdown $x$</span>' +
        '<div class="katex">Markdown</div><pre class="mermaid-src">Markdown</pre>',
    );
    const ranges = collectRanges(root, "Markdown");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.parentElement?.tagName).toBe("P");
  });

  it("returns nothing for an empty query", () => {
    expect(collectRanges(article("<p>a</p>"), "   ")).toHaveLength(0);
  });
});

describe("advance", () => {
  it("wraps around both ways", () => {
    expect(advance(0, 3, false)).toBe(1);
    expect(advance(2, 3, false)).toBe(0);
    expect(advance(0, 3, true)).toBe(2);
    expect(advance(0, 0, false)).toBe(0);
  });
});
