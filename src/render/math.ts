// KaTeX pass over the rendered document (docs/decisions.md D-T02). Go keeps
// the TeX intact; this module turns it into math and degrades one formula at
// a time, never the whole page.
import katex from "katex";
import "katex/dist/katex.min.css";

/** validateMath parses one formula without touching the document (M6-2). */
export function validateMath(tex: string, displayMode: boolean): { ok: boolean; error?: string } {
  try {
    katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: "warn",
      maxSize: 50,
      maxExpand: 1000,
      output: "htmlAndMathml",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** renderMath typesets every `.math` node under root. Returns how many did. */
export function renderMath(root: ParentNode): number {
  const nodes = root.querySelectorAll<HTMLElement>(".math");
  let rendered = 0;
  for (const el of nodes) {
    // An element keeps its `.math` class after KaTeX replaces its children;
    // re-running the pass would typeset the output as TeX again.
    if (el.querySelector(".katex") || el.classList.contains("math-error")) continue;
    const tex = el.textContent ?? "";
    const displayMode = el.dataset.display === "true";
    try {
      katex.render(tex, el, {
        displayMode,
        throwOnError: true,
        // No \href, \includegraphics or other commands that reach outwards.
        trust: false,
        strict: "warn",
        maxSize: 50,
        // A macro bomb cannot expand forever (PRD §8.3).
        maxExpand: 1000,
        output: "htmlAndMathml",
      });
      rendered += 1;
    } catch (err) {
      el.classList.add("math-error");
      el.dataset.reason = err instanceof Error ? err.message : String(err);
      // The source stays readable where the formula stood.
      el.textContent = tex;
    }
  }
  return rendered;
}
