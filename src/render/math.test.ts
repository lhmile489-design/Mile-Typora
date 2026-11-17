import { describe, expect, it } from "vitest";
import { renderMath, validateMath } from "./math";

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  return el;
}

describe("renderMath", () => {
  it("typesets inline and block formulas", () => {
    const root = article(
      '<p>前 <span class="math" data-display="false">E = mc^2</span> 后</p>' +
        '<div class="math" data-display="true">a^2 + b^2 = c^2</div>',
    );
    expect(renderMath(root)).toBe(2);
    expect(root.querySelectorAll(".katex").length).toBe(2);
    expect(root.querySelector(".math-error")).toBeNull();
  });

  it("keeps other content untouched", () => {
    const root = article("<p>没有公式</p>");
    expect(renderMath(root)).toBe(0);
    expect(root.textContent).toBe("没有公式");
  });

  it("does not typeset its own output again", () => {
    const root = article('<span class="math" data-display="false">E = mc^2</span>');
    expect(renderMath(root)).toBe(1);
    const math = root.querySelector(".katex-mathml math")?.innerHTML ?? "";
    expect(renderMath(root)).toBe(0);
    expect(root.querySelector(".katex-mathml math")?.innerHTML).toBe(math);
  });

  it("degrades one broken formula and keeps its source readable", () => {
    const root = article(
      '<span class="math" data-display="false">\\nope</span>' +
        '<span class="math" data-display="false">x^2</span>',
    );
    expect(renderMath(root)).toBe(1);
    const failed = root.querySelector(".math-error");
    expect(failed).not.toBeNull();
    expect(failed?.textContent).toBe("\\nope");
    expect(failed?.getAttribute("data-reason")).toBeTruthy();
    // The good formula next to it still rendered.
    expect(root.querySelectorAll(".katex").length).toBe(1);
  });

  it("refuses commands that reach outside the page", () => {
    const root = article('<span class="math" data-display="false">\\href{https://example.com}{x}</span>');
    renderMath(root);
    // trust: false turns it into a failure rather than a link.
    expect(root.querySelector("a[href]")).toBeNull();
  });
});

describe("validateMath", () => {
  it("accepts a valid formula and reports KaTeX errors", () => {
    expect(validateMath("x^2 + 1", false).ok).toBe(true);
    const bad = validateMath("\\nope", false);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });
});
