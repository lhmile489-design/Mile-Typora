// Source-buffer search for the editing find bar (P1 EDIT-22).
// Matching is literal: Latin letters ignore case, everything else matches as
// written; the empty query never matches.

export type Match = { from: number; to: number };

/** foldText lowercases Latin letters while keeping every offset stable. */
function foldText(text: string): string {
  const lower = text.toLocaleLowerCase();
  if (lower.length === text.length) return lower;
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char;
  }
  return out;
}

/** findMatches returns non-overlapping literal matches in document order. */
export function findMatches(text: string, query: string): Match[] {
  const needleText = query.trim();
  if (needleText === "") return [];
  const haystack = foldText(text);
  const needle = foldText(needleText);
  const matches: Match[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ from: at, to: at + needle.length });
    from = at + needle.length;
  }
  return matches;
}

/** replaceOne replaces the match at index and reports the new match set. */
export function replaceOne(
  text: string,
  query: string,
  replacement: string,
  index: number,
): { text: string; matches: Match[]; index: number; replaced: boolean } {
  const matches = findMatches(text, query);
  if (matches.length === 0) return { text, matches, index: 0, replaced: false };
  const at = Math.min(Math.max(index, 0), matches.length - 1);
  const match = matches[at]!;
  const next = text.slice(0, match.from) + replacement + text.slice(match.to);
  const after = findMatches(next, query);
  return {
    text: next,
    matches: after,
    index: after.length === 0 ? 0 : Math.min(at, after.length - 1),
    replaced: true,
  };
}

/** replaceEvery replaces all matches in one edit. */
export function replaceEvery(
  text: string,
  query: string,
  replacement: string,
): { text: string; count: number; matches: Match[] } {
  const matches = findMatches(text, query);
  if (matches.length === 0) return { text, count: 0, matches };
  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.from) + replacement;
    cursor = match.to;
  }
  out += text.slice(cursor);
  return { text: out, count: matches.length, matches: findMatches(out, query) };
}
