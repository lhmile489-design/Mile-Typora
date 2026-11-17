// Math editing helpers (P3 M6-2). Pure snapshot transforms keep the commands
// testable; SourceEditor applies each as one undo step. The buffer stays
// Markdown source; KaTeX only checks a formula on demand.

import type { ParagraphEdit, Snapshot } from "./paragraph";
import { protectedLineSet } from "./paragraph";
import { protectedAt } from "./protection";

export type MathKind = "inline" | "block";

export type MathFormula = {
  kind: MathKind;
  open: string;
  close: string;
  start: number;
  innerStart: number;
  innerEnd: number;
  end: number;
  tex: string;
};

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

function codeSpanMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  const pattern = /(`+)([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    for (let i = match.index; i < match.index + match[0].length; i++) mask[i] = true;
  }
  return mask;
}

function commentMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const pattern = /<!--[\s\S]*?-->/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    for (let i = match.index; i < match.index + match[0].length; i++) mask[i] = true;
  }
  return mask;
}

function escaped(text: string, position: number): boolean {
  let count = 0;
  for (let i = position - 1; i >= 0 && text[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function structuralLines(text: string): Set<number> {
  const lines = splitLines(text);
  const marked = new Set<number>();
  let front = lines[0]?.text.trim() === "---";
  let fenceChar = "";
  let fenceLength = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.text.trim();
    if (front) {
      marked.add(i);
      if (i > 0 && (trimmed === "---" || trimmed === "...")) front = false;
      continue;
    }
    if (fenceChar !== "") {
      marked.add(i);
      if (trimmed.startsWith(fenceChar.repeat(fenceLength)) && /^[`~]+\s*$/.test(trimmed)) {
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (open) {
      fenceChar = open[1]![0]!;
      fenceLength = open[1]!.length;
      marked.add(i);
      continue;
    }
    if (/^(?: {4}|\t)/.test(line.text)) marked.add(i);
  }
  return marked;
}

/** mathRanges finds inline and block formulas outside code and front matter. */
export function mathRanges(text: string): MathFormula[] {
  const lines = splitLines(text);
  const structural = structuralLines(text);
  const protectedLines = protectedLineSet(text);
  const comments = commentMask(text);
  const ranges: MathFormula[] = [];
  const blockLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (structural.has(i)) continue;
    const trimmed = lines[i]!.text.trim();
    let close = "";
    if (trimmed === "$$") close = "$$";
    else if (trimmed === "\\[") close = "\\]";
    if (!close) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.text.trim() === close) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const start = lines[i]!.start;
    const innerStart = lines[i]!.end + 1;
    const innerEnd = lines[end]!.start;
    ranges.push({
      kind: "block",
      open: close === "$$" ? "$$" : "\\[",
      close,
      start,
      innerStart,
      innerEnd,
      end: lines[end]!.end,
      tex: text.slice(innerStart, innerEnd).replace(/\n$/, ""),
    });
    for (let j = i; j <= end; j++) blockLines.add(j);
    i = end;
  }

  for (let i = 0; i < lines.length; i++) {
    if (structural.has(i) || blockLines.has(i) || protectedLines.has(i)) continue;
    const line = lines[i]!;
    const lineText = line.text;
    const mask = codeSpanMask(lineText);
    let cursor = 0;
    while (cursor < lineText.length) {
      if (comments[line.start + cursor]) {
        cursor++;
        continue;
      }
      if (lineText.startsWith("\\(", cursor)) {
        const end = lineText.indexOf("\\)", cursor + 2);
        if (end < 0) {
          cursor += 2;
          continue;
        }
        if (!mask[cursor] && !mask[end]) {
          ranges.push({
            kind: "inline",
            open: "\\(",
            close: "\\)",
            start: line.start + cursor,
            innerStart: line.start + cursor + 2,
            innerEnd: line.start + end,
            end: line.start + end + 2,
            tex: lineText.slice(cursor + 2, end),
          });
          cursor = end + 2;
          continue;
        }
        cursor += 2;
        continue;
      }
      if (lineText[cursor] === "$" && !escaped(lineText, cursor)) {
        if (lineText[cursor + 1] === "$") {
          cursor += 2;
          continue;
        }
        let end = -1;
        for (let j = cursor + 1; j < lineText.length; j++) {
          if (lineText[j] !== "$" || escaped(lineText, j)) continue;
          end = j;
          break;
        }
        if (end > cursor + 1) {
          ranges.push({
            kind: "inline",
            open: "$",
            close: "$",
            start: line.start + cursor,
            innerStart: line.start + cursor + 1,
            innerEnd: line.start + end,
            end: line.start + end + 1,
            tex: lineText.slice(cursor + 1, end),
          });
          cursor = end + 1;
          continue;
        }
      }
      cursor++;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** mathAt returns the formula the caret or selection belongs to. */
export function mathAt(snapshot: Snapshot): MathFormula | null {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  for (const formula of mathRanges(snapshot.text)) {
    const inside = from >= formula.innerStart && to <= formula.innerEnd;
    const whole = from === formula.start && to === formula.end;
    if (inside || whole) return formula;
  }
  return null;
}

/**
 * mathProtected reports a caret in code, front matter, a link destination or
 * another protected region — the shared inline-exclusion verdict (P3-AC-14).
 */
export function mathProtected(text: string, position: number): boolean {
  // Math commands run inside formulas, so the shared verdict excludes them.
  return protectedAt(text, position, false);
}

function result(text: string, anchor: number, head = anchor): Snapshot {
  return { text, anchor, head };
}

function snippetEdit(snapshot: Snapshot, body: string, placeholder: string): ParagraphEdit {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  if (mathProtected(snapshot.text, from)) return null;
  const at = body.indexOf(placeholder);
  const text = snapshot.text.slice(0, from) + body + snapshot.text.slice(to);
  const start = from + (at >= 0 ? at : 0);
  return result(text, start, start + (at >= 0 ? placeholder.length : 0));
}

/** insertMathSnippet inserts a template and selects its first placeholder. */
export function insertMathSnippet(snapshot: Snapshot, kind: MathSnippet): ParagraphEdit {
  const snippet = MATH_SNIPPETS[kind];
  return snippet ? snippetEdit(snapshot, snippet.body, snippet.placeholder) : null;
}

export type MathSnippet =
  | "fraction"
  | "sqrt"
  | "superscript"
  | "subscript"
  | "matrix"
  | "cases"
  | "aligned"
  | "sum"
  | "integral"
  | "limit";

const MATH_SNIPPETS: Record<MathSnippet, { body: string; placeholder: string }> = {
  fraction: { body: "\\frac{分子}{分母}", placeholder: "分子" },
  sqrt: { body: "\\sqrt{内容}", placeholder: "内容" },
  superscript: { body: "^{指数}", placeholder: "指数" },
  subscript: { body: "_{下标}", placeholder: "下标" },
  matrix: { body: "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}", placeholder: "a" },
  cases: { body: "\\begin{cases}\n内容 & 条件一 \\\\\n-内容 & 条件二\n\\end{cases}", placeholder: "内容" },
  aligned: { body: "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}", placeholder: "a" },
  sum: { body: "\\sum_{i=1}^{n} 项", placeholder: "项" },
  integral: { body: "\\int_{a}^{b} 内容 \\, dx", placeholder: "内容" },
  limit: { body: "\\lim_{x \\to 0} 内容", placeholder: "内容" },
};

/** insertInlineMath wraps the selection or inserts `$公式$`. A second call unwraps. */
export function insertInlineMath(snapshot: Snapshot): ParagraphEdit {
  const from = Math.min(snapshot.anchor, snapshot.head);
  const to = Math.max(snapshot.anchor, snapshot.head);
  if (mathProtected(snapshot.text, from)) return null;
  const existing = mathAt(snapshot);
  if (existing && existing.kind === "inline") {
    const text = snapshot.text.slice(0, existing.start) + existing.tex + snapshot.text.slice(existing.end);
    return result(text, existing.start, existing.start + existing.tex.length);
  }
  if (mathProtected(snapshot.text, from)) return null;
  const selected = snapshot.text.slice(from, to);
  if (selected.includes("\n\n")) return null;
  if (selected.startsWith("$") && selected.endsWith("$") && selected.length >= 2) {
    const inner = selected.slice(1, -1);
    const text = snapshot.text.slice(0, from) + inner + snapshot.text.slice(to);
    return result(text, from, from + inner.length);
  }
  if (selected !== "") {
    const text = snapshot.text.slice(0, from) + "$" + selected + "$" + snapshot.text.slice(to);
    return result(text, from + 1, to + 1);
  }
  const body = "$公式$";
  const at = from + 1;
  return result(snapshot.text.slice(0, from) + body + snapshot.text.slice(to), at, at + 2);
}

export type MathDelimiter = "dollar" | "paren" | "block-dollar" | "block-bracket";

const DELIMITERS: Record<MathDelimiter, { kind: MathKind; open: string; close: string }> = {
  dollar: { kind: "inline", open: "$", close: "$" },
  paren: { kind: "inline", open: "\\(", close: "\\)" },
  "block-dollar": { kind: "block", open: "$$", close: "$$" },
  "block-bracket": { kind: "block", open: "\\[", close: "\\]" },
};

/** convertMathDelimiter rewrites one formula to another delimiter form. */
export function convertMathDelimiter(snapshot: Snapshot, target: MathDelimiter): ParagraphEdit {
  const formula = mathAt(snapshot);
  const next = DELIMITERS[target];
  if (!formula || !next) return null;
  if (formula.open === next.open && formula.close === next.close) return null;
  const inner = formula.tex.trim();
  if (inner === "") return null;
  if (next.kind === "block") {
    if (formula.kind === "inline") {
      const lineStart = snapshot.text.lastIndexOf("\n", formula.start - 1) + 1;
      const lineEnd = snapshot.text.indexOf("\n", formula.end);
      const before = snapshot.text.slice(lineStart, formula.start);
      const after = snapshot.text.slice(formula.end, lineEnd === -1 ? snapshot.text.length : lineEnd);
      if (before.trim() !== "" || after.trim() !== "") return null;
    }
    const replacement = `${next.open}\n${inner}\n${next.close}`;
    const text = snapshot.text.slice(0, formula.start) + replacement + snapshot.text.slice(formula.end);
    const cursor = formula.start + next.open.length + 1 + inner.length;
    return result(text, cursor);
  }
  if (formula.kind === "block" && inner.includes("\n")) {
    // Inline formulas must stay on one line; collapse source line breaks.
    const flat = inner.replace(/\s*\n\s*/g, " ");
    const replacement = next.open + flat + next.close;
    const text = snapshot.text.slice(0, formula.start) + replacement + snapshot.text.slice(formula.end);
    return result(text, formula.start + next.open.length, formula.start + next.open.length + flat.length);
  }
  const replacement = next.open + inner + next.close;
  const text = snapshot.text.slice(0, formula.start) + replacement + snapshot.text.slice(formula.end);
  return result(text, formula.start + next.open.length, formula.start + next.open.length + inner.length);
}

/** mathInfo returns the formula source and display mode for the check command. */
export function mathInfo(snapshot: Snapshot): { tex: string; display: boolean; kind: MathKind } | null {
  const formula = mathAt(snapshot);
  if (!formula) return null;
  return { tex: formula.tex, display: formula.kind === "block", kind: formula.kind };
}
