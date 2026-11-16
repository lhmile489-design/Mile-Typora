import { describe, expect, it } from "vitest";
import { wrap } from "./transport";

describe("wrap", () => {
  it("passes a value through", async () => {
    expect(await wrap(async () => 42)).toEqual({ ok: true, value: 42 });
  });

  it("turns a rejection into a failed outcome", async () => {
    expect(await wrap(async () => Promise.reject(new Error("boom")))).toEqual({
      ok: false,
      message: "boom",
    });
  });

  it("handles non-Error rejections", async () => {
    expect(await wrap(async () => Promise.reject("plain"))).toEqual({ ok: false, message: "plain" });
  });
});
