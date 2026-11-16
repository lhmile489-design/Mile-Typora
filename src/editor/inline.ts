// Inline formatting commands (P1 FORMAT-01/02/04/05/07/10).
//
// These transforms only touch the selected text and its immediate markers.
// They are pure so the selection behaviour is testable without a DOM; the
// editor applies the result as one transaction.

import type { ParagraphEdit, Snapshot } from "./paragraph";

export type InlineFormat = "bold" | "italic" | "strikethrough" | "code";

export type InlineEdit = ParagraphEdit;

type Selection = { text: string; from: number; to: number; selected: string };

function selectionOf(snapshot: Snapshot): Selection {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  return { text: snapshot.text, from, to, selected: snapshot.text.slice(from, to) };
}

function result(text: string, from: number, to: number): Snapshot {
  return { text, anchor: from, head: to };
}

function leadingRun(text: string, char: string): number {
  let count = 0;
  for (const value of text) {
    if (value !== char) break;
    count++;
  }
  return count;
}

function trailingRun(text: string, char: string): number {
  let count = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== char) break;
    count++;
  }
  return count;
}

type MarkerPair = { openStart: number; openEnd: number; closeStart: number; closeEnd: number };

function markerPairs(text: string, marker: string): MarkerPair[] {
  const positions: number[] = [];
  let index = text.indexOf(marker);
  while (index >= 0) {
    positions.push(index);
    index = text.indexOf(marker, index + marker.length);
  }
  const pairs: MarkerPair[] = [];
  for (let i = 0; i + 1 < positions.length; i += 2) {
    pairs.push({
      openStart: positions[i]!,
      openEnd: positions[i]! + marker.length,
      closeStart: positions[i + 1]!,
      closeEnd: positions[i + 1]! + marker.length,
    });
  }
  return pairs;
}

/** singleAsteriskPairs pairs only lone `*` markers, not bold runs. */
function singleMarkerPairs(text: string, char: string): MarkerPair[] {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== char) continue;
    if (text[i - 1] === char || text[i + 1] === char) continue;
    positions.push(i);
  }
  const pairs: MarkerPair[] = [];
  for (let i = 0; i + 1 < positions.length; i += 2) {
    pairs.push({
      openStart: positions[i]!,
      openEnd: positions[i]! + 1,
      closeStart: positions[i + 1]!,
      closeEnd: positions[i + 1]! + 1,
    });
  }
  return pairs;
}

function singleUnderscorePairs(text: string): MarkerPair[] {
  return singleMarkerPairs(text, "_");
}

function singleAsteriskPairs(text: string): MarkerPair[] {
  return singleMarkerPairs(text, "*");
}

function containingPair(pairs: MarkerPair[], from: number, to: number): MarkerPair | null {
  for (const pair of pairs) {
    if (from < pair.closeEnd && to > pair.openStart) return pair;
  }
  return null;
}

function removePair(text: string, from: number, to: number, pair: MarkerPair, width: number): Snapshot {
  const inner = text.slice(pair.openEnd, pair.closeStart);
  const next = text.slice(0, pair.openStart) + inner + text.slice(pair.closeEnd);
  return result(next, from - width, to - width);
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

/** toggleEmphasis wraps or unwraps bold, italic and strikethrough. */
export function toggleEmphasis(snapshot: Snapshot, format: Exclude<InlineFormat, "code">): InlineEdit {
  const range = selectionOf(snapshot);
  const marker = format === "bold" ? "**" : format === "strikethrough" ? "~~" : "*";
  if (range.from === range.to) {
    const before = range.text.slice(0, range.from);
    const after = range.text.slice(range.to);
    if (format === "italic") {
      if (trailingRun(before, "*") === 1 && leadingRun(after, "*") === 1) {
        const text = before.slice(0, -1) + after.slice(1);
        return result(text, range.from - 1, range.from - 1);
      }
    } else if (before.endsWith(marker) && after.startsWith(marker)) {
      const text = before.slice(0, -marker.length) + after.slice(marker.length);
      return result(text, range.from - marker.length, range.from - marker.length);
    }
    const text = range.text.slice(0, range.from) + marker + marker + range.text.slice(range.to);
    return result(text, range.from + marker.length, range.from + marker.length);
  }

  if (range.selected.includes("\n\n")) return null;
  let left = 0;
  let right = 0;
  if (format === "italic") {
    const lead = leadingRun(range.selected, "*");
    const trail = trailingRun(range.selected, "*");
    if (lead === 1 && trail >= 1) {
      left = right = 1;
    } else if (lead >= 3 && trail >= 3) {
      left = right = 1;
    }
  } else if (
    range.selected.length >= marker.length * 2 &&
    range.selected.startsWith(marker) &&
    range.selected.endsWith(marker)
  ) {
    left = right = marker.length;
  }
  if (left > 0) {
    const inner = range.selected.slice(left, range.selected.length - right);
    const text = range.text.slice(0, range.from) + inner + range.text.slice(range.to);
    return result(text, range.from, range.from + inner.length);
  }

  const pair = format === "italic"
    ? containingPair(singleAsteriskPairs(range.text), range.from, range.to)
    : containingPair(markerPairs(range.text, marker), range.from, range.to);
  if (pair) return removePair(range.text, range.from, range.to, pair, marker.length);

  const before = range.text.slice(0, range.from);
  const after = range.text.slice(range.to);
  if (format === "italic") {
    const lead = trailingRun(before, "*");
    const trail = leadingRun(after, "*");
    if (lead >= 3 && trail >= 3) {
      const text =
        range.text.slice(0, range.from - 1) + range.selected + range.text.slice(range.to + 1);
      return result(text, range.from - 1, range.to - 1);
    }
  }

  const text = before + marker + range.selected + marker + after;
  return result(text, range.from + marker.length, range.to + marker.length);
}

function enclosingCodeSpan(text: string, from: number, to: number): { start: number; end: number; open: number } | null {
  const pattern = /(`+)([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const open = match[1]!.length;
    const start = match.index;
    const end = start + match[0].length;
    if (from >= start + open && to <= end - open) return { start, end, open };
  }
  return null;
}

function codePadding(inner: string): { body: string; pad: number } {
  if (inner.startsWith("`") || inner.endsWith("`")) return { body: ` ${inner} `, pad: 1 };
  return { body: inner, pad: 0 };
}

function stripCodePadding(inner: string): string {
  if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ")) return inner.slice(1, -1);
  return inner;
}

/** toggleCode wraps or unwraps an inline code span with a safe fence length. */
export function toggleCode(snapshot: Snapshot): InlineEdit {
  const range = selectionOf(snapshot);
  if (range.from === range.to) {
    const before = range.text.slice(0, range.from);
    const after = range.text.slice(range.to);
    if (trailingRun(before, "`") === 1 && leadingRun(after, "`") === 1) {
      const text = before.slice(0, -1) + after.slice(1);
      return result(text, range.from - 1, range.from - 1);
    }
    const span = enclosingCodeSpan(range.text, range.from, range.to);
    if (span) {
      const inner = range.text.slice(span.start + span.open, span.end - span.open);
      const text = range.text.slice(0, span.start) + inner + range.text.slice(span.end);
      return result(text, range.from - span.open, range.from - span.open);
    }
    const text = range.text.slice(0, range.from) + "``" + range.text.slice(range.to);
    return result(text, range.from + 1, range.from + 1);
  }

  if (range.selected.includes("\n\n")) return null;
  const wrapped = /^(`+)([\s\S]*)\1$/.exec(range.selected);
  if (wrapped) {
    const fence = wrapped[1]!.length;
    const inner = stripCodePadding(wrapped[2] ?? "");
    if (longestRun(inner, "`") < fence) {
      const text = range.text.slice(0, range.from) + inner + range.text.slice(range.to);
      return result(text, range.from, range.from + inner.length);
    }
  }

  const enclosing = enclosingCodeSpan(range.text, range.from, range.to);
  if (enclosing) {
    const raw = range.text.slice(enclosing.start + enclosing.open, enclosing.end - enclosing.open);
    const inner = stripCodePadding(raw);
    const pad = raw.length === inner.length ? 0 : 1;
    const text = range.text.slice(0, enclosing.start) + inner + range.text.slice(enclosing.end);
    return result(
      text,
      Math.max(enclosing.start, range.from - enclosing.open - pad),
      Math.max(enclosing.start, range.to - enclosing.open - pad),
    );
  }

  const before = range.text.slice(0, range.from);
  const after = range.text.slice(range.to);
  const fence = "`".repeat(Math.max(1, longestRun(range.selected, "`") + 1));
  const { body, pad } = codePadding(range.selected);
  const text = before + fence + body + fence + after;
  const innerStart = range.from + fence.length + pad;
  return result(text, innerStart, innerStart + range.selected.length);
}

type LinkSpan = {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  urlStart: number;
  urlEnd: number;
};

function enclosingLink(text: string, from: number, to: number): LinkSpan | null {
  const pattern = /(^|[^!])(\[([^\]]*)\]\(([^)]*)\))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index + (match[1]?.length ?? 0);
    const end = start + match[2]!.length;
    if (from < start || to > end) continue;
    const textStart = start + 1;
    const textEnd = textStart + (match[3] ?? "").length;
    const urlStart = textEnd + 2;
    const urlEnd = urlStart + (match[4] ?? "").length;
    return { start, end, textStart, textEnd, urlStart, urlEnd };
  }
  return null;
}

const LINK_PLACEHOLDER = "链接文字";
const LINK_TARGET = "https://";

/** insertLink wraps a selection or inserts a placeholder, selecting the part to edit. */
export function insertLink(snapshot: Snapshot): InlineEdit {
  const range = selectionOf(snapshot);
  if (range.from === range.to) {
    const inserted = `[${LINK_PLACEHOLDER}](${LINK_TARGET})`;
    const text = range.text.slice(0, range.from) + inserted + range.text.slice(range.to);
    const start = range.from + 1;
    return result(text, start, start + LINK_PLACEHOLDER.length);
  }

  const existing = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(range.selected);
  if (existing) {
    const url = existing[2] ?? "";
    const start = range.from + 1 + (existing[1] ?? "").length + 2;
    return result(range.text, start, start + url.length);
  }
  if (range.selected.includes("\n")) return null;
  const link = enclosingLink(range.text, range.from, range.to);
  if (link) {
    if (range.from >= link.textStart && range.to <= link.textEnd) {
      return result(range.text, link.urlStart, link.urlEnd);
    }
    if (range.from >= link.urlStart && range.to <= link.urlEnd) {
      return result(range.text, link.urlStart, link.urlEnd);
    }
    return null;
  }
  if (range.selected.includes("[") || range.selected.includes("]")) return null;

  const inserted = `[${range.selected}](${LINK_TARGET})`;
  const text = range.text.slice(0, range.from) + inserted + range.text.slice(range.to);
  const start = range.from + 1 + range.selected.length + 2;
  return result(text, start, start + LINK_TARGET.length);
}

function protectLiterals(text: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  const mask = (match: string) => {
    spans.push(match);
    return `\u0000${spans.length - 1}\u0001`;
  };
  let masked = text.replace(/!\[[^\]]*\]\([^)]*\)/g, mask);
  masked = masked.replace(/\\./g, mask);
  return { text: masked, spans };
}

function cleanInline(source: string): string {
  const { text: masked, spans } = protectLiterals(source);
  let text = masked.replace(/(`+)([\s\S]*?)\1/g, "$2");
  for (let i = 0; i < 6; i++) {
    const previous = text;
    text = text.replace(/(^|[^!])\[([^\]]*)\]\([^)]*\)/g, "$1$2");
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
    text = text.replace(/~~([\s\S]+?)~~/g, "$1");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
    text = text.replace(/(^|[^A-Za-z0-9_])__([^_]+)__(?![A-Za-z0-9_])/g, "$1$2");
    text = text.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "$1$2");
    if (text === previous) break;
  }
  let restored = text;
  for (let i = 0; i < spans.length; i++) {
    restored = restored.split(`\u0000${i}\u0001`).join(spans[i] ?? "");
  }
  return restored;
}

/** expandClearingRange includes markers that wrap the selection. */
function expandClearingRange(text: string, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  for (let i = 0; i < 8; i++) {
    let expanded = false;
    for (const marker of ["**", "~~", "__"]) {
      for (const pair of markerPairs(text, marker)) {
        if (start < pair.closeEnd && end > pair.openStart && (pair.openStart < start || pair.closeEnd > end)) {
          start = Math.min(start, pair.openStart);
          end = Math.max(end, pair.closeEnd);
          expanded = true;
          break;
        }
      }
      if (expanded) break;
    }
    if (expanded) continue;
    const italics = [...singleAsteriskPairs(text), ...singleUnderscorePairs(text)];
    for (const pair of italics) {
      if (start < pair.closeEnd && end > pair.openStart && (pair.openStart < start || pair.closeEnd > end)) {
        start = Math.min(start, pair.openStart);
        end = Math.max(end, pair.closeEnd);
        expanded = true;
        break;
      }
    }
    if (expanded) continue;

    const code = /(`+)([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = code.exec(text))) {
      const open = match[1]!.length;
      const codeStart = match.index;
      const codeEnd = codeStart + match[0].length;
      if (start >= codeStart + open && end <= codeEnd - open) {
        start = codeStart;
        end = codeEnd;
        expanded = true;
        break;
      }
    }
    if (expanded) continue;

    const image = /!\[[^\]]*\]\([^)]*\)/g;
    while ((match = image.exec(text))) {
      const imageStart = match.index;
      const imageEnd = imageStart + match[0].length;
      if (start >= imageStart && end <= imageEnd) {
        start = imageStart;
        end = imageEnd;
        expanded = true;
        break;
      }
    }
    if (expanded) continue;

    const link = /(^|[^!])(\[[^\]]*\]\([^)]*\))/g;
    while ((match = link.exec(text))) {
      const linkStart = match.index + (match[1]?.length ?? 0);
      const linkEnd = linkStart + match[2]!.length;
      if (start >= linkStart && end <= linkEnd) {
        start = linkStart;
        end = linkEnd;
        expanded = true;
        break;
      }
    }
    if (!expanded) break;
  }
  return { from: start, to: end };
}

/** clearFormatting removes known inline markers while keeping the text. */
export function clearFormatting(snapshot: Snapshot): InlineEdit {
  if (snapshot.anchor === snapshot.head) return null;
  const range = selectionOf(snapshot);
  const expanded = expandClearingRange(range.text, range.from, range.to);
  const source = range.text.slice(expanded.from, expanded.to);
  const cleaned = cleanInline(source);
  if (cleaned === source) return null;
  const text = range.text.slice(0, expanded.from) + cleaned + range.text.slice(expanded.to);
  return result(text, expanded.from, expanded.from + cleaned.length);
}
