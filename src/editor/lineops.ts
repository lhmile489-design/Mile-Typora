// Selection, line movement and forward deletion for the source editor
// (P1 EDIT-12/13/14/15). The editor applies these results as one transaction.

import type { ParagraphEdit, Snapshot } from "./paragraph";

type LineInfo = { start: number; end: number; text: string };

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

function lineIndexAt(lines: LineInfo[], position: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i]!.start) return i;
  }
  return 0;
}

function selectionLines(snapshot: Snapshot): { lines: LineInfo[]; first: number; last: number } {
  const lines = splitLines(snapshot.text);
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  const first = lineIndexAt(lines, from);
  let last = lineIndexAt(lines, to);
  if (to > from && last > first && to === lines[last]!.start) last--;
  return { lines, first, last };
}

/** selectLine selects the line containing the cursor. */
export function selectLine(snapshot: Snapshot): Snapshot {
  const { lines, first } = selectionLines(snapshot);
  const line = lines[first]!;
  return { text: snapshot.text, anchor: line.start, head: line.end };
}

/** selectParagraph selects the blank-line separated block around the cursor. */
export function selectParagraph(snapshot: Snapshot): Snapshot {
  const { lines, first } = selectionLines(snapshot);
  if (lines[first]!.text.trim() === "") {
    return { text: snapshot.text, anchor: lines[first]!.start, head: lines[first]!.end };
  }
  let start = first;
  let end = first;
  while (start > 0 && lines[start - 1]!.text.trim() !== "") start--;
  while (end + 1 < lines.length && lines[end + 1]!.text.trim() !== "") end++;
  return { text: snapshot.text, anchor: lines[start]!.start, head: lines[end]!.end };
}

/** moveLines moves the selected line block one line up or down. */
export function moveLines(snapshot: Snapshot, direction: "up" | "down"): ParagraphEdit {
  const { lines, first, last } = selectionLines(snapshot);
  const contentEnd = lines.length > 0 && lines[lines.length - 1]!.text === "" ? lines.length - 1 : lines.length;
  if (first >= contentEnd) return null;
  if (direction === "up" && first === 0) return null;
  if (direction === "down" && last >= contentEnd - 1) return null;

  const texts = lines.map((line) => line.text);
  const block = texts.splice(first, last - first + 1);
  const at = direction === "up" ? first - 1 : first + 1;
  texts.splice(at, 0, ...block);
  const text = texts.join("\n");
  if (text === snapshot.text) return null;

  const next = splitLines(text);
  const nextFirst = direction === "up" ? first - 1 : first + 1;
  if (snapshot.anchor === snapshot.head) {
    const column = snapshot.anchor - lines[first]!.start;
    const target = next[nextFirst]!;
    let offset = Math.min(column, target.text.length);
    if (offset > 0 && offset < target.text.length) {
      const code = target.text.charCodeAt(offset);
      if (code >= 0xdc00 && code <= 0xdfff) offset--;
    }
    const position = target.start + offset;
    return { text, anchor: position, head: position };
  }
  return {
    text,
    anchor: next[nextFirst]!.start,
    head: next[nextFirst + last - first]!.end,
  };
}

/** deleteForward removes the selection, or the next character / line break. */
export function deleteForward(snapshot: Snapshot): ParagraphEdit {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  if (from !== to) {
    const text = snapshot.text.slice(0, from) + snapshot.text.slice(to);
    return { text, anchor: from, head: from };
  }
  if (from >= snapshot.text.length) return null;
  const width = (snapshot.text.codePointAt(from) ?? 0) > 0xffff ? 2 : 1;
  const text = snapshot.text.slice(0, from) + snapshot.text.slice(from + width);
  return { text, anchor: from, head: from };
}
