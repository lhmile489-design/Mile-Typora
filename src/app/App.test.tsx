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
    openFile: async () => ({ kind: "cancelled" }),
    openFolder: async () => ({ kind: "cancelled" }),
    openRequested: async () => ({ kind: "handedOff" }),
    openTreeFile: async () => ({ kind: "handedOff" }),
    openLink: async () => ({ kind: "none" }),
    scan: () => ({ abort: () => {}, done: Promise.resolve() }),
    ...overrides,
  };
}

describe("App shell", () => {
  it("renders the three panes and the status bar", () => {
    render(<App transport={fakeTransport()} />);
    expect(screen.getByRole("toolbar", { name: "工具栏" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "文件树" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    // The reserved pane starts collapsed (decisions.md D-T23).
    expect(screen.queryByRole("complementary", { name: "预留侧栏" })).toBeNull();
    expect(screen.getByText("开始阅读")).toBeTruthy();
  });

  it("keeps unwired toolbar commands visible but disabled", () => {
    render(<App transport={fakeTransport()} />);
    for (const name of ["刷新", "查找", "设置"]) {
      const b = screen.getByRole("button", { name });
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    // Wired commands work, so they are not disabled.
    for (const name of ["打开文件", "打开目录", "新建窗口", "左侧栏", "预留侧栏"]) {
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
    const right = screen.getByRole("button", { name: "预留侧栏" });
    expect(right.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(right);
    expect(screen.getByRole("complementary", { name: "预留侧栏" })).toBeTruthy();
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

  it("takes the requests queued before the handshake and opens them", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 2, path: "b.md" }] });
    const openRequested = vi.fn(async () => ({ kind: "handedOff" as const }));
    render(<App transport={fakeTransport({ pending, openRequested })} />);
    expect(await screen.findByText(/待打开：b\.md/)).toBeTruthy();
    // Go acknowledges the request once the page asked for it to be opened.
    expect(openRequested).toHaveBeenCalledWith(2);
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

const loadedDoc = {
  kind: "loaded" as const,
  doc: {
    name: "笔记.md",
    path: "E:\notes\笔记.md",
    size: 2048,
    hasBom: false,
    lineEnding: "LF",
    text: "# 标题\n\n正文",
    html: "<h1>标题</h1>\n<p>正文</p>",
    counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
  },
};

describe("opening a file", () => {
  it("shows the text, the read-only badge and the file details", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(await screen.findByRole("heading", { name: "标题" })).toBeTruthy();
    expect(screen.getByText("只读")).toBeTruthy();
    // The name shows in the file pane and in the status bar.
    expect(screen.getAllByText("笔记.md").length).toBeGreaterThan(0);
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("UTF-8")).toBeTruthy();
    expect(screen.getByText("LF")).toBeTruthy();
  });

  it("opens with Ctrl+O", () => {
    const openFile = vi.fn(async () => ({ kind: "cancelled" as const }));
    render(<App transport={fakeTransport({ openFile })} />);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("cancelling changes nothing", async () => {
    const openFile = vi.fn(async () => ({ kind: "cancelled" as const }));
    render(<App transport={fakeTransport({ openFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(await screen.findByText("开始阅读")).toBeTruthy();
    expect(screen.queryByText("只读")).toBeNull();
  });

  it("shows a load failure with its message and keeps the window usable", async () => {
    const openFile = async () => ({
      kind: "failed" as const,
      code: "encoding",
      message: "暂不支持此文件编码，请转换为 UTF-8",
    });
    render(<App transport={fakeTransport({ openFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(await screen.findByText("无法打开文件")).toBeTruthy();
    expect(screen.getByText(/暂不支持此文件编码/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新选择" })).toBeTruthy();
  });

  it("shows an empty document as valid, not as an error", async () => {
    const empty = { kind: "loaded" as const, doc: { ...loadedDoc.doc, text: "", html: "", size: 0 } };
    render(<App transport={fakeTransport({ openFile: async () => empty })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(await screen.findByText("这是一个空 Markdown 文件")).toBeTruthy();
    expect(screen.queryByText("无法打开文件")).toBeNull();
  });
});

describe("opening a folder", () => {
  const treeEntries = [
    { path: "sub", name: "sub", isDir: true },
    { path: "sub/b.md", name: "b.md", isDir: false },
    { path: "a.md", name: "a.md", isDir: false },
  ];

  function folderTransport(frameExtra: Record<string, unknown> = {}) {
    return fakeTransport({
      openFolder: async () => ({ kind: "opened", root: "E:\notes", name: "notes" }),
      scan: (onFrame) => {
        queueMicrotask(() => {
          onFrame({ entries: treeEntries, done: false } as never);
          onFrame({ entries: [], done: true, truncated: false, ...frameExtra } as never);
        });
        return { abort: () => {}, done: Promise.resolve() };
      },
    });
  }

  it("shows the tree as it streams in", async () => {
    render(<App transport={folderTransport()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    expect(await screen.findByRole("tree", { name: "文件树" })).toBeTruthy();
    expect(await screen.findByText("sub")).toBeTruthy();
    expect(screen.getByText("a.md")).toBeTruthy();
  });

  it("opens the folder with Ctrl+Shift+O", () => {
    const openFolder = vi.fn(async () => ({ kind: "cancelled" as const }));
    render(<App transport={fakeTransport({ openFolder })} />);
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
    expect(openFolder).toHaveBeenCalledTimes(1);
  });

  it("says when the scan stopped at a bound", async () => {
    render(<App transport={folderTransport({ truncated: true, bound: "markdown", skipped: 3 })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    expect(await screen.findByText(/结果不完整：达到文件数量上限，另有 3 项未包含/)).toBeTruthy();
  });

  it("selects a file with the keyboard", async () => {
    render(<App transport={folderTransport()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    const tree = await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });
    const selected = await screen.findByRole("treeitem", { name: /b\.md/, selected: true });
    expect(selected).toBeTruthy();
  });
});

describe("opening a file a request names", () => {
  it("opens the requested file as soon as the request arrives", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 4, path: "E:\notes\a.md" }] });
    const openRequested = vi.fn(async () => ({ kind: "file" as const, doc: loadedDoc.doc }));
    render(<App transport={fakeTransport({ pending, openRequested })} />);
    expect(await screen.findByRole("heading", { name: "标题" })).toBeTruthy();
    expect(openRequested).toHaveBeenCalledWith(4);
    expect(screen.getByText("只读")).toBeTruthy();
  });

  it("shows the failure of a requested file and keeps the window usable", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 5, path: "E:\notes\gone.md" }] });
    const openRequested = async () => ({
      kind: "failed" as const,
      code: "not_found",
      message: "文件不存在或已被移动",
    });
    render(<App transport={fakeTransport({ pending, openRequested })} />);
    expect(await screen.findByText("无法打开文件")).toBeTruthy();
    expect(screen.getByText(/文件不存在或已被移动/)).toBeTruthy();
  });
});

describe("the window matrix", () => {
  const entries = [
    { path: "sub", name: "sub", isDir: true },
    { path: "sub/b.md", name: "b.md", isDir: false },
    { path: "a.md", name: "a.md", isDir: false },
  ];

  function withTree(overrides: Parameters<typeof fakeTransport>[0] = {}) {
    return fakeTransport({
      openFolder: async () => ({ kind: "opened", root: "E:\notes", name: "notes" }),
      scan: (onFrame) => {
        queueMicrotask(() => {
          onFrame({ entries, done: false } as never);
          onFrame({ entries: [], done: true, truncated: false } as never);
        });
        return { abort: () => {}, done: Promise.resolve() };
      },
      ...overrides,
    });
  }

  it("opens a tree file in this window", async () => {
    const openTreeFile = vi.fn(async () => ({ kind: "handedOff" as const }));
    render(<App transport={withTree({ openTreeFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    fireEvent.mouseDown(await screen.findByText("a.md"));
    expect(openTreeFile).toHaveBeenCalledWith("a.md", false);
  });

  it("opens a tree file in a new window from its button", async () => {
    const openTreeFile = vi.fn(async () => ({ kind: "handedOff" as const }));
    render(<App transport={withTree({ openTreeFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    fireEvent.mouseDown(await screen.findByRole("button", { name: "在新窗口打开 a.md" }));
    expect(openTreeFile).toHaveBeenCalledWith("a.md", true);
  });

  it("starts browsing when a request names a folder", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 3, path: "E:\notes" }] });
    const openRequested = vi.fn(async () => ({ kind: "folder" as const, root: "E:\notes", name: "notes" }));
    const scan = vi.fn(() => ({ abort: () => {}, done: Promise.resolve() }));
    render(<App transport={fakeTransport({ pending, openRequested, scan })} />);
    expect(await screen.findByRole("tree", { name: "文件树" })).toBeTruthy();
    expect(scan).toHaveBeenCalled();
  });
});

describe("links in a document", () => {
  const doc = {
    kind: "loaded" as const,
    doc: {
      ...loadedDoc.doc,
      html: '<p><a href="https://example.com/x">外链</a> <a href="#安装步骤">锚点</a> <a href="x.png">附件</a></p><h2 id="安装步骤">安装步骤</h2>',
    },
  };

  it("asks Go about a click instead of navigating", async () => {
    const openLink = vi.fn(async () => ({ kind: "none" as const }));
    render(<App transport={fakeTransport({ openFile: async () => doc, openLink })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    const link = await screen.findByText("外链");
    fireEvent.click(link);
    expect(openLink).toHaveBeenCalledWith("https://example.com/x");
  });

  it("scrolls to an anchor", async () => {
    const scrolled: string[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function scroll(this: Element) {
        scrolled.push(this.id);
      },
    });
    const openLink = vi.fn(async () => ({ kind: "anchor" as const, anchor: encodeURIComponent("安装步骤") }));
    render(<App transport={fakeTransport({ openFile: async () => doc, openLink })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    const link = await screen.findByText("锚点");
    fireEvent.click(link);
    expect(openLink).toHaveBeenCalledWith("#安装步骤");
    expect(document.getElementById("安装步骤")).toBeTruthy();
    // The handler answers asynchronously: wait for the scroll.
    await waitFor(() => expect(scrolled).toContain("安装步骤"));
  });

  it("shows why an attachment does not open", async () => {
    const openLink = async () => ({ kind: "notice" as const, reason: "暂不支持打开此类附件" });
    render(<App transport={fakeTransport({ openFile: async () => doc, openLink })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByText("附件"));
    expect(await screen.findByText(/暂不支持打开此类附件/)).toBeTruthy();
  });
});
