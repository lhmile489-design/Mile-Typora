import { describe, expect, it } from "vitest";
import { failureMessage, failureText, formatBytes } from "./errors";

describe("failureMessage", () => {
  it("prefers the detail Go sent", () => {
    expect(failureMessage("too_large", "文件 11.0 MB 超过上限 10 MB")).toBe("文件 11.0 MB 超过上限 10 MB");
  });

  it("falls back to the code's message", () => {
    expect(failureMessage("encoding", "  ")).toBe("暂不支持此文件编码，请转换为 UTF-8");
  });

  it("never leaves the user without a message", () => {
    expect(failureMessage("something_new")).toBe("操作失败");
  });
});

describe("failureText", () => {
  it("adds the actual size and the limit", () => {
    expect(
      failureText({
        code: "too_large",
        detail: "文件超过读取上限",
        size: 11 * 1024 * 1024,
        limit: 10 * 1024 * 1024,
      }),
    ).toBe("文件超过读取上限：11 MB，上限 10 MB");
  });

  it("leaves other failures as they are", () => {
    expect(failureText({ code: "encoding" })).toBe("暂不支持此文件编码，请转换为 UTF-8");
  });
});

describe("formatBytes", () => {
  it("uses the unit that fits", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(153600)).toBe("150 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
