// In-document search (PRD FR-05): literal matching, case-insensitive for
// Latin text, painted with the CSS Custom Highlight API so the document's own
// DOM is never modified. Formulas and diagrams take no part: their text is not
// what the reader sees.

/** Names of the two highlight groups. */
export const FIND_GROUP = "find";
export const CURRENT_GROUP = "find-current";

/** Subtrees the search never looks into. */
const SKIPPED = "script, style, .katex, svg, .mermaid-src, .math, .math-error";

/** highlightsSupported reports whether the window can paint highlights. */
export function highlightsSupported(): boolean {
  const css = globalThis.CSS as unknown as { highlights?: unknown } | undefined;
  return Boolean(css?.highlights) && typeof globalThis.Highlight === "function";
}

/**
 * collectRanges finds every literal occurrence of query under root, in
 * document order. Latin letters match regardless of case; other scripts match
 * as written (`toLocaleLowerCase` keeps the length of Chinese text).
 */
export function collectRanges(root: ParentNode, query: string): Range[] {
  const needleText = query.trim();
  if (needleText === "") return [];
  const needle = needleText.toLocaleLowerCase();

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIPPED)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (text === "") continue;
    const haystack = text.toLocaleLowerCase();
    // A lowercase that changes the length would move every later offset.
    if (haystack.length !== text.length) continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      from = at + needle.length;
    }
  }
  return ranges;
}

/** paint draws the matches, with one of them marked as current. */
export function paint(ranges: Range[], current: number): void {
  if (!highlightsSupported()) return;
  const highlights = (globalThis.CSS as unknown as { highlights: HighlightRegistry }).highlights;
  highlights.clear();
  if (ranges.length === 0) return;
  highlights.set(FIND_GROUP, new Highlight(...ranges));
  const active = ranges[current];
  if (active) highlights.set(CURRENT_GROUP, new Highlight(active));
}

/** clearHighlights removes both groups, as switching documents does. */
export function clearHighlights(): void {
  if (!highlightsSupported()) return;
  (globalThis.CSS as unknown as { highlights: HighlightRegistry }).highlights.clear();
}

/** scrollToRange brings a match into view without touching the layout. */
export function scrollToRange(range: Range): void {
  const element = range.startContainer.parentElement;
  element?.scrollIntoView({ block: "center" });
}

/** advance steps through matches and wraps around. */
export function advance(current: number, count: number, backwards: boolean): number {
  if (count === 0) return 0;
  const next = current + (backwards ? -1 : 1);
  return (next + count) % count;
}
