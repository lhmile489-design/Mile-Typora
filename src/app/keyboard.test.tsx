import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    openFile: async () => ({ kind: "cancelled" as const }),
    openFolder: async () => ({ kind: "cancelled" as const }),
    openRequested: async () => ({ kind: "handedOff" as const }),
    openTreeFile: async () => ({ kind: "handedOff" as const }),
    openLink: async () => ({ kind: "none" as const }),
    getSettings: async () => ({
      kind: "ok" as const,
      settings: { startup: "blank", appearance: "system", recent: [] },
      corrupt: false,
    }),
    saveSettings: async () => ({ ok: true as const, value: undefined }),
    clearRecent: async () => ({ ok: true as const, value: undefined }),
    openRecent: async () => ({ kind: "handedOff" as const }),
    onThemeChange: () => () => {},
    onDocUpdated: () => () => {},
    refresh: async () => ({ kind: "cancelled" as const }),
    closeDocument: async () => ({ ok: true as const, value: undefined }),
    closeWindow: async () => ({ ok: true as const, value: undefined }),
    scan: () => ({ abort: () => {}, done: Promise.resolve() }),
    ...overrides,
  };
}

type Width = { set(width: number): void; restore(): void };

/** setWidth emulates the window manager resizing the window. */
function installWidth(width: number): Width {
  const original = window.innerWidth;
  const apply = (value: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value });
  };
  apply(width);
  return {
    set(value) {
      apply(value);
      window.dispatchEvent(new Event("resize"));
    },
    restore() {
      apply(original);
    },
  };
}

describe("keyboard commands", () => {
  it("exposes each shortcut to assistive tech and the tooltip", () => {
    render(<App transport={fakeTransport()} />);
    const open = screen.getByRole("button", { name: "打开文件" });
    expect(open.getAttribute("aria-keyshortcuts")).toBe("Control+O");
    expect(open.getAttribute("title")).toContain("Ctrl+O");
    expect(screen.getByRole("button", { name: "刷新" }).getAttribute("aria-keyshortcuts")).toBe("F5");
    expect(screen.getByRole("button", { name: "设置" }).getAttribute("aria-keyshortcuts")).toBe("Control+,");
  });

  it("toggles the left pane, closes the window and blocks Ctrl+S", async () => {
    const closeWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ closeWindow })} />);
    const left = screen.getByRole("button", { name: "左侧栏" });

    fireEvent.keyDown(window, { key: "L", ctrlKey: true, shiftKey: true });
    expect(left.getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    await waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(await screen.findByText(/仅支持阅读/)).toBeTruthy();
    // Escape clears the temporary message before it could close anything.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/仅支持阅读/)).toBeNull();
  });

  it("returns to the open find bar when Ctrl+F repeats", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "在文中查找" });
    expect(document.activeElement).toBe(input);

    (document.activeElement as HTMLElement).blur();
    document.body.focus();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("leaves Enter and Escape to an input method while it composes", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "在文中查找" });

    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    expect(screen.queryByRole("search")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(screen.getByRole("search")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("closes the find bar with Escape before anything else", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(await screen.findByRole("search")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });
});

describe("the reserved pane and the window width", () => {
  it("collapses below 1200 and returns when widened, unless the user hid it", () => {
    const width = installWidth(960);
    try {
      render(<App transport={fakeTransport()} />);
      const right = screen.getByRole("button", { name: "预留侧栏" });

      // Narrow: pressing the switch records the wish but changes nothing.
      fireEvent.click(right);
      expect(right.getAttribute("aria-pressed")).toBe("false");
      expect(screen.queryByRole("complementary", { name: "预留侧栏" })).toBeNull();
      expect(screen.getByText(/加宽到 1200/)).toBeTruthy();

      // Widening shows it again (PRD §5.2).
      act(() => width.set(1280));
      expect(right.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("complementary", { name: "预留侧栏" })).toBeTruthy();

      // A manual hide is a decision: narrowing and widening keeps it hidden.
      fireEvent.click(right);
      act(() => width.set(960));
      act(() => width.set(1280));
      expect(right.getAttribute("aria-pressed")).toBe("false");
      expect(screen.queryByRole("complementary", { name: "预留侧栏" })).toBeNull();
    } finally {
      width.restore();
    }
  });
});

describe("dialog focus", () => {
  it("returns focus to the settings button after Escape", async () => {
    render(<App transport={fakeTransport()} />);
    const settings = screen.getByRole("button", { name: "设置" });
    settings.focus();
    fireEvent.click(settings);
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull());
    expect(document.activeElement).toBe(settings);
  });
});
