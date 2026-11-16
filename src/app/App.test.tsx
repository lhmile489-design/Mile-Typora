import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { Transport } from "../lib/transport";

afterEach(cleanup);

function fakeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    ready: async () => ({ ok: true, value: { windowId: 3, version: "0.1.0" } }),
    newWindow: async () => ({ ok: true, value: undefined }),
    onOpenRequest: () => () => {},
    pending: async () => ({ ok: true, value: [] }),
    ack: async () => {},
    ...overrides,
  };
}

describe("App shell", () => {
  it("renders the three panes and the status bar", () => {
    render(<App transport={fakeTransport()} />);
    expect(screen.getByRole("toolbar", { name: "工具栏" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "文件树" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "预留侧栏" })).toBeTruthy();
    expect(screen.getByText("开始阅读")).toBeTruthy();
  });

  it("keeps unwired toolbar commands visible but disabled", () => {
    render(<App transport={fakeTransport()} />);
    for (const name of ["打开文件", "打开目录", "刷新", "查找", "设置"]) {
      const b = screen.getByRole("button", { name });
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    // Wired commands work, so they are not disabled.
    for (const name of ["新建窗口", "左侧栏", "预留侧栏"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("shows the window from the ready handshake", async () => {
    render(<App transport={fakeTransport()} />);
    expect(await screen.findByText("窗口 3 · v0.1.0")).toBeTruthy();
  });

  it("shows a failed handshake with text, not only color", async () => {
    render(<App transport={fakeTransport({ ready: async () => ({ ok: false, message: "boom" }) })} />);
    expect(await screen.findByText(/连接失败：boom/)).toBeTruthy();
  });

  it("toggles the side panes", () => {
    render(<App transport={fakeTransport()} />);
    const left = screen.getByRole("button", { name: "左侧栏" });
    fireEvent.click(left);
    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "文件树" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预留侧栏" }));
    expect(screen.queryByRole("complementary", { name: "预留侧栏" })).toBeNull();
  });

  it("opens a window from the toolbar", () => {
    const newWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ newWindow })} />);
    fireEvent.click(screen.getByRole("button", { name: "新建窗口" }));
    expect(newWindow).toHaveBeenCalledTimes(1);
  });

  it("opens a window from Ctrl+Shift+N", () => {
    const newWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ newWindow })} />);
    fireEvent.keyDown(window, { key: "N", ctrlKey: true, shiftKey: true });
    expect(newWindow).toHaveBeenCalledTimes(1);
    // Without Shift it is not the window shortcut.
    fireEvent.keyDown(window, { key: "N", ctrlKey: true });
    expect(newWindow).toHaveBeenCalledTimes(1);
  });

  it("shows the open requests queued before the handshake", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 2, path: "b.md" }] });
    const ack = vi.fn(async () => {});
    render(<App transport={fakeTransport({ pending, ack })} />);
    expect(await screen.findByText(/待打开：b\.md/)).toBeTruthy();
    expect(ack).toHaveBeenCalledWith(2);
  });

  it("takes open requests after the handshake and ignores repeats", async () => {
    let deliver: (r: { seq: number; path: string }) => void = () => {};
    const onOpenRequest = (listener: (r: { seq: number; path: string }) => void) => {
      deliver = listener;
      return () => {};
    };
    render(<App transport={fakeTransport({ onOpenRequest })} />);
    await screen.findByText("窗口 3 · v0.1.0");
    act(() => deliver({ seq: 1, path: "a.md" }));
    expect(screen.getByText(/待打开：a\.md/)).toBeTruthy();
    act(() => deliver({ seq: 1, path: "a.md" }));
    expect(screen.queryByText(/（2）/)).toBeNull();
    act(() => deliver({ seq: 2, path: "c.md" }));
    expect(screen.getByText(/待打开（2）：c\.md/)).toBeTruthy();
  });

  it("shows a new-window failure in the window that asked", async () => {
    const newWindow = vi.fn(async () => ({ ok: false as const, message: "无法创建新窗口" }));
    render(<App transport={fakeTransport({ newWindow })} />);
    fireEvent.click(screen.getByRole("button", { name: "新建窗口" }));
    expect(await screen.findByText(/无法创建新窗口/)).toBeTruthy();
  });
});
