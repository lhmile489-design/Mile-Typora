import { describe, expect, it } from "vitest";
import DOMPurify from "dompurify";
import { diagramType, hasInitDirective, isSupportedType, withTimeout } from "./mermaid";

describe("diagram types", () => {
  it("reads the first meaningful line", () => {
    expect(diagramType("\n%% 注释\nflowchart TD\n  A --> B")).toBe("flowchart TD");
    expect(diagramType("sequenceDiagram\n  甲->>乙: 你好")).toBe("sequenceDiagram");
    expect(diagramType("   \n\n")).toBeNull();
  });

  it("accepts the six supported kinds", () => {
    for (const src of [
      "flowchart TD\nA --> B",
      "graph LR\nA --> B",
      "sequenceDiagram\nA->>B: hi",
      "classDiagram\nclass A",
      "stateDiagram-v2\n[*] --> A",
      "erDiagram\nA ||--o{ B : has",
      "gantt\ntitle t",
    ]) {
      expect(isSupportedType(src)).toBe(true);
    }
  });

  it("refuses other kinds, which stay source", () => {
    for (const src of ["pie\n\"a\": 1", "mindmap\n  root", "journey\n  title", "未知类型\n  x"]) {
      expect(isSupportedType(src)).toBe(false);
    }
  });
});

describe("init directive", () => {
  it("is detected in any spelling that could reconfigure Mermaid", () => {
    expect(hasInitDirective('%%{init: {"securityLevel": "loose"}}%%\nflowchart TD')).toBe(true);
    expect(hasInitDirective("%%{init: {'theme': 'dark'}}%%")).toBe(true);
    expect(hasInitDirective("%% { init : { } } %%")).toBe(false);
    expect(hasInitDirective("%% 普通注释\nflowchart TD")).toBe(false);
  });
});

describe("sanitizing diagram output", () => {
  it("drops an image a label smuggled in, event handler or not", () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><a><text>甲</text></a><img src="x" onerror="alert(1)"></svg>';
    const clean = DOMPurify.sanitize(dirty, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["img", "script", "iframe", "object", "embed", "link", "meta"],
    });
    expect(clean.toLowerCase()).not.toContain("<img");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("<text>甲</text>");
  });
});

describe("withTimeout", () => {
  it("passes a quick result through", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("gives up when the work takes too long", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 50));
    await expect(withTimeout(slow, 5)).rejects.toThrow(/渲染超过/);
  });
});
