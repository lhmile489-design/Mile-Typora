import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import type { DocUpdate, SaveOutcome, Transport } from "../lib/transport";

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
    saveAll: async () => ({ ok: true as const, value: 1 }),
    reportSaveAll: async () => ({ ok: true as const, value: undefined }),
    onSaveAllRequest: () => () => {},
    onSaveAllDone: () => () => {},
    readClipboardText: async () => ({ ok: true as const, value: "" }),
    writeClipboardText: async () => ({ ok: true as const, value: undefined }),
    openRecent: async () => ({ kind: "handedOff" as const }),
    removeRecent: async () => ({ ok: true as const, value: undefined }),
    onThemeChange: () => () => {},
    onDocUpdated: () => () => {},
    onTreeChanged: () => () => {},
    moveDocument: async () => ({ kind: "failed" as const, code: "no_file", message: "no file" }),
    trashDocument: async () => ({ kind: "failed" as const, code: "no_file", message: "no file" }),
    documentProperties: async () => ({ kind: "failed" as const, code: "no_file", message: "no file" }),
    revealDocument: async () => ({ kind: "failed" as const, code: "no_file", message: "no file" }),
    attachParentFolder: async () => ({ kind: "failed" as const, code: "no_file", message: "no file" }),
    onFileTrashed: () => () => {},
    extractOutline: async () => ({ kind: "ok" as const, headings: [], truncated: false }),
    searchDirectory: () => ({ abort: () => {}, done: Promise.resolve() }),
    pickImage: async () => ({ kind: "cancelled" as const }),
    copyImage: async () => ({ kind: "failed" as const, code: "not_found", message: "no image" }),
    copyPlainTextSource: async () => ({ kind: "copied" as const }),
    copyClipboardHTML: async () => ({ kind: "copied" as const }),
    copyImageToClipboard: async () => ({ kind: "copied" as const }),
    readClipboardImage: async () => ({ kind: "failed" as const, code: "no_image", message: "剪贴板中没有图片" }),
    cancelImage: async () => {},
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

  it("toggles bold from a keyboard shortcut and undoes it", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.keyDown(content, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("**正文**"));

    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("正文"));
    expect(content.textContent).not.toContain("**正文**");
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
  it("moves the current line with Alt+Down and undoes it", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "一\n二",
      html: "<h1>一</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "一" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(Array.from(document.querySelectorAll(".cm-line")).map((line) => line.textContent)).toEqual(["二", "一"]));
    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(Array.from(document.querySelectorAll(".cm-line")).map((line) => line.textContent)).toEqual(["一", "二"]));
  });

  it("replaces in source editing and undoes the whole replacement", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 12,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "foo bar\nbar",
      html: "<h1>foo bar</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "foo bar" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const query = await screen.findByRole("textbox", { name: "在文中查找" });
    fireEvent.change(query, { target: { value: "bar" } });
    expect(await screen.findByText("1 / 2")).toBeTruthy();

    const replacement = screen.getByRole("textbox", { name: "替换为" });
    fireEvent.change(replacement, { target: { value: "X" } });
    const lineTexts = () => Array.from(document.querySelectorAll(".cm-line")).map((line) => line.textContent);
    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    await waitFor(() => expect(lineTexts()).toEqual(["foo X", "bar"]));
    expect(await screen.findByText("1 / 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));
    await waitFor(() => expect(lineTexts()).toEqual(["foo X", "X"]));
    expect(content.textContent).not.toContain("bar");

    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(lineTexts()).toEqual(["foo X", "bar"]));
    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(lineTexts()).toEqual(["foo bar", "bar"]));
  });


  it("runs editor commands from the menu bar", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(<App transport={fakeTransport({ openFile: async () => ({ kind: "loaded" as const, doc }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "a", ctrlKey: true });

    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /加粗/ }));
    await waitFor(() => expect(content.textContent).toContain("**正文**"));
  });

  it("starts save-all from the file menu and reports the current window", async () => {
    let requestListener: ((requestId: number) => void) | null = null;
    let doneListener: ((summary: import("../lib/transport").SaveAllSummary) => void) | null = null;
    const saveAll = vi.fn(async () => ({ ok: true as const, value: 7 }));
    const reportSaveAll = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          saveAll,
          reportSaveAll,
          onSaveAllRequest: (listener) => {
            requestListener = listener;
            return () => {};
          },
          onSaveAllDone: (listener) => {
            doneListener = listener;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));

    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "保存全部…" }));
    expect(saveAll).toHaveBeenCalled();

    await act(async () => {
      requestListener?.(7);
    });
    await waitFor(() =>
      expect(reportSaveAll).toHaveBeenCalledWith(7, "笔记.md", "saved", ""),
    );

    await act(async () => {
      doneListener?.({
        requestId: 7,
        saved: 1,
        failed: 0,
        unhandled: 0,
        results: [{ windowId: 3, name: "笔记.md", status: "saved" }],
      });
    });
    expect(await screen.findByRole("dialog", { name: "保存全部" })).toBeTruthy();
    expect(screen.getByText("已保存 1 个，失败 0 个，未处理 0 个。")).toBeTruthy();
  });

  it("keeps local edits and offers reload or keep for an external change", async () => {
    let docListener: ((update: DocUpdate) => void) | null = null;
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    const external = { ...doc, hash: "outside", text: "# 外部\n", html: "<h1>外部</h1>" };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          onDocUpdated: (listener) => {
            docListener = listener;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));

    await act(async () => {
      docListener?.({ seq: 1, doc: external });
    });
    expect(await screen.findByText("文件已在外部修改。保存时仍会按冲突流程处理。")).toBeTruthy();
    expect(content.textContent).toContain("# 正文");

    fireEvent.click(screen.getByRole("button", { name: "保留当前编辑" }));
    await waitFor(() => expect(screen.queryByText("文件已在外部修改。保存时仍会按冲突流程处理。")).toBeNull());
    expect(content.textContent).toContain("# 正文");

    await act(async () => {
      docListener?.({ seq: 2, doc: external });
    });
    fireEvent.click(await screen.findByRole("button", { name: "重新载入磁盘版本…" }));
    fireEvent.click(await screen.findByRole("button", { name: "重新载入" }));
    await waitFor(() => expect(content.textContent).toContain("# 外部"));
    expect(content.textContent).not.toContain("# 正文");

    await act(async () => {
      docListener?.({ seq: 3, doc: { ...external, hash: "outside2", text: "# 外部2\n" } });
    });
    await waitFor(() => expect(content.textContent).toContain("# 外部2"));

    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await act(async () => {
      docListener?.({
        seq: 4,
        failure: { code: "not_found", detail: "文件已被删除" },
      });
    });
    expect(await screen.findByText("文件已被删除", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重新载入磁盘版本…" })).toBeNull();
  });

  it("keeps the buffer and shows the reason when saving fails", async () => {
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          saveDocument: async () => ({
            kind: "failed" as const,
            code: "save_failed",
            message: "保存失败，文件可能被占用或没有写入权限",
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(await screen.findByText("保存失败，文件可能被占用或没有写入权限")).toBeTruthy();
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(content.textContent).toContain("# 正文");
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("keeps typing during a save dirty instead of marking it saved", async () => {
    let finishSave: ((outcome: SaveOutcome) => void) | null = null;
    const saveDocument = vi.fn(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finishSave = resolve;
        }),
    );
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          saveDocument,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledWith("# 正文", false));
    fireEvent.keyDown(content, { key: "2", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("## 正文"));

    await act(async () => {
      finishSave?.({
        kind: "saved",
        path: "E:/notes/笔记.md",
        name: "笔记.md",
        size: 6,
        hash: "saved-hash",
        hasBom: false,
        lineEnding: "LF",
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("未保存")).toBeTruthy();
    expect(content.textContent).toContain("## 正文");
  });

  it("reports a window with an external-change prompt as unhandled for save-all", async () => {
    let docListener: ((update: DocUpdate) => void) | null = null;
    let requestListener: ((requestId: number) => void) | null = null;
    const reportSaveAll = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          onDocUpdated: (listener) => {
            docListener = listener;
            return () => {};
          },
          onSaveAllRequest: (listener) => {
            requestListener = listener;
            return () => {};
          },
          reportSaveAll,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "1", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("# 正文"));

    await act(async () => {
      docListener?.({ seq: 1, doc: { ...doc, hash: "outside", text: "# 外部\n" } });
    });
    expect(await screen.findByText("文件已在外部修改。保存时仍会按冲突流程处理。")).toBeTruthy();

    await act(async () => {
      requestListener?.(9);
    });
    await waitFor(() =>
      expect(reportSaveAll).toHaveBeenCalledWith(9, "笔记.md", "unhandled", "窗口有未处理的保存提示"),
    );
  });

  it("keeps a deleted file marked unsaved after dismissing the banner", async () => {
    let docListener: ((update: DocUpdate) => void) | null = null;
    const doc = {
      name: "笔记.md",
      path: "E:/notes/笔记.md",
      size: 6,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "正文",
      html: "<h1>正文</h1>",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    render(
      <App
        transport={fakeTransport({
          openFile: async () => ({ kind: "loaded" as const, doc }),
          onDocUpdated: (listener) => {
            docListener = listener;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "正文" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    expect(screen.queryByText("未保存")).toBeNull();

    await act(async () => {
      docListener?.({ seq: 1, failure: { code: "not_found", detail: "文件已被删除" } });
    });
    expect(await screen.findByText("文件已被删除")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保留当前编辑" }));
    await waitFor(() => expect(screen.queryByText("文件已被删除")).toBeNull());
    expect(screen.getByText("未保存")).toBeTruthy();
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
