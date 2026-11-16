import { describe, expect, it } from "vitest";
import { CSP, cspPlugin } from "./csp";

function transform(html: string): string {
  const plugin = cspPlugin();
  const hook = plugin.transformIndexHtml;
  if (!hook || typeof hook === "function") throw new Error("expected an object hook");
  return String(hook.handler(html, {} as never));
}

describe("cspPlugin", () => {
  it("adds the policy to the head", () => {
    const out = transform("<!doctype html><html><head><title>t</title></head><body></body></html>");
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain(CSP);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("</head>"));
  });

  it("forbids inline and remote script", () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toContain("'unsafe-inline' ; script");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-src 'none'");
  });

  it("allows images from the app and its resource protocol only", () => {
    expect(CSP).toContain("img-src 'self' http://mtres.localhost");
    expect(CSP).not.toContain("img-src *");
  });

  it("runs at build time only", () => {
    expect(cspPlugin().apply).toBe("build");
  });
});
