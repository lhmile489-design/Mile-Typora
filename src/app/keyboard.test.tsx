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
    newDocument: async () => ({ ok: true as const, value: 3 }),
    clearStartUntitled: async () => {},
    readClipboardText: async () => ({ ok: true as const, value: "" }),
    writeClipboardText: async () => ({ ok: true as const, value: undefined }),
    openRecent: async () => ({ kind: "handedOff" as const }),
    removeRecent: async () => ({ ok: true as const, value: undefined }),
    onThemeChange: () => () => {},
    onDocUpdated: () => () => {},
    onTreeChanged: () => () => {},
    onNotice: () => () => {},
    onCloseRequested: () => () => {},
    saveDocument: async () => ({
      kind: "saved" as const,
      path: "",
      name: "",
      size: 0,
      hash: "",
      hasBom: false,
      lineEnding: "LF",
    }),
    saveDocumentAs: async () => ({
      kind: "saved" as const,
      path: "",
      name: "",
      size: 0,
      hash: "",
      hasBom: false,
      lineEnding: "LF",
    }),
    setEditState: async () => {},
    refresh: async () => ({ kind: "cancelled" as const }),
    closeDocument: async () => ({ ok: true as const, value: undefined }),
    closeWindow: async () => ({ ok: true as const, value: undefined }),
    renderSource: async (text: string) => ({
      kind: "ok" as const,
      html: `<h1>${text.replace(/^#+\s*/, "")}</h1>`,
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    }),
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

describe("exception feedback", () => {
  it("shows the empty folder state", async () => {
    const scan = vi.fn((onFrame: Parameters<Transport["scan"]>[0]) => {
      onFrame({ entries: [], done: true, truncated: false } as Parameters<typeof onFrame>[0]);
      return { abort: () => {}, done: Promise.resolve() };
    });
    render(
      <App
        transport={fakeTransport({
          openFolder: async () => ({ kind: "opened" as const, root: "E:/empty", name: "empty" }),
          scan,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    expect(await screen.findByText("此目录下未找到 Markdown 文件")).toBeTruthy();
  });

  it("says when a scan is partial and what it skipped", async () => {
    const scan = vi.fn((onFrame: Parameters<Transport["scan"]>[0]) => {
      onFrame({
        entries: [{ path: "a.md", name: "a.md", isDir: false }],
        done: true,
        truncated: false,
        skipped: 1,
        unreadable: 2,
      } as Parameters<typeof onFrame>[0]);
      return { abort: () => {}, done: Promise.resolve() };
    });
    render(
      <App
        transport={fakeTransport({
          openFolder: async () => ({ kind: "opened" as const, root: "E:/notes", name: "notes" }),
          scan,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    expect(await screen.findByText(/部分目录无法访问（2 个）/)).toBeTruthy();
    expect(screen.getByText(/已跳过 1 项/)).toBeTruthy();
  });

  it("reselects a folder with the folder dialog after a folder failure", async () => {
    const openFolder = vi.fn(async () => ({
      kind: "failed" as const,
      code: "unsupported_type",
      message: "请选择一个文件夹",
    }));
    render(<App transport={fakeTransport({ openFolder })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    expect(await screen.findByText("无法打开文件夹")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新选择" }));
    await waitFor(() => expect(openFolder).toHaveBeenCalledTimes(2));
  });

  it("keeps the open document when another open fails", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    let calls = 0;
    render(
      <App
        transport={fakeTransport({
          openFile: async () => {
            calls += 1;
            if (calls === 1) return { kind: "loaded" as const, doc };
            return { kind: "failed" as const, code: "encoding", message: "暂不支持此文件编码" };
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(await screen.findByText(/暂不支持此文件编码/)).toBeTruthy();
    // The document that was open stays (PRD §7.1 combined states).
    expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();
  });

  it("keeps a recent entry that is merely too large", async () => {
    const removeRecent = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(
      <App
        transport={fakeTransport({
          getSettings: async () => ({
            kind: "ok" as const,
            settings: {
              startup: "blank",
              appearance: "system",
              recent: [{ path: "E:/big.md", name: "big.md", isDir: false }],
            },
            corrupt: false,
          }),
          openRecent: async () => ({
            kind: "failed" as const,
            code: "too_large",
            message: "文件超过读取上限：11 MB，上限 10 MB",
          }),
          removeRecent,
        })}
      />,
    );
    fireEvent.click(await screen.findByTitle("E:/big.md"));
    expect(await screen.findByText(/big\.md 不可用/)).toBeTruthy();
    expect(screen.getByTitle("E:/big.md")).toBeTruthy();
    expect(removeRecent).not.toHaveBeenCalled();
  });

  it("shows an app notice from the backend", async () => {
    let sendNotice: (notice: { text: string }) => void = () => {};
    render(
      <App
        transport={fakeTransport({
          onNotice: (listener) => {
            sendNotice = listener;
            return () => {};
          },
        })}
      />,
    );
    act(() => sendNotice({ text: "打开请求太多，请稍后再试" }));
    expect(await screen.findByText("打开请求太多，请稍后再试")).toBeTruthy();
  });

  it("replaces an image that fails to load with its reason", async () => {
    const doc = {
      name: "图.md",
      path: "E:/notes/图.md",
      size: 64,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "![示意图](图.png)",
      html: '<p><img src="http://mtres.localhost/missing" alt="示意图"></p>',
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const { container } = render(
      <App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("img", { name: "示意图" });
    fireEvent.error(container.querySelector("img")!);
    const box = container.querySelector(".limited[data-kind='image']");
    expect(box).toBeTruthy();
    expect(box?.getAttribute("data-reason")).toBe("图片无法加载");
    expect(box?.textContent).toBe("示意图");
  });

  it("drops an unavailable recent entry and says why", async () => {
    const removeRecent = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(
      <App
        transport={fakeTransport({
          getSettings: async () => ({
            kind: "ok" as const,
            settings: {
              startup: "blank",
              appearance: "system",
              recent: [{ path: "E:/gone.md", name: "gone.md", isDir: false }],
            },
            corrupt: false,
          }),
          openRecent: async () => ({
            kind: "failed" as const,
            code: "not_found",
            message: "文件不存在或已被移动",
          }),
          removeRecent,
        })}
      />,
    );
    const row = await screen.findByTitle("E:/gone.md");
    fireEvent.click(row);
    expect(await screen.findByText(/gone\.md 不可用：文件不存在/)).toBeTruthy();
    expect(screen.queryByTitle("E:/gone.md")).toBeNull();
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith("E:/gone.md"));
  });
});

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
    expect(await screen.findByText(/阅读模式没有可保存的修改/)).toBeTruthy();
    // Escape clears the temporary message before it could close anything.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/阅读模式没有可保存的修改/)).toBeNull();
  });

  it("returns to the open find bar when Ctrl+F repeats", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
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
      hash: "",
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

  it("starts an unsaved document with Ctrl+N", async () => {
    render(<App transport={fakeTransport()} />);
    await screen.findByText("窗口 3 · v0.1.0");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(await screen.findByText("编辑中")).toBeTruthy();
    expect(screen.getAllByText("未命名-1").length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 })).toBeTruthy();
  });

  it("toggles source editing and preview with Ctrl+/", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const renderSource = vi.fn(async (text: string) => ({
      kind: "ok" as const,
      html: `<h1>${text.replace(/^#+\s*/, "")}</h1>`,
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          renderSource,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("编辑中")).toBeTruthy();

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await waitFor(() => expect(renderSource).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "标题" })).toBeTruthy();
    expect(screen.getByText("预览")).toBeTruthy();

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await waitFor(() => expect(screen.queryByText("预览")).toBeNull());
  });

  it("copies the selection as Markdown with Ctrl+Shift+C", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const writeClipboardText = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          writeClipboardText,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });

    fireEvent.keyDown(content, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("# 标题"));
    expect(await screen.findByText("已复制源码")).toBeTruthy();
  });

  it("pastes plain text from the native clipboard and undoes it in one step", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "# 标题",
      html: "<h1>标题</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const readClipboardText = vi.fn(async () => ({ ok: true as const, value: "粘贴内容" }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          readClipboardText,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });

    fireEvent.keyDown(content, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(content.textContent).toContain("粘贴内容"));

    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 标题"));
  });

  it("applies paragraph commands only while the source editor has focus", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 12,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文\n第二行",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));
    expect(screen.getByText("未保存")).toBeTruthy();

    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(content.textContent).not.toContain("# 正文"));

    screen.getByRole("button", { name: "打开文件" }).focus();
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(content.textContent).not.toContain("## 正文");
  });

  it("does not run paragraph commands in preview", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 12,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const renderSource = vi.fn(async (text: string) => ({
      kind: "ok" as const,
      html: `<h1>${text.replace(/^#+\s*/, "")}</h1>`,
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          renderSource,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await waitFor(() => expect(renderSource).toHaveBeenCalledTimes(1));
    expect(screen.getByText("预览")).toBeTruthy();

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(renderSource).toHaveBeenCalledTimes(1);
  });

  it("closes the find bar with Escape before anything else", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 32,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
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

describe("folder changes", () => {
  it("rescans the tree when the folder changes outside the app", async () => {
    let sendTree: () => void = () => {};
    const scan = vi.fn((onFrame: Parameters<Transport["scan"]>[0]) => {
      onFrame({
        entries: [{ path: "a.md", name: "a.md", isDir: false }],
        done: true,
        truncated: false,
      } as Parameters<typeof onFrame>[0]);
      return { abort: () => {}, done: Promise.resolve() };
    });
    render(
      <App
        transport={fakeTransport({
          openFolder: async () => ({ kind: "opened" as const, root: "E:/notes", name: "notes" }),
          scan,
          onTreeChanged: (listener) => {
            sendTree = listener;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByText("a.md");
    expect(scan).toHaveBeenCalledTimes(1);

    act(() => sendTree());
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2), { timeout: 1500 });
  });

  it("keeps the folder context when the root becomes unavailable", async () => {
    let sendTree: () => void = () => {};
    let calls = 0;
    const scan = vi.fn((onFrame: Parameters<Transport["scan"]>[0]) => {
      calls += 1;
      if (calls === 1) {
        onFrame({
          entries: [{ path: "a.md", name: "a.md", isDir: false }],
          done: true,
          truncated: false,
        } as Parameters<typeof onFrame>[0]);
      } else {
        onFrame({
          done: true,
          entries: [],
          truncated: false,
          failure: { code: "scan_failed", detail: "无法读取此文件夹" },
        } as Parameters<typeof onFrame>[0]);
      }
      return { abort: () => {}, done: Promise.resolve() };
    });
    render(
      <App
        transport={fakeTransport({
          openFolder: async () => ({ kind: "opened" as const, root: "E:/notes", name: "notes" }),
          scan,
          onTreeChanged: (listener) => {
            sendTree = listener;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByText("a.md");

    act(() => sendTree());
    expect(await screen.findByText(/无法读取此文件夹，显示上次结果/, undefined, { timeout: 1500 })).toBeTruthy();
    // The folder stays the window's context and the last usable rows stay.
    expect(screen.getByText("notes")).toBeTruthy();
    expect(screen.getByText("a.md")).toBeTruthy();
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
