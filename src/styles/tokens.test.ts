// @vitest-environment node
// The design draft is the visual baseline (docs/开发计划.md §2.1): every
// token in tokens.css must exist there with the same value, in both themes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

type Tokens = Map<string, string>;

/** Tokens declared in the first block that starts at `start`. */
function block(css: string, start: string, end: string): Tokens {
  const from = css.indexOf(start);
  const to = css.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`block ${start} not found`);
  const out: Tokens = new Map();
  for (const m of css.slice(from, to).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = m[1];
    const value = m[2];
    if (name && value) out.set(name, value.trim().replace(/\s+/g, " "));
  }
  return out;
}

// Not app tokens: --draft-* belongs to the design draft's own canvas, and
// --font-math only imitates KaTeX there (KaTeX ships its own fonts).
const notAppTokens = (name: string) => name.startsWith("--draft-") || name === "--font-math";

function compare(actual: Tokens, expected: Tokens, theme: string) {
  const missing: string[] = [];
  const differing: string[] = [];
  for (const [name, value] of expected) {
    if (notAppTokens(name)) continue;
    const got = actual.get(name);
    if (got === undefined) missing.push(name);
    else if (got !== value) differing.push(`${name}: ${got} != ${value}`);
  }
  expect({ theme, missing }).toEqual({ theme, missing: [] });
  expect({ theme, differing }).toEqual({ theme, differing: [] });
}

describe("design tokens", () => {
  const draft = read("docs/design/mile-typora-design.html");
  const tokens = read(["src", "styles", "tokens.css"].join("/"));

  it("matches the design draft's light and dark values", () => {
    const draftLight = block(draft, ":root {", ':root[data-theme="dark"]');
    const draftDark = block(draft, ':root[data-theme="dark"] {', "@media (prefers-reduced-motion");
    const light = block(tokens, ":root {", ':root[data-theme="dark"]');
    const dark = block(tokens, ':root[data-theme="dark"] {', "@media (prefers-reduced-motion");

    expect(draftLight.size).toBeGreaterThan(50);
    expect(draftDark.size).toBeGreaterThan(40); // only colors and shadows repeat
    compare(light, draftLight, "light");
    compare(dark, draftDark, "dark");
  });

  it("carries no token that only the design draft's canvas uses", () => {
    const light = block(tokens, ":root {", ':root[data-theme="dark"]');
    for (const name of light.keys()) {
      expect(name.startsWith("--draft-")).toBe(false);
    }
  });
});
