// Smart punctuation (P3 M6-3, EDIT-18). Pure transforms the editor's input
// handler calls per typed character; each conversion rides along with the
// keystroke's own transaction so one Ctrl+Z undoes the input, not two steps.
// Only new input is converted — no document rewrite, no batch command.

import { protectedAt } from "./protection";

export type SmartPunctEdit = {
  /** Replacement start offset in the current document. */
  from: number;
  /** Replacement end offset (== from + typed length for plain inserts). */
  to: number;
  /** The text to insert instead of the typed character. */
  insert: string;
};

const OPENERS = new Set(["(", "[", "{", "（", "【", "“", "‘"]);

// CJK context includes full-width punctuation: 他（" is a CJK opener the
// spec's own OPENERS list anticipates, while don't stays half-width because
// ASCII letters never match.
function isCJK(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

function charBefore(text: string, position: number): string | undefined {
  if (position <= 0) return undefined;
  return Array.from(text.slice(0, position)).pop();
}

function charAt(text: string, position: number): string | undefined {
  if (position >= text.length) return undefined;
  return Array.from(text.slice(position))[0];
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

/**
 * doubleQuote decides the curly quote for a typed `"`. Conversion only runs
 * in CJK context: the character before or after the caret is CJK, or the
 * previous non-space character on the line is CJK. An opener or blank before
 * the caret produces “; anything else ”.
 */
function doubleQuote(text: string, from: number, to: number): SmartPunctEdit | null {
  const prev = charBefore(text, from);
  const next = charAt(text, to);
  if (!isCJK(prev) && !isCJK(next)) return null;
  const open = prev === undefined || /\s/.test(prev) || OPENERS.has(prev);
  return { from, to, insert: open ? "“" : "”" };
}

/**
 * singleQuote converts a typed `'` only between two CJK characters — the
 * opening/closing pick follows the same opener rule. English contractions
 * (don't) and every other Latin context stay half-width.
 */
function singleQuote(text: string, from: number, to: number): SmartPunctEdit | null {
  const prev = charBefore(text, from);
  const next = charAt(text, to);
  if (!isCJK(prev) || !isCJK(next)) return null;
  const open = (prev !== undefined && OPENERS.has(prev)) || /\s/.test(prev ?? "");
  return { from, to, insert: open ? "‘" : "’" };
}

/**
 * period converts the third `.` of a `..` run into `…`, replacing all three
 * half-width dots. A fourth dot leaves the ellipsis alone.
 */
function period(text: string, from: number, to: number): SmartPunctEdit | null {
  if (text.slice(from - 2, from) !== "..") return null;
  if (charAt(text, to) === ".") return null;
  return { from: from - 2, to, insert: "…" };
}

/**
 * hyphen converts `--` to an en dash on the second keystroke, then that en
 * dash plus the third `-` to an em dash. A run of only dashes and spaces on
 * the line (a thematic break or a front-matter fence) never converts.
 */
function hyphen(text: string, from: number, to: number): SmartPunctEdit | null {
  const prev = charBefore(text, from);
  if (prev !== "-" && prev !== "–") return null;
  if (charAt(text, to) === "-") return null;
  const before = text.slice(lineStart(text, from), from);
  if (prev === "–") {
    // A converted en dash plus `-` is the third keystroke of `---` → —.
    if (/^[ \t]*–$/.test(before)) return null;
    return { from: from - 1, to, insert: "—" };
  }
  // A line holding only dashes and whitespace stays literal.
  if (/^[ \t-]+$/.test(before)) return null;
  if (before.endsWith("--")) {
    // The selection sits right after `--` (e.g. undo restored the pair).
    return { from: from - 2, to, insert: "—" };
  }
  return { from: from - 1, to, insert: "–" };
}

/**
 * smartPunct returns the replacement for one typed character at the caret,
 * or null when the input should pass through unchanged. `from`/`to` describe
 * the range the typed text would replace (an expanded selection). Callers
 * must skip IME composition and multi-character input (paste).
 */
export function smartPunct(text: string, from: number, to: number, typed: string): SmartPunctEdit | null {
  if (typed.length !== 1) return null;
  if (protectedAt(text, from)) return null;
  switch (typed) {
    case '"':
      return doubleQuote(text, from, to);
    case "'":
      return singleQuote(text, from, to);
    case ".":
      return period(text, from, to);
    case "-":
      return hyphen(text, from, to);
    default:
      return null;
  }
}
