// Self-drawn spell checker (M6-4 EDIT-21). The WebView2 native checker cannot
// exclude code/math/URL regions and mygo does not expose a switch for it, so
// the page draws its own wavy underlines via CodeMirror Decoration.mark.
// Dictionary: typo-js@2.0.0 with the bundled en-US .aff/.dic files, loaded
// lazily on first enable. No network, no system checker, no CJK checking.

import { protectedAt, protectedMask } from "./protection";

// Vite resolves the ?url suffix to the emitted asset path; the .aff/.dic files
// ship with the bundle and are fetched only when the user first turns the
// checker on (P3 §3.4: lazy load, no preload).
import affUrl from "typo-js/dictionaries/en_US/en_US.aff?url";
import dicUrl from "typo-js/dictionaries/en_US/en_US.dic?url";

const MAX_WORDS_PER_SCAN = 5000;
const MIN_WORD_LENGTH = 2;
const MAX_WORD_LENGTH = 32;
// ASCII letters only: CJK, digits, underscores and apostrophes split words.
const WORD_CHARS = /[A-Za-z]/;
const WORD = /[A-Za-z]+/g;

/** A misspelled span to underline. from/to are document offsets. */
export type SpellError = { from: number; to: number; word: string };

type Checker = { check(word: string): boolean; suggest(word: string, limit?: number): string[] };

let dictionary: Checker | null = null;
let loading: Promise<Checker | null> | null = null;

/** Session-scoped "忽略本次" set: the word is skipped until the app restarts. */
const ignored = new Set<string>();

/** loadDictionary resolves with the ready checker, or null when the bundled
 * files cannot be fetched (offline build, corrupted install). It never throws. */
export async function loadDictionary(): Promise<Checker | null> {
  if (dictionary) return dictionary;
  if (loading) return loading;
  loading = (async () => {
    try {
      const Typo = (await import("typo-js")).default as new (dict: string, aff: string, dic: string) => Checker;
      const [aff, dic] = await Promise.all([fetch(affUrl).then((r) => r.text()), fetch(dicUrl).then((r) => r.text())]);
      dictionary = new Typo("en_US", aff, dic);
      return dictionary;
    } catch {
      dictionary = null;
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** checkWord reports whether the word is in the dictionary or was ignored. */
export function checkWord(checker: Checker, word: string): boolean {
  if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) return true;
  if (ignored.has(word.toLowerCase())) return true;
  return checker.check(word);
}

/** suggestions returns at most limit corrections for a misspelled word. */
export function suggestions(checker: Checker, word: string, limit = 5): string[] {
  return checker.suggest(word, limit);
}

/** ignoreForSession marks a word so it is not flagged again this session. */
export function ignoreForSession(word: string): void {
  ignored.add(word.toLowerCase());
}

/** isIgnored reports whether a word is on the session ignore list. */
export function isIgnored(word: string): boolean {
  return ignored.has(word.toLowerCase());
}

/**
 * wordAt finds the English word covering an offset. It returns null when the
 * position is not inside an ASCII-letter run, or when the run sits in a
 * protected region (code, math, front matter, HTML, link destination).
 */
export function wordAt(text: string, position: number): SpellError | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEnd = text.indexOf("\n", position);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const offset = position - lineStart;
  let match: RegExpExecArray | null;
  WORD.lastIndex = 0;
  while ((match = WORD.exec(line))) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start || offset >= end) continue;
    const word = match[0];
    const from = lineStart + start;
    const to = lineStart + end;
    if (protectedAt(text, from)) return null;
    return { from, to, word };
  }
  return null;
}

/**
 * scanRange finds misspelled English words inside one text range. It caps the
 * scan at MAX_WORDS_PER_SCAN words so a giant paste does not freeze the editor;
 * it skips protected regions via the shared rule (P3-AC-14).
 */
export function scanRange(
  text: string,
  from: number,
  to: number,
  checker: Checker,
): SpellError[] {
  const out: SpellError[] = [];
  let scanned = 0;
  // One protection pass for the whole range instead of one full-document scan
  // per word — a large paste would otherwise turn the scan quadratic.
  const mask = protectedMask(text, from, to);
  const region = text.slice(from, to);
  const lines = region.split("\n");
  let offset = from;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    let match: RegExpExecArray | null;
    WORD.lastIndex = 0;
    while ((match = WORD.exec(line))) {
      const word = match[0];
      const start = offset + match.index;
      const end = start + word.length;
      if (word.length >= MIN_WORD_LENGTH && word.length <= MAX_WORD_LENGTH) {
        scanned++;
        if (!checkWord(checker, word) && !mask[start - from]) {
          out.push({ from: start, to: end, word });
        }
      }
      if (scanned >= MAX_WORDS_PER_SCAN) return out;
    }
    offset = lineEnd + 1;
  }
  return out;
}

/** hasWordChars reports whether a range holds any ASCII letters at all; callers
 * use it to skip the scan for pure-CJK or empty ranges. */
export function hasWordChars(text: string, from: number, to: number): boolean {
  return WORD_CHARS.test(text.slice(from, to));
}
