// Paragraph-level Markdown commands (P1 PARA-01..07, 10..17, 20).
//
// The editor buffer is plain LF text. These transforms operate on lines and
// only rewrite block prefixes; the body text is carried through untouched.
// Keeping them pure makes the selection mapping and every edge case testable
// without a DOM, while the editor applies the result as one change.

export type Snapshot = {
  text: string;
  anchor: number;
  head: number;
};

export type ParagraphEdit = Snapshot | null;

export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ListKind = "ordered" | "unordered" | "task";

type LineInfo = {
  start: number;
  end: number;
  text: string;
};

type Block = {
  indent: string;
  quote: string;
  innerIndent: string;
  marker: string;
  heading: string;
  content: string;
  closing: string;
  prefix: string;
  prefixLength: number;
  listKind: ListKind | null;
  checked: boolean;
  bullet: string;
  headingLevel: HeadingLevel;
};

type PrefixChange = {
  index: number;
  prefix: string;
  /** Prefix length in the old line, for mapping the selection. */
  oldPrefix: number;
  /** Content used by the new line; defaults to the parsed content. */
  content?: string;
  /** Closing heading hashes; undefined preserves them. */
  suffix?: string;
};

const HEADING = /^(#{1,6})(?:[ \t]+|$)/;
const TASK = /^([-+*])(?:[ \t]+)\[([ xX])\](?:[ \t]+|$)/;
const UNORDERED = /^([-+*])(?:[ \t]+|$)/;
const ORDERED = /^(\d{1,9})([.)])(?:[ \t]+|$)/;

/** splitLines keeps offsets so a transform can rebuild the document. */
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

/** parseBlock splits a line into indent, quote, list, heading and content. */
function parseBlock(line: string): Block {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  let index = indent.length;

  let quote = "";
  while (line[index] === ">") {
    quote += ">";
    index++;
    if (line[index] === " ") {
      quote += " ";
      index++;
    }
  }

  const innerIndent = /^[ 	]*/.exec(line.slice(index))?.[0] ?? "";
  index += innerIndent.length;

  let marker = "";
  let listKind: ListKind | null = null;
  let checked = false;
  let bullet = "-";
  const tail = line.slice(index);
  const task = TASK.exec(tail);
  if (task) {
    marker = task[0];
    listKind = "task";
    checked = task[2] !== " ";
    bullet = task[1] ?? "-";
    index += marker.length;
  } else {
    const unordered = UNORDERED.exec(tail);
    const ordered = ORDERED.exec(tail);
    if (unordered) {
      marker = unordered[0];
      listKind = "unordered";
      bullet = unordered[1] ?? "-";
      index += marker.length;
    } else if (ordered) {
      marker = ordered[0];
      listKind = "ordered";
      index += marker.length;
    }
  }

  let heading = "";
  let headingLevel: HeadingLevel = 0;
  const head = HEADING.exec(line.slice(index));
  if (head) {
    heading = head[0];
    headingLevel = (head[1]?.length ?? 0) as HeadingLevel;
    index += heading.length;
  }

  const raw = line.slice(index);
  let content = raw;
  let closing = "";
  if (head) {
    const close = /[ \t]+#+[ \t]*$/.exec(raw);
    if (close) {
      closing = close[0];
      content = raw.slice(0, close.index);
    }
  }
  const prefix = line.slice(0, index);

  return {
    indent,
    quote,
    innerIndent,
    marker,
    heading,
    content,
    closing,
    prefix,
    prefixLength: prefix.length,
    listKind,
    checked,
    bullet,
    headingLevel,
  };
}

type ProtectedRange = { start: number; end: number; kind: "front" | "fence" | "math" | "rule" | "code" };

/** indentColumns counts a tab as the next 4-column stop. */
function indentColumns(text: string): number {
  let columns = 0;
  for (const char of text) {
    if (char === " ") columns++;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/**
 * indentedCode detects literal code. A 4-space list-looking line is code
 * unless an ancestor list item above it makes it a nested list.
 */
function indentedCode(lines: LineInfo[], index: number, block: Block): boolean {
  const inner = /^[ \t]*/.exec(block.content)?.[0] ?? "";
  const quoteSpace = block.quote.endsWith(" ") ? 1 : 0;
  if (indentColumns(block.indent) + quoteSpace + indentColumns(block.innerIndent) + indentColumns(inner) < 4) return false;
  if (block.marker !== "") {
    for (let i = index - 1; i >= 0; i--) {
      if (lines[i]!.text.trim() === "") continue;
      const previous = parseBlock(lines[i]!.text);
      if (previous.listKind !== null && indentColumns(previous.indent) < indentColumns(block.indent)) return false;
      break;
    }
  }
  return true;
}

/** protectedRanges covers front matter, fenced code, math and thematic breaks. */
function protectedRanges(lines: LineInfo[]): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  let scanFrom = 0;
  if (lines[0]?.text.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      const text = lines[i]!.text.trim();
      if (text === "---" || text === "...") {
        ranges.push({ start: 0, end: i, kind: "front" });
        scanFrom = i + 1;
        break;
      }
    }
  }

  let fence: { start: number; char: string; length: number } | null = null;
  let mathStart = -1;
  for (let i = scanFrom; i < lines.length; i++) {
    const block = parseBlock(lines[i]!.text);
    const content = block.content.trim();
    const indented = indentedCode(lines, i, block);
    if (fence) {
      const close = indented ? null : /^(`{3,}|~{3,})[ \t]*$/.exec(content);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        ranges.push({ start: fence.start, end: i, kind: "fence" });
        fence = null;
      }
      continue;
    }
    if (mathStart >= 0) {
      if (!indented && content === "$$") {
        ranges.push({ start: mathStart, end: i, kind: "math" });
        mathStart = -1;
      }
      continue;
    }
    if (indented) {
      const previous = ranges[ranges.length - 1];
      if (previous?.kind === "code" && previous.end === i - 1) previous.end = i;
      else ranges.push({ start: i, end: i, kind: "code" });
      continue;
    }
    const open = /^(`{3,}|~{3,})(.*)$/.exec(content);
    if (open && (open[1]![0] === "~" || !open[2]!.includes("`"))) {
      fence = { start: i, char: open[1]![0]!, length: open[1]!.length };
      continue;
    }
    if (content === "$$") {
      mathStart = i;
      continue;
    }
    if (/^\$\$.+\$\$$/.test(content)) {
      ranges.push({ start: i, end: i, kind: "math" });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(content)) ranges.push({ start: i, end: i, kind: "rule" });
    else if (i > 0 && setextLevel(lines, i - 1) !== null) ranges.push({ start: i, end: i, kind: "rule" });
  }
  if (fence) ranges.push({ start: fence.start, end: lines.length - 1, kind: "fence" });
  if (mathStart >= 0) ranges.push({ start: mathStart, end: lines.length - 1, kind: "math" });
  return ranges;
}

/** fencedLines marks structural lines whose text commands must not rewrite. */
function fencedLines(lines: LineInfo[]): Set<number> {
  const protectedLines = new Set<number>();
  for (const range of protectedRanges(lines)) {
    for (let i = range.start; i <= range.end; i++) protectedLines.add(i);
  }
  return protectedLines;
}

function lineIndexAt(lines: LineInfo[], position: number): number {
  if (position <= 0) return 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i]!.start) return i;
  }
  return 0;
}

/** selectedLines returns the inclusive line range a selection touches. */
function selectedLines(text: string, anchor: number, head: number): { lines: LineInfo[]; first: number; last: number } {
  const lines = splitLines(text);
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const first = lineIndexAt(lines, from);
  let last = lineIndexAt(lines, to);
  if (to > from && last > first && to === lines[last]!.start) last--;
  return { lines, first, last };
}

/**
 * mapPosition maps a position through prefix-only line rewrites and removed
 * setext underline lines. A collapsed cursor in the old prefix moves to the
 * end of the new prefix.
 */
function mapPosition(
  position: number,
  lines: LineInfo[],
  nextLines: LineInfo[],
  changes: Map<number, PrefixChange>,
  oldToNew: number[],
  cursor: boolean,
): number {
  const index = lineIndexAt(lines, position);
  const target = oldToNew[index]!;
  if (target < 0) {
    for (let i = index - 1; i >= 0; i--) {
      const kept = oldToNew[i]!;
      if (kept >= 0) {
        const line = nextLines[kept]!;
        return line.start + line.text.length;
      }
    }
    for (let i = index + 1; i < oldToNew.length; i++) {
      const kept = oldToNew[i]!;
      if (kept >= 0) return nextLines[kept]!.start;
    }
    return 0;
  }
  const line = lines[index]!;
  const offset = position - line.start;
  const change = changes.get(index);
  if (!change) {
    const next = nextLines[target]!;
    return Math.min(next.start + offset, next.start + next.text.length);
  }
  let nextOffset: number;
  if (offset < change.oldPrefix) {
    nextOffset = cursor ? change.prefix.length : Math.min(offset, change.prefix.length);
  } else {
    nextOffset = change.prefix.length + (offset - change.oldPrefix);
  }
  const next = nextLines[target]!;
  return Math.min(next.start + nextOffset, next.start + next.text.length);
}

/** rewrite applies prefix changes and removed lines as one document edit. */
function rewrite(
  snapshot: Snapshot,
  changes: Map<number, PrefixChange>,
  removed: Set<number> = new Set(),
): ParagraphEdit {
  if (changes.size === 0 && removed.size === 0) return null;
  const { lines } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  const nextTexts: string[] = [];
  const oldToNew = new Array<number>(lines.length).fill(-1);
  lines.forEach((line, index) => {
    if (removed.has(index)) return;
    oldToNew[index] = nextTexts.length;
    const change = changes.get(index);
    if (!change) {
      nextTexts.push(line.text);
      return;
    }
    const block = parseBlock(line.text);
    const suffix = change.suffix ?? (change.content !== undefined ? "" : block.closing);
    nextTexts.push(change.prefix + (change.content ?? block.content) + suffix);
  });
  const text = nextTexts.join("\n");
  if (text === snapshot.text) return null;

  const nextLines = splitLines(text);
  const cursor = snapshot.anchor === snapshot.head;
  const anchor = mapPosition(snapshot.anchor, lines, nextLines, changes, oldToNew, cursor);
  const head = mapPosition(snapshot.head, lines, nextLines, changes, oldToNew, cursor);
  return { text, anchor, head };
}

/** setextLevel reports a one-line setext title followed by its underline. */
function setextLevel(lines: LineInfo[], index: number): 1 | 2 | null {
  const title = lines[index];
  const underline = lines[index + 1];
  if (!title || !underline) return null;
  const block = parseBlock(title.text);
  if (block.quote !== "" || block.marker !== "" || block.heading !== "" || block.content === "") return null;
  const match = /^[ \t]{0,3}(=+|-+)[ \t]*$/.exec(underline.text);
  if (!match) return null;
  return match[1]![0] === "=" ? 1 : 2;
}

type TransformOptions = {
  /** Skip blank lines (line has no text at all). */
  nonEmpty?: boolean;
  /** Convert setext headings to ATX, or strip the underline at level 0. */
  setext?: "convert" | "strip";
  /** Drop a heading's closing hashes when the heading marker is rewritten. */
  dropSuffix?: boolean;
};

/** transformPrefixes rewrites selected lines that pass the filter. */
function transformPrefixes(
  snapshot: Snapshot,
  build: (block: Block, line: LineInfo, index: number, setext: 1 | 2 | null) => string | null,
  options: TransformOptions = {},
): ParagraphEdit {
  const selected = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  const lines = selected.lines;
  let { first, last } = selected;
  if (options.setext && snapshot.anchor === snapshot.head && first === last && first > 0 && setextLevel(lines, first - 1) !== null) {
    first = last = first - 1;
  }
  const fenced = fencedLines(lines);
  const changes = new Map<number, PrefixChange>();
  const removed = new Set<number>();
  for (let i = first; i <= last; i++) {
    if (fenced.has(i) || removed.has(i)) continue;
    const block = parseBlock(lines[i]!.text);
    const blankMarker = snapshot.anchor === snapshot.head && first === last;
    if (options.nonEmpty && block.content === "" && !blankMarker) continue;
    const setext = options.setext ? setextLevel(lines, i) : null;
    const prefix = build(block, lines[i]!, i, setext);
    const suffix = options.dropSuffix ? "" : undefined;
    if (prefix === null) {
      if (options.setext === "strip" && setext !== null) {
        changes.set(i, { index: i, prefix: block.prefix, oldPrefix: block.prefixLength, suffix });
        removed.add(i + 1);
      }
      continue;
    }
    if (prefix === block.prefix) {
      if (options.setext === "strip" && setext !== null) {
        changes.set(i, { index: i, prefix, oldPrefix: block.prefixLength, suffix });
        removed.add(i + 1);
      }
      continue;
    }
    changes.set(i, { index: i, prefix, oldPrefix: block.prefixLength, suffix });
    if (options.setext && setext !== null) removed.add(i + 1);
  }
  return rewrite(snapshot, changes, removed);
}

function headingPrefix(level: HeadingLevel): string {
  return level === 0 ? "" : `${"#".repeat(level)} `;
}

/** setHeading converts each selected line to a heading, or to a paragraph at 0. */
export function setHeading(snapshot: Snapshot, level: HeadingLevel): ParagraphEdit {
  return transformPrefixes(
    snapshot,
    (block) => {
      if (level === 0) {
        if (!block.quote && !block.marker && !block.heading) return null;
        const indent = block.marker ? "" : block.indent + block.innerIndent;
        return indent;
      }
      return block.indent + block.quote + block.innerIndent + headingPrefix(level);
    },
    { nonEmpty: true, setext: level === 0 ? "strip" : "convert", dropSuffix: true },
  );
}

/**
 * shiftHeading promotes (toward 1) or demotes (toward 6) each heading. A
 * plain paragraph becomes level 1 when promoted; demoting it is a no-op.
 */
export function shiftHeading(snapshot: Snapshot, direction: "promote" | "demote"): ParagraphEdit {
  return transformPrefixes(
    snapshot,
    (block, _line, _index, setext) => {
      const current = setext ?? block.headingLevel;
      if (current === 0) return null;
      const level = direction === "promote"
        ? Math.max(1, current - 1) as HeadingLevel
        : Math.min(6, current + 1) as HeadingLevel;
      if (level === current && setext === null) return null;
      if (level === current) return null;
      return block.indent + block.quote + block.innerIndent + headingPrefix(level);
    },
    { nonEmpty: true, setext: "convert", dropSuffix: true },
  );
}

/** toggleQuote adds one quote level to unquoted lines, or removes all quotes. */
export function toggleQuote(snapshot: Snapshot): ParagraphEdit {
  const { lines, first, last } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  const fenced = fencedLines(lines);
  const selected = [];
  for (let i = first; i <= last; i++) {
    if (!fenced.has(i) && setextLevel(lines, i) === null) selected.push({ index: i, block: parseBlock(lines[i]!.text) });
  }
  if (selected.length === 0) return null;
  const remove = selected.every(({ block }) => block.quote !== "");
  const changes = new Map<number, PrefixChange>();
  for (const { index, block } of selected) {
    if (remove) {
      const prefix = block.indent + block.innerIndent + block.marker + block.heading;
      if (prefix !== block.prefix) {
        changes.set(index, { index, prefix, oldPrefix: block.prefixLength });
      }
    } else if (block.quote === "") {
      const quote = block.content === "" && block.marker === "" && block.heading === "" ? ">" : "> ";
      changes.set(index, {
        index,
        prefix: block.indent + quote + block.innerIndent + block.marker + block.heading,
        oldPrefix: block.prefixLength,
      });
    }
  }
  return rewrite(snapshot, changes);
}

/** toggleList converts selected lines to a list, or toggles that list off. */
export function toggleList(snapshot: Snapshot, kind: ListKind): ParagraphEdit {
  const { lines, first, last } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  const fenced = fencedLines(lines);
  const selected: { index: number; block: Block }[] = [];
  const blankMarker = snapshot.anchor === snapshot.head && first === last;
  for (let i = first; i <= last; i++) {
    if (fenced.has(i) || setextLevel(lines, i) !== null) continue;
    const block = parseBlock(lines[i]!.text);
    if (block.content === "" && block.listKind === null && !blankMarker) continue;
    selected.push({ index: i, block });
  }
  if (selected.length === 0) return null;

  const matches = (block: Block) =>
    kind === "ordered" ? block.listKind === "ordered" : kind === "unordered" ? block.listKind === "unordered" : block.listKind === "task";
  if (selected.every(({ block }) => matches(block))) {
    const changes = new Map<number, PrefixChange>();
    for (const { index, block } of selected) {
      const marker = kind === "task" ? `${block.bullet} ` : "";
      changes.set(index, {
        index,
        prefix: block.indent + block.quote + block.innerIndent + marker + block.heading,
        oldPrefix: block.prefixLength,
        suffix: block.heading ? undefined : "",
      });
    }
    return rewrite(snapshot, changes);
  }

  const changes = new Map<number, PrefixChange>();
  let number = 1;
  let lastSelected = -2;
  for (const { index, block } of selected) {
    const freshRun = index !== lastSelected + 1;
    if (freshRun) number = orderedStart(lines, index, block);
    if (freshRun) {
      const existing = orderedNumber(block);
      if (existing !== null) number = existing;
    }
    let marker: string;
    if (kind === "ordered") marker = `${number}. `;
    else if (kind === "task") marker = block.listKind === "task" ? block.marker : "- [ ] ";
    else marker = "- ";
    const heading = block.marker ? block.heading : "";
    changes.set(index, {
      index,
      prefix: block.indent + block.quote + block.innerIndent + marker + heading,
      oldPrefix: block.prefixLength,
      suffix: heading ? undefined : "",
    });
    lastSelected = index;
    number++;
  }
  return rewrite(snapshot, changes);
}

/** orderedNumber reads an ordered marker's number, or null. */
function orderedNumber(block: Block): number | null {
  const match = /^(\d+)/.exec(block.marker);
  return match ? Number(match[1]) : null;
}

/** orderedStart continues an adjacent ordered list instead of restarting at 1. */
function orderedStart(lines: LineInfo[], index: number, block: Block): number {
  for (let i = index - 1; i >= 0; i--) {
    const previous = parseBlock(lines[i]!.text);
    if (previous.content === "" || previous.indent !== block.indent || previous.innerIndent !== block.innerIndent || previous.quote !== block.quote) break;
    const value = orderedNumber(previous);
    if (value !== null) return value + 1;
    break;
  }
  return 1;
}

/** setTaskStatus checks or unchecks every task item in the selection. */
export function setTaskStatus(snapshot: Snapshot, checked: boolean): ParagraphEdit {
  return transformPrefixes(snapshot, (block) => {
    if (block.listKind !== "task") return null;
    const marker = `${block.bullet} ${checked ? "[x]" : "[ ]"} `;
    return block.indent + block.quote + block.innerIndent + marker + block.heading;
  });
}

/** detectIndentWidth reads the document's convention: 2 spaces unless it clearly uses 4. */
function detectIndentWidth(text: string): 2 | 4 {
  let saw = false;
  const lines = splitLines(text);
  for (const line of lines) {
    const block = parseBlock(line.text);
    const indent = block.quote ? block.innerIndent : block.indent;
    if (!block.listKind || indent === "") continue;
    const width = indent.length;
    if (width % 4 !== 0) return 2;
    saw = true;
  }
  return saw ? 4 : 2;
}

/** indentList adds or removes one nesting level on selected list items. */
export function indentList(snapshot: Snapshot, direction: "in" | "out", width?: 2 | 4): ParagraphEdit {
  const step = width ?? detectIndentWidth(snapshot.text);
  return transformPrefixes(snapshot, (block) => {
    if (!block.listKind) return null;
    let indent = block.quote ? block.innerIndent : block.indent;
    if (direction === "in") {
      indent += " ".repeat(step);
    } else {
      if (indent === "") return null;
      indent = indent.slice(0, Math.max(0, indent.length - step));
    }
    const prefix = block.quote
      ? block.indent + block.quote + indent + block.marker + block.heading
      : indent + block.marker + block.heading;
    return prefix;
  });
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const value of text) {
    if (value === char) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * insertFence wraps the selected block, or the current line, in a formula or
 * fenced code block. The cursor lands on the body's last line.
 */
export function insertFence(snapshot: Snapshot, kind: "formula" | "code", language = ""): ParagraphEdit {
  const { lines } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  let { first, last } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  if (snapshot.anchor === snapshot.head && first > 0 && setextLevel(lines, first - 1) !== null) {
    first = first - 1;
  }
  if (first === last && setextLevel(lines, first) !== null && last + 1 < lines.length) last++;
  const ranges = protectedRanges(lines);
  if (ranges.some((range) => range.kind !== "rule" && range.start <= last && range.end >= first)) return null;

  const from = lines[first]!.start;
  const to = lines[last]!.end;
  const body = lines.slice(first, last + 1).map((line) => line.text).join("\n");

  const fence = kind === "formula" ? "$$" : "`".repeat(Math.max(3, longestRun(body, "`") + 1));
  const open = kind === "code" ? fence + language.trim() : fence;
  const block = `${open}\n${body}\n${fence}`;
  const text = snapshot.text.slice(0, from) + block + snapshot.text.slice(to);
  const cursor = from + open.length + 1 + body.length;
  return { text, anchor: cursor, head: cursor };
}

/** insertHorizontalRule adds a thematic break as its own block. */
export function insertHorizontalRule(snapshot: Snapshot): ParagraphEdit {
  const { lines, first } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  let target = first;
  if (first > 0 && setextLevel(lines, first - 1) !== null) target = first - 1;
  const line = lines[target]!;
  const fenced = fencedLines(lines);
  if (fenced.has(target)) return null;
  const setext = setextLevel(lines, target);
  const after = setext !== null ? lines[target + 1]! : line;
  if (after.text.trim() === "" && setext === null) {
    if (snapshot.text === "") return { text: "---", anchor: 3, head: 3 };
    const insert = "\n---\n";
    const text = snapshot.text.slice(0, after.start) + insert + snapshot.text.slice(after.start);
    return { text, anchor: after.start + insert.length, head: after.start + insert.length };
  }
  const insert = "\n\n---\n";
  const text = snapshot.text.slice(0, after.end) + insert + snapshot.text.slice(after.end);
  const cursor = after.end + insert.length;
  return { text, anchor: cursor, head: cursor };
}

/** insertParagraph creates an empty paragraph above or below the current block. */
export function insertParagraph(snapshot: Snapshot, where: "above" | "below"): ParagraphEdit {
  if (snapshot.text === "") return null;
  const { lines, first } = selectedLines(snapshot.text, snapshot.anchor, snapshot.head);
  let target = first;
  if (first > 0 && setextLevel(lines, first - 1) !== null) target = first - 1;
  const range = protectedRanges(lines).find((item) => target >= item.start && target <= item.end);
  if (range?.kind === "front" && where === "above") return null;
  let line;
  if (range) line = lines[where === "above" ? range.start : range.end]!;
  else if (where === "below" && setextLevel(lines, target) !== null) line = lines[target + 1]!;
  else line = lines[target]!;
  if (where === "above") {
    const text = snapshot.text.slice(0, line.start) + "\n\n" + snapshot.text.slice(line.start);
    return { text, anchor: line.start, head: line.start };
  }
  const text = snapshot.text.slice(0, line.end) + "\n\n" + snapshot.text.slice(line.end);
  return { text, anchor: line.end + 2, head: line.end + 2 };
}
