import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { Transport } from "../lib/transport";

afterEach(cleanup);

const readyTransport: Transport = {
  ready: async () => ({ ok: true, value: { windowId: 3, version: "0.1.0" } }),
};

describe("App shell", () => {
  it("renders the three panes and the status bar", () => {
    render(<App transport={readyTransport} />);
    expect(screen.getByRole("toolbar", { name: "工具栏" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "文件树" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "预留侧栏" })).toBeTruthy();
    expect(screen.getByText("开始阅读")).toBeTruthy();
  });

  it("keeps unwired toolbar commands visible but disabled", () => {
    render(<App transport={readyTransport} />);
    for (const name of ["打开文件", "打开目录", "新建窗口", "刷新", "查找", "设置"]) {
      const b = screen.getByRole("button", { name });
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    // The two pane toggles work, so they are not disabled.
    expect(screen.getByRole("button", { name: "左侧栏" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("shows the window from the ready handshake", async () => {
    render(<App transport={readyTransport} />);
    expect(await screen.findByText("窗口 3 · v0.1.0")).toBeTruthy();
  });

  it("shows a failed handshake with text, not only color", async () => {
    const failing: Transport = { ready: async () => ({ ok: false, message: "no calling window" }) };
    render(<App transport={failing} />);
    expect(await screen.findByText(/连接失败：no calling window/)).toBeTruthy();
  });

  it("toggles the side panes", () => {
    render(<App transport={readyTransport} />);
    const left = screen.getByRole("button", { name: "左侧栏" });
    fireEvent.click(left);
    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "文件树" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预留侧栏" }));
    expect(screen.queryByRole("complementary", { name: "预留侧栏" })).toBeNull();
  });
});
