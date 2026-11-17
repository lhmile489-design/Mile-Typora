// Extended Markdown commands for P2 (M5-3): tables, footnotes, alerts, link
// references, a [TOC] marker, front matter, underline and comments. Pure
// transforms keep selection mapping testable; SourceEditor applies each as one
// undo step.

import type { ParagraphEdit, Snapshot } from "./paragraph";

export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";
export type TableAlign = "left" | "center" | "right";

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

function result(text: string, anchor: number, head = anchor): Snapshot {
  return { text, anchor, head };
}

function lineIndexAt(lines: Line[], position: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i]!.start) return i;
  }
  return 0;
}

/** blockRange is the blank-line separated block around position. */
function blockRange(lines: Line[], position: number): { first: number; last: number } {
  const index = lineIndexAt(lines, position);
  if (lines[index]!.text.trim() === "") return { first: index, last: index };
  let first = index;
  let last = index;
  while (first > 0 && lines[first - 1]!.text.trim() !== "") first--;
  while (last + 1 < lines.length && lines[last + 1]!.text.trim() !== "") last++;
  return { first, last };
}

function ensureBlankBefore(lines: string[], at: number): number {
  if (at <= 0) return at;
  if (lines[at - 1]!.trim() === "") return at;
  lines.splice(at, 0, "");
  return at + 1;
}

function ensureBlankAfter(lines: string[], end: number): void {
  if (end + 1 < lines.length && lines[end + 1]!.trim() !== "") lines.splice(end + 1, 0, "");
}

function splitCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") && !inner.endsWith("\\|") ? inner.slice(0, -1) : inner;
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < withoutEnd.length; i++) {
    if (withoutEnd[i] === "\\" && withoutEnd[i + 1] === "|") {
      current += "\\|";
      i++;
      continue;
    }
    if (withoutEnd[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += withoutEnd[i];
  }
  cells.push(current.trim());
  return cells;
}

function cellsOf(line: string): string[] {
  return splitCells(line);
}

function tableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function delimiter(line: string): boolean {
  if (!tableLine(line)) return false;
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

type TableInfo = {
  first: number;
  last: number;
  row: number;
  column: number;
  columns: number;
};

/** tableAt finds the pipe table around the cursor, or null. */
export function tableAt(snapshot: Snapshot): TableInfo | null {
  const lines = splitLines(snapshot.text);
  let index = lineIndexAt(lines, Math.min(snapshot.anchor, snapshot.head));
  if (!tableLine(lines[index]!.text)) return null;
  let first = index;
  let last = index;
  while (first > 0 && tableLine(lines[first - 1]!.text)) first--;
  while (last + 1 < lines.length && tableLine(lines[last + 1]!.text)) last++;
  if (last - first < 1 || !delimiter(lines[first + 1]!.text)) return null;
  const columns = cellsOf(lines[first]!.text).length;
  const offset = Math.min(snapshot.anchor, snapshot.head) - lines[index]!.start;
  const before = lines[index]!.text.slice(0, Math.max(0, offset));
  let column = 0;
  for (const char of before) if (char === "|") column++;
  column = Math.max(0, Math.min(column, columns - 1));
  return { first, last, row: index - first, column, columns };
}

function alignCell(align: TableAlign): string {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  return ":---";
}

/** insertTable inserts a GFM table with a header and rows-1 data rows. */
export function insertTable(snapshot: Snapshot, rows: number, columns: number): Snapshot {
  const count = Math.max(1, Math.min(columns, 20));
  const height = Math.max(1, Math.min(rows, 20));
  const header = `| ${Array.from({ length: count }, (_, i) => `列 ${i + 1}`).join(" | ")} |`;
  const divider = `| ${Array.from({ length: count }, () => "---").join(" | ")} |`;
  const empty = `| ${Array.from({ length: count }, () => " ").join(" | ")} |`;
  const table = [header, divider, ...Array.from({ length: Math.max(0, height - 1) }, () => empty)];
  const lines = splitLines(snapshot.text).map((line) => line.text);
  const at = ensureBlankBefore(lines, lineIndexAt(splitLines(snapshot.text), snapshot.anchor));
  lines.splice(at, 0, ...table);
  ensureBlankAfter(lines, at + table.length - 1);
  const text = lines.join("\n");
  const headerStart = lines.slice(0, at).join("\n").length + (at > 0 ? 1 : 0);
  const cell = header.indexOf("列 1") + 2;
  return result(text, headerStart + cell);
}

/** tableAddRow inserts a row above or below the current table row. */
export function tableAddRow(snapshot: Snapshot, where: "above" | "below"): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info) return null;
  const lines = splitLines(snapshot.text).map((line) => line.text);
  if (info.row < 2) return null; // header and delimiter rows have no data cells
  const at = where === "above" ? info.row : info.row + 1;
  lines.splice(info.first + at, 0, `| ${Array.from({ length: info.columns }, () => " ").join(" | ")} |`);
  return result(lines.join("\n"), snapshot.anchor);
}

/** tableAddColumn inserts a column left or right of the current one. */
export function tableAddColumn(snapshot: Snapshot, where: "left" | "right"): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info) return null;
  const lines = splitLines(snapshot.text).map((line) => line.text);
  const at = where === "left" ? info.column : info.column + 1;
  for (let i = info.first; i <= info.last; i++) {
    const cells = cellsOf(lines[i]!);
    const value = i === info.first + 1 ? "---" : " ";
    cells.splice(at, 0, value);
    lines[i] = `| ${cells.join(" | ")} |`;
  }
  return result(lines.join("\n"), snapshot.anchor);
}

/** tableDeleteRow removes the current data row. */
export function tableDeleteRow(snapshot: Snapshot): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info || info.row < 2) return null;
  const lines = splitLines(snapshot.text).map((line) => line.text);
  lines.splice(info.first + info.row, 1);
  return result(lines.join("\n"), snapshot.anchor);
}

/** tableDeleteColumn removes the current column, or the table if it is last. */
export function tableDeleteColumn(snapshot: Snapshot): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info) return null;
  if (info.columns <= 1) return tableDelete(snapshot);
  const lines = splitLines(snapshot.text).map((line) => line.text);
  for (let i = info.first; i <= info.last; i++) {
    const cells = cellsOf(lines[i]!);
    cells.splice(info.column, 1);
    lines[i] = `| ${cells.join(" | ")} |`;
  }
  return result(lines.join("\n"), snapshot.anchor);
}

/** tableDelete removes the whole table block. */
export function tableDelete(snapshot: Snapshot): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info) return null;
  const lines = splitLines(snapshot.text).map((line) => line.text);
  lines.splice(info.first, info.last - info.first + 1);
  return result(lines.join("\n"), Math.min(snapshot.anchor, lines.join("\n").length));
}

/** tableAlign rewrites the delimiter cell of the current column. */
export function tableAlign(snapshot: Snapshot, align: TableAlign): ParagraphEdit {
  const info = tableAt(snapshot);
  if (!info) return null;
  const lines = splitLines(snapshot.text).map((line) => line.text);
  const cells = cellsOf(lines[info.first + 1]!);
  cells[info.column] = alignCell(align);
  lines[info.first + 1] = `| ${cells.join(" | ")} |`;
  return result(lines.join("\n"), snapshot.anchor);
}

function nextFootnoteLabel(text: string): number {
  let n = 1;
  while (new RegExp(`\\[\\^${n}\\]`).test(text)) n++;
  return n;
}

/** insertFootnote inserts a reference and appends its definition. */
export function insertFootnote(snapshot: Snapshot): Snapshot {
  const label = nextFootnoteLabel(snapshot.text);
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  const reference = `[^${label}]`;
  let text = snapshot.text.slice(0, from) + reference + snapshot.text.slice(to);
  if (!text.endsWith("\n")) text += "\n";
  if (!text.endsWith("\n\n")) text += "\n";
  const definition = `[^${label}]: `;
  text += definition;
  return result(text, text.length);
}

function blockLines(snapshot: Snapshot): { lines: string[]; first: number; last: number } {
  const lines = splitLines(snapshot.text);
  const range = blockRange(lines, Math.min(snapshot.anchor, snapshot.head));
  return { lines: lines.map((line) => line.text), first: range.first, last: range.last };
}

/** insertAlert wraps the current block in a GFM alert. */
export function insertAlert(snapshot: Snapshot, type: AlertType): Snapshot {
  const { lines, first, last } = blockLines(snapshot);
  const content = lines.slice(first, last + 1).filter((line, index, all) => !(index === 0 && line.trim() === ""));
  const quoted = content.map((line) => (line.trim() === "" ? ">" : line.startsWith(">") ? line : `> ${line}`));
  lines.splice(first, last - first + 1, `> [!${type}]`, ...quoted);
  return result(lines.join("\n"), snapshot.anchor);
}

/** insertLinkReference replaces the selection with a reference link and adds its definition. */
export function insertLinkReference(snapshot: Snapshot): Snapshot {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  const selected = snapshot.text.slice(from, to) || "链接文字";
  let label = 1;
  while (snapshot.text.includes(`[ref-${label}]:`)) label++;
  const reference = `[${selected}][ref-${label}]`;
  let text = snapshot.text.slice(0, from) + reference + snapshot.text.slice(to);
  if (!text.endsWith("\n")) text += "\n";
  if (!text.endsWith("\n\n")) text += "\n";
  const definition = `[ref-${label}]: https://`;
  text += definition;
  return result(text, text.length);
}

/** insertTOC inserts a [TOC] marker on its own block. */
export function insertTOC(snapshot: Snapshot): Snapshot {
  const lines = splitLines(snapshot.text).map((line) => line.text);
  const at = ensureBlankBefore(lines, lineIndexAt(splitLines(snapshot.text), snapshot.anchor));
  lines.splice(at, 0, "[TOC]");
  ensureBlankAfter(lines, at);
  return result(lines.join("\n"), snapshot.anchor);
}

/** insertFrontMatter inserts a YAML front matter block at the top. */
export function insertFrontMatter(snapshot: Snapshot): Snapshot {
  if (/^---\r?\n/.test(snapshot.text)) {
    const end = snapshot.text.indexOf("\n---");
    return result(snapshot.text, end >= 0 ? end + 5 : 0);
  }
  const prefix = "---\ntitle: \n---\n\n";
  const text = prefix + snapshot.text;
  return result(text, "---\ntitle: ".length);
}

/** toggleUnderline wraps or unwraps the selection with the Typora <u> tag. */
export function toggleUnderline(snapshot: Snapshot): Snapshot {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  const selected = snapshot.text.slice(from, to);
  const around = snapshot.text.slice(Math.max(0, from - 3), to + 4);
  if (selected && around.startsWith("<u>") && around.endsWith("</u>")) {
    const text = snapshot.text.slice(0, from - 3) + selected + snapshot.text.slice(to + 4);
    return result(text, from - 3, to - 3);
  }
  const text = snapshot.text.slice(0, from) + `<u>${selected}</u>` + snapshot.text.slice(to);
  return result(text, from + 3, to + 3);
}

/** insertComment wraps or inserts an HTML comment. */
export function insertComment(snapshot: Snapshot): Snapshot {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  const selected = snapshot.text.slice(from, to);
  const text = snapshot.text.slice(0, from) + `<!-- ${selected} -->` + snapshot.text.slice(to);
  return result(text, from + 5, from + 5 + selected.length);
}
