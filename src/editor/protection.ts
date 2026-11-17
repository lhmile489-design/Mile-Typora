// Shared inline protection (P3-AC-14). Math tools, smart punctuation and the
// spell checker must agree on where plain-text transforms are not allowed:
// code, math, front matter, HTML and link/image addresses. One module keeps
// the three scanners from drifting apart.

import { protectedLineSet } from "./paragraph";
import { mathRanges } from "./mathtools";

type Line = { start: number; end: number; text: string };

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

function lineIndexAt(lines: Line[], position: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i]!.start) return i;
  }
  return 0;
}

function mark(mask: boolean[], start: number, end: number): void {
  for (let i = Math.max(0, start); i < Math.min(mask.length, end); i++) mask[i] = true;
}

/** maskRanges paints every match of a whole-line pattern onto the mask. */
function maskRanges(line: string, pattern: RegExp, mask: boolean[]): void {
  let match: RegExpExecArray | null;
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  while ((match = re.exec(line))) {
    if (match[0] === "") {
      re.lastIndex++;
      continue;
    }
    mark(mask, match.index, match.index + match[0].length);
  }
}

// Inline code spans (`x`, ``x``). Backtick runs match their own length.
const CODE_SPAN = /(`+)([\s\S]*?)\1/;
// HTML comments and tags (block or inline).
const HTML = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>?/;
// Bare autolinks in angle brackets and plain URLs typed in text.
const AUTOLINK = /<(?:https?|mailto):[^>\n]*>|\bhttps?:\/\/[^\s<>()\[\]"']+/;

/**
 * markLinkDestinations masks only the address text of inline links/images and
 * reference definitions — the label keeps its normal typing rules.
 */
function markLinkDestinations(line: string, mask: boolean[]): void {
  const inline = /!?\[[^\]\n]*\]\(([^)\n]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(line))) {
    const inner = match[1]!;
    const title = /\s+["'(]/.exec(inner);
    const address = (title ? inner.slice(0, title.index) : inner).trim();
    if (address === "") continue;
    const start = match.index + match[0].indexOf(inner) + inner.indexOf(address);
    mark(mask, start, start + address.length);
  }
  const reference = /^\s{0,3}\[[^\]\n]*\]:[ \t]*(\S+)/;
  const ref = reference.exec(line);
  if (ref) {
    const start = ref.index + ref[0].length - ref[1]!.length;
    mark(mask, start, ref.index + ref[0].length);
  }
}

/** inlineMask marks code spans, HTML and link destinations on one line. */
function inlineMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  maskRanges(line, CODE_SPAN, mask);
  maskRanges(line, HTML, mask);
  maskRanges(line, AUTOLINK, mask);
  markLinkDestinations(line, mask);
  return mask;
}

/**
 * inlineProtected reports a caret inside an inline code span, an HTML tag or
 * comment, a link/image destination, an autolink, or an inline math formula —
 * the inline half of the shared rule. Block-level regions (fences, indented
 * code, math blocks, front matter, thematic breaks) come from
 * protectedLineSet; math additionally from mathRanges so `$…$` and `\(…\)`
 * inline spans count too.
 */
export function inlineProtected(text: string, position: number, includeMath = true): boolean {
  const lines = splitLines(text);
  const index = lineIndexAt(lines, position);
  const line = lines[index]!;
  const offset = Math.max(0, Math.min(position - line.start, line.text.length));
  const mask = inlineMask(line.text);
  if (mask[offset] || (offset > 0 && mask[offset - 1])) return true;
  if (!includeMath) return false;
  for (const formula of mathRanges(text)) {
    if (formula.kind === "inline" && position > formula.start && position < formula.end) return true;
  }
  return false;
}

/**
 * protectedAt is the shared verdict: true when a position may not receive a
 * smart-punctuation conversion or a spell-check mark — protected block line,
 * inline code / HTML / link destination, or inside a math formula. Callers
 * that must still allow math formulas (the math tools themselves) exclude
 * them with the includeMath flag.
 */
export function protectedAt(text: string, position: number, includeMath = true): boolean {
  const lines = splitLines(text);
  const index = lineIndexAt(lines, position);
  if (protectedLineSet(text).has(index)) return true;
  return inlineProtected(text, position, includeMath);
}
