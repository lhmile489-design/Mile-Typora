// M5-8 editing aids. Every command is a pure snapshot transform so the
// editor can apply it as one undo step and return null when nothing changes.

import type { ParagraphEdit, Snapshot } from "./paragraph";
import { protectedLineSet } from "./paragraph";

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

function result(text: string, anchor: number, head = anchor): Snapshot {
  return { text, anchor, head };
}

function isCJK(rune: string): boolean {
  const code = rune.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

function isWordRune(rune: string): boolean {
  return /[\p{L}\p{N}_]/u.test(rune);
}

/** deleteWord deletes the selection, or the word/CJK character before the caret. */
export function deleteWord(snapshot: Snapshot): ParagraphEdit {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  if (from !== to) {
    return result(snapshot.text.slice(0, from) + snapshot.text.slice(to), from);
  }
  if (from === 0) return null;
  const before = Array.from(snapshot.text.slice(0, from));
  let index = before.length;
  while (index > 0 && /\s/u.test(before[index - 1]!)) index--;
  if (index === 0) return null;
  const head = before[index - 1]!;
  let start = index - 1;
  if (isCJK(head)) {
    // One CJK character is one word.
  } else if (isWordRune(head)) {
    while (start > 0 && isWordRune(before[start - 1]!) && !isCJK(before[start - 1]!)) start--;
  }
  const charOffset = before.slice(0, start).join("").length;
  return result(snapshot.text.slice(0, charOffset) + snapshot.text.slice(from), charOffset);
}

/** deleteLine removes the caret line and its newline, never past the end. */
export function deleteLine(snapshot: Snapshot): ParagraphEdit {
  const lines = splitLines(snapshot.text);
  if (lines.length === 0) return null;
  const index = lineIndexAt(lines, Math.min(snapshot.anchor, snapshot.head));
  const line = lines[index]!;
  let start = line.start;
  let end = line.end;
  if (end < snapshot.text.length) {
    end += 1; // trailing newline
  } else if (start > 0) {
    start -= 1; // last line: remove its preceding newline instead
  }
  if (start === end) return null;
  return result(snapshot.text.slice(0, start) + snapshot.text.slice(end), start);
}

/** deleteParagraph removes the blank-line-delimited block and one separator. */
export function deleteParagraph(snapshot: Snapshot): ParagraphEdit {
  const lines = splitLines(snapshot.text);
  if (lines.length === 0) return null;
  const index = lineIndexAt(lines, Math.min(snapshot.anchor, snapshot.head));
  if (lines[index]!.text.trim() === "") {
    return deleteLine(snapshot);
  }
  let first = index;
  let last = index;
  while (first > 0 && lines[first - 1]!.text.trim() !== "") first--;
  while (last + 1 < lines.length && lines[last + 1]!.text.trim() !== "") last++;
  let start = lines[first]!.start;
  let end = lines[last]!.end;
  const next = lines[last + 1];
  const previous = lines[first - 1];
  if (next && next.text.trim() === "") {
    end = next.end;
    if (last + 1 < lines.length - 1) end += 1;
  } else if (previous && previous.text.trim() === "") {
    start = previous.start;
  }
  if (start === end) return null;
  return result(snapshot.text.slice(0, start) + snapshot.text.slice(end), start);
}

/**
 * trimTrailingWhitespace trims line ends except protected code/math blocks,
 * keeping exactly two spaces for Markdown hard breaks and leaving lines that
 * end in a backslash hard break alone.
 */
export function trimTrailingWhitespace(snapshot: Snapshot): ParagraphEdit {
  const lines = splitLines(snapshot.text);
  const protectedLines = protectedLineSet(snapshot.text);
  let changed = false;
  const next = lines.map((line, index) => {
    if (protectedLines.has(index)) return line.text;
    const trimmed = line.text.trimEnd();
    if (/\\$/.test(trimmed)) {
      // A backslash hard break needs no trailing spaces; keep the slash.
      if (trimmed !== line.text) changed = true;
      return trimmed;
    }
    const match = /([ \t]+)$/.exec(line.text);
    if (!match) return line.text;
    changed = true;
    const spaces = match[1]!;
    const hardBreak = spaces.length >= 2 && /^ +$/.test(spaces);
    return line.text.slice(0, line.text.length - spaces.length) + (hardBreak ? "  " : "");
  });
  if (!changed) return null;
  const text = next.join("\n");
  const anchor = Math.min(snapshot.anchor, text.length);
  const head = Math.min(snapshot.head, text.length);
  return result(text, anchor, head);
}

/** ensureFinalNewline leaves exactly one newline at the end of a non-empty file. */
export function ensureFinalNewline(snapshot: Snapshot): ParagraphEdit {
  if (snapshot.text === "") return null;
  const text = snapshot.text.replace(/\n+$/, "") + "\n";
  if (text === snapshot.text) return null;
  const anchor = Math.min(snapshot.anchor, text.length);
  const head = Math.min(snapshot.head, text.length);
  return result(text, anchor, head);
}
