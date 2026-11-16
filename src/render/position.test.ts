import { describe, expect, it } from "vitest";
import { capture, restore, type Metrics } from "./position";

const metrics = (scrollTop: number, headings: { id: string; top: number }[]): Metrics => ({
  scrollTop,
  clientHeight: 500,
  scrollHeight: 2500,
  headings,
});

describe("reading position", () => {
  it("records the heading above and the offset below it", () => {
    const m = metrics(700, [
      { id: "a", top: 0 },
      { id: "b", top: 600 },
      { id: "c", top: 1200 },
    ]);
    const p = capture(m);
    expect(p.anchor).toBe("b");
    expect(p.offset).toBe(100);
    expect(p.ratio).toBeCloseTo(0.35);
  });

  it("restores from the heading, not the ratio", () => {
    const p = { anchor: "b", offset: 100, ratio: 0.9 };
    const target = restore(metrics(0, [{ id: "b", top: 800 }]), p);
    expect(target).toBe(900);
  });

  it("falls back to the ratio when the heading is gone", () => {
    const p = { anchor: "removed", offset: 100, ratio: 0.5 };
    expect(restore(metrics(0, [{ id: "other", top: 10 }]), p)).toBe(1000);
  });

  it("stays inside the scrollable range", () => {
    const p = { anchor: "b", offset: 99999, ratio: 1 };
    expect(restore(metrics(0, [{ id: "b", top: 10 }]), p)).toBe(2000);
  });

  it("starts at the top when there is no heading above", () => {
    const p = capture(metrics(0, [{ id: "a", top: 100 }]));
    expect(p.anchor).toBeNull();
    expect(p.offset).toBe(0);
  });
});
