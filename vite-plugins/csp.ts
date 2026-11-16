// The production page runs under a strict Content-Security-Policy
// (CLAUDE.md §6, PRD FR-06): no inline script, no remote code, images only
// from the app itself and its own resource protocol.
//
// It is added at build time only: the development server injects inline
// scripts of its own, and the policy is for what ships.
import type { Plugin } from "vite";

/** The policy the built page runs under. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // KaTeX and Mermaid set inline styles on what they render.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' http://mtres.localhost",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** cspPlugin adds the policy's meta tag to the built index.html. */
export function cspPlugin(): Plugin {
  return {
    name: "mt-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
        return html.replace("</head>", `    ${meta}\n  </head>`);
      },
    },
  };
}
