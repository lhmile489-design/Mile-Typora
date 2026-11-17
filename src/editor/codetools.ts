// Code-block tools (P3 M6-5 PARA-08). Pure snapshot transforms; SourceEditor
// applies each result as one undo step. Only fenced code blocks are touched:
// fence lines, fence length and inline whitespace inside the body stay as-is,
// and indented code blocks are never matched.

import type { ParagraphEdit, Snapshot } from "./paragraph";
import { indentColumns } from "./paragraph";

type Line = { start: number; end: number; text: string };

export type CodeFence = {
  /** Index of the opening fence line. */
  open: number;
  /** Index of the closing fence line; equals the last body line when unclosed. */
  close: number;
  /** First body line index (open + 1). */
  bodyStart: number;
  /** Last body line index (close - 1, or close when unclosed). */
  bodyEnd: number;
  /** First token of the info string, lowercased ("makefile", "ts", "" ...). */
  language: string;
  /** Info string was present on the opening fence. */
  hasInfo: boolean;
};

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

const FRONT = /^ {0,3}(?:---|\.\.\.)[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const INDENTED_CODE = /^(?: {4}|\t)/;

/** infoToken returns the first word of a fence info string. */
function infoToken(info: string): string {
  const match = /^\s*([^\s`]+)/.exec(info);
  return match?.[1] ?? "";
}

/**
 * codeFences scans the buffer for fenced code blocks. Front matter and lines
 * already inside a fence are skipped; closing fences must use the same char
 * and at least the opening length. An unclosed fence runs to the buffer end.
 */
export function codeFences(text: string): { lines: Line[]; fences: CodeFence[] } {
  const lines = splitLines(text);
  const fences: CodeFence[] = [];
  let scanFrom = 0;
  if (lines[0] && FRONT.test(lines[0].text) && lines[0].text.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (FRONT.test(lines[i]!.text)) {
        scanFrom = i + 1;
        break;
      }
    }
  }

  let open: { index: number; char: string; length: number; info: string } | null = null;
  const closeFence = (end: number) => {
    if (!open) return;
    const info = infoToken(open.info);
    fences.push({
      open: open.index,
      close: end,
      bodyStart: open.index + 1,
      bodyEnd: end - 1,
      language: info.toLowerCase(),
      hasInfo: info !== "",
    });
    open = null;
  };

  for (let i = scanFrom; i < lines.length; i++) {
    const line = lines[i]!;
    if (open) {
      const close = FENCE_CLOSE.exec(line.text);
      if (close && close[1]![0] === open.char && close[1]!.length >= open.length) {
        closeFence(i);
      }
      continue;
    }
    if (INDENTED_CODE.test(line.text)) continue;
    const opener = FENCE_OPEN.exec(line.text);
    if (!opener) continue;
    const char = opener[1]![0]!;
    const info = opener[2] ?? "";
    // A backtick fence cannot carry a backtick in its info string (CommonMark);
    // such a line is plain text, not a fence opener.
    if (char === "`" && info.includes("`")) continue;
    open = { index: i, char, length: opener[1]!.length, info };
  }
  if (open) {
    // Unclosed fence: the body runs to the last line, which is body content.
    const info = infoToken(open.info);
    fences.push({
      open: open.index,
      close: lines.length - 1,
      bodyStart: open.index + 1,
      bodyEnd: lines.length - 1,
      language: info.toLowerCase(),
      hasInfo: info !== "",
    });
  }
  return { lines, fences };
}

function lineIndexAt(lines: Line[], position: number): number {
  if (position <= 0) return 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i]!.start) return i;
  }
  return 0;
}

/**
 * fenceAt returns the fenced code block the caret sits in, or the one fence a
 * selection stays inside. A selection that crosses a fence boundary returns
 * "cross" so the command can refuse with a notice; anything else returns null.
 */
export function fenceAt(
  snapshot: Snapshot,
): { kind: "ok"; lines: Line[]; fence: CodeFence } | { kind: "cross" } | null {
  const { lines, fences } = codeFences(snapshot.text);
  if (fences.length === 0) return null;
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);

  if (from === to) {
    const caret = lineIndexAt(lines, snapshot.head);
    for (const fence of fences) {
      // Caret anywhere inside the block (fences included) enables the tools.
      if (caret >= fence.open && caret <= fence.close) return { kind: "ok", lines, fence };
    }
    return null;
  }

  // Selection: every touched line must stay inside this one fence; overlapping
  // a fence without staying inside is a boundary cross and gets refused.
  const selStart = lineIndexAt(lines, from);
  let selEnd = lineIndexAt(lines, to);
  if (selEnd > selStart && to === lines[selEnd]!.start) selEnd--;
  for (const fence of fences) {
    if (selStart >= fence.open && selEnd <= fence.close) return { kind: "ok", lines, fence };
    if (selStart <= fence.close && selEnd >= fence.open) return { kind: "cross" };
  }
  return null;
}

/** isMakefile reports whether the block keeps tabs mandatory (P3 §3.5). */
export function isMakefile(fence: CodeFence): boolean {
  return fence.language === "makefile" || fence.language === "make";
}

type BodyLine = { index: number; indent: string; rest: string; columns: number };

function bodyLines(lines: Line[], fence: CodeFence): BodyLine[] {
  const body: BodyLine[] = [];
  for (let i = fence.bodyStart; i <= fence.bodyEnd; i++) {
    const line = lines[i]!;
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    body.push({ index: i, indent, rest: line.text.slice(indent.length), columns: indentColumns(indent) });
  }
  return body;
}

function rebuild(lines: Line[], replacements: Map<number, string>): string {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    parts.push(replacements.get(i) ?? lines[i]!.text);
  }
  return parts.join("\n");
}

function caretFor(snapshot: Snapshot, lines: Line[], changed: Map<number, string>): { anchor: number; head: number } {
  // Keep the caret on its original line, clamped into that line's new bounds.
  const headLine = lineIndexAt(lines, snapshot.head);
  const anchorLine = lineIndexAt(lines, snapshot.anchor);
  const place = (lineIndex: number, offset: number) => {
    const line = lines[lineIndex]!;
    const next = changed.get(lineIndex) ?? line.text;
    const inside = Math.max(0, Math.min(offset - line.start, next.length));
    return line.start + inside;
  };
  const head = place(headLine, snapshot.head);
  const anchor = snapshot.anchor === snapshot.head ? head : place(anchorLine, snapshot.anchor);
  return { anchor, head };
}

/**
 * reindent expands leading tabs into 4-column levels, then rewrites each body
 * line's leading whitespace as level*width spaces. Indentation is absolute per
 * line, so a shared leading indent survives as structure, never dedented to
 * zero. Returns null when nothing would change (no dirty mark) or the target
 * is not a fenced block.
 */
export function reindent(snapshot: Snapshot, width: 2 | 4): ParagraphEdit {
  const target = fenceAt(snapshot);
  if (!target || target.kind !== "ok") return null;
  const { lines, fence } = target;
  const body = bodyLines(lines, fence);
  if (body.every((line) => line.rest.trim() === "")) return null;

  const changed = new Map<number, string>();
  for (const line of body) {
    if (line.rest.trim() === "") {
      // Blank lines keep their own whitespace: they carry no indent level.
      continue;
    }
    const columns = Math.round(line.columns / 4) * width;
    const next = " ".repeat(columns) + line.rest;
    if (next !== line.indent + line.rest) changed.set(line.index, next);
  }
  if (changed.size === 0) return null;
  const text = rebuild(lines, changed);
  const caret = caretFor(snapshot, lines, changed);
  return { text, anchor: caret.anchor, head: caret.head };
}

/**
 * toTabs converts leading whitespace to tabs, one tab per four columns. Lines
 * whose indent column is not a multiple of four are kept as-is and counted so
 * the caller can report "N 行未转换".
 */
export function toTabs(snapshot: Snapshot): { edit: ParagraphEdit; skipped: number } {
  const target = fenceAt(snapshot);
  if (!target || target.kind !== "ok") return { edit: null, skipped: 0 };
  const { lines, fence } = target;
  const body = bodyLines(lines, fence);

  const changed = new Map<number, string>();
  let skipped = 0;
  for (const line of body) {
    if (line.rest.trim() === "") continue;
    if (line.indent === "" || line.columns % 4 !== 0) {
      if (line.columns % 4 !== 0) skipped++;
      continue;
    }
    const tabs = "\t".repeat(line.columns / 4);
    const next = tabs + line.rest;
    if (next !== line.indent + line.rest) changed.set(line.index, next);
  }
  if (changed.size === 0) return { edit: null, skipped };
  const text = rebuild(lines, changed);
  const caret = caretFor(snapshot, lines, changed);
  return { edit: { text, anchor: caret.anchor, head: caret.head }, skipped };
}

const KNOWN_LANGUAGES = new Set([
  "bash", "c", "cpp", "csharp", "css", "diff", "go", "golang", "html",
  "ini", "java", "javascript", "js", "json", "jsx", "kotlin", "lua",
  "make", "makefile", "markdown", "md", "objc", "php", "plaintext",
  "powershell", "python", "py", "r", "ruby", "rust", "sh", "shell",
  "sql", "swift", "toml", "ts", "tsx", "typescript", "xml", "yaml", "yml",
]);

/**
 * lowercaseLanguage rewrites only the first token of the opening fence's info
 * string to lowercase. Fences without info, already-lowercase tags and tokens
 * outside the known-language set are left alone (null, no dirty mark).
 */
export function lowercaseLanguage(snapshot: Snapshot): ParagraphEdit {
  const target = fenceAt(snapshot);
  if (!target || target.kind !== "ok") return null;
  const { lines, fence } = target;
  if (!fence.hasInfo) return null;
  const line = lines[fence.open]!;
  const open = FENCE_OPEN.exec(line.text);
  if (!open) return null;
  const info = open[2] ?? "";
  const token = /^\s*([^\s`]+)/.exec(info);
  if (!token) return null;
  const raw = token[1]!;
  const lower = raw.toLowerCase();
  if (raw === lower || !KNOWN_LANGUAGES.has(lower)) return null;

  // token.index is relative to the info part; the info starts right after the
  // leading whitespace (≤3 columns) and the fence characters.
  const leading = /^ {0,3}/.exec(line.text)?.[0].length ?? 0;
  const tokenStart = leading + open[1]!.length + (token.index ?? 0);
  const replaced = line.text.slice(0, tokenStart) + lower + line.text.slice(tokenStart + raw.length);
  const changed = new Map<number, string>([[fence.open, replaced]]);
  const text = rebuild(lines, changed);
  const caret = caretFor(snapshot, lines, changed);
  return { text, anchor: caret.anchor, head: caret.head };
}
