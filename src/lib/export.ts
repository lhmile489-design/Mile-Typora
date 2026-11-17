// Standalone HTML export helpers for M5-6. The page has already sanitized the
// Markdown and enhanced formulas/diagrams; this module only turns the live
// DOM into a static body that Go can wrap and sanitize again.

/** serializeExportBody flattens the enhanced article for export. */
export function serializeExportBody(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  for (const frontMatter of Array.from(clone.querySelectorAll("details.fm"))) {
    frontMatter.remove();
  }
  for (const formula of Array.from(clone.querySelectorAll(".katex"))) {
    const math = formula.querySelector(".katex-mathml math");
    if (math) {
      const copy = math.cloneNode(true) as Element;
      const display = formula.closest(".math")?.getAttribute("data-display") === "true";
      copy.setAttribute("display", display ? "block" : "inline");
      formula.replaceWith(copy);
      continue;
    }
    const tex =
      formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
      formula.getAttribute("aria-label") ??
      "";
    const fallback = document.createElement("span");
    fallback.className = "math-error";
    fallback.textContent = tex;
    formula.replaceWith(fallback);
  }
  for (const script of Array.from(clone.querySelectorAll("script"))) script.remove();
  return clone.innerHTML;
}
