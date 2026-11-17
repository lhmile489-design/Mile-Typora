import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    getSettings: async () => ({
      kind: "ok" as const,
      settings: { startup: "blank", appearance: "system", showStatusBar: true, recent: [] },
      corrupt: false,
    }),
    saveSettings: async () => ({ ok: true as const, value: undefined }),
    onSettingsChange: () => () => {},
    getWindowView: async () => ({
      kind: "ok" as const,
      state: { fullScreen: false, alwaysOnTop: false, zoom: 1 },
    }),
    setFullScreen: async (value) => ({
      kind: "ok" as const,
      state: { fullScreen: value, alwaysOnTop: false, zoom: 1 },
    }),
    setAlwaysOnTop: async (value) => ({
      kind: "ok" as const,
      state: { fullScreen: false, alwaysOnTop: value, zoom: 1 },
    }),
    setZoom: async (zoom) => ({ kind: "ok" as const, state: { fullScreen: false, alwaysOnTop: false, zoom } }),
    cycleWindow: async () => ({ ok: true as const, value: undefined }),
    countWords: async () => ({
      kind: "ok" as const,
      count: { characters: 0, charactersNoSpaces: 0, words: 0, paragraphs: 0 },
    }),
    clearRecent: async () => ({ ok: true as const, value: undefined }),
    newDocument: async () => ({ ok: true as const, value: 3 }),
    clearStartUntitled: async () => {},
    importDocument: async () => ({ kind: "cancelled" as const }),
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
    exportHTML: async () => ({ kind: "exported" as const, path: "", warnings: [] }),
    exportPDF: async () => ({ kind: "exported" as const, path: "", warnings: [] }),
    printDocument: async () => ({ kind: "printed" as const, warnings: [] }),
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
    renderSource: async (text: string) => ({
      kind: "ok" as const,
      html: `<h1>${text.replace(/^#+\s*/, "")}</h1>`,
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    }),
    closeDocument: async () => ({ ok: true as const, value: undefined }),
    closeWindow: async () => ({ ok: true as const, value: undefined }),
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
    for (const name of ["刷新"]) {
      const b = screen.getByRole("button", { name });
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    // Wired commands work, so they are not disabled.
    for (const name of ["打开文件", "打开目录", "新建窗口", "查找", "设置", "左侧栏", "预留侧栏"]) {
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
    path: "E:/notes\笔记.md",
    size: 2048,
    hasBom: false,
    lineEnding: "LF",
    hash: "",
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
      openFolder: async () => ({ kind: "opened", root: "E:/notes", name: "notes" }),
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
    const transport = fakeTransport({
      openFolder: async () => ({ kind: "opened", root: "E:/notes", name: "notes" }),
      scan: (onFrame) => {
        queueMicrotask(() => {
          onFrame({ entries: treeEntries, done: false } as never);
          onFrame({ entries: [], done: true, truncated: false } as never);
        });
        return { abort: () => {}, done: Promise.resolve() };
      },
      openTreeFile: async (rel) => ({
        kind: "file" as const,
        rel,
        doc: { ...loadedDoc.doc, name: "b.md", path: `E:/notes/${rel}` },
      }),
    });
    render(<App transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    const tree = await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });
    const selected = await screen.findByRole("treeitem", { name: /b\.md/, selected: true });
    expect(selected).toBeTruthy();
  });
});

describe("file operations", () => {
  it("moves the current file from the file menu", async () => {
    const moveDocument = vi.fn(async () => ({
      kind: "done" as const,
      path: "E:/archive/笔记.md",
      name: "笔记.md",
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, moveDocument })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /移动到/ }));
    await waitFor(() => expect(moveDocument).toHaveBeenCalledWith(""));
    expect(await screen.findByText("已移动：笔记.md")).toBeTruthy();
  });

  it("confirms before moving a file to the recycle bin", async () => {
    const trashDocument = vi.fn(async () => ({
      kind: "done" as const,
      path: "E:/notes/笔记.md",
      name: "笔记.md",
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, trashDocument })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }));
    expect(await screen.findByRole("dialog", { name: "移至回收站？" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "移至回收站？" }).textContent).toContain("笔记.md");
    expect(trashDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移至回收站" }));
    await waitFor(() => expect(trashDocument).toHaveBeenCalledWith(""));
    expect(await screen.findByText("已移至回收站：笔记.md")).toBeTruthy();
  });

  it("shows the read-only properties dialog", async () => {
    const documentProperties = vi.fn(async () => ({
      kind: "ok" as const,
      properties: {
        name: "笔记.md",
        path: "E:/notes/笔记.md",
        size: 2048,
        encoding: "UTF-8",
        lineEnding: "LF",
        modified: "2026-11-17T03:00:00Z",
        readOnly: false,
      },
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, documentProperties })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /属性/ }));
    expect(await screen.findByRole("dialog", { name: "文件属性" })).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "文件属性" });
    expect(within(dialog).getByText("E:/notes/笔记.md")).toBeTruthy();
    expect(within(dialog).getByText("UTF-8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("keeps the buffer when another window trashes the file", async () => {
    let listener: ((event: { path: string; name: string }) => void) | null = null;
    render(
      <App
        transport={fakeTransport({
          openFile: async () => loadedDoc,
          onFileTrashed: (callback) => {
            listener = callback;
            return () => {};
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    await act(async () => {
      listener?.({ path: loadedDoc.doc.path, name: "笔记.md" });
    });
    expect(await screen.findByText("笔记.md 已移至回收站")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保留当前查看" }));
    await waitFor(() => expect(screen.queryByText("笔记.md 已移至回收站")).toBeNull());
  });

  it("moves after discarding changes without a dirty_other false positive", async () => {
    const moveDocument = vi.fn(async () => ({
      kind: "done" as const,
      path: "E:/archive/笔记.md",
      name: "笔记.md",
    }));
    const setEditState = vi.fn(async () => {});
    render(
      <App
        transport={fakeTransport({
          openFile: async () => loadedDoc,
          moveDocument,
          setEditState,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "2", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("## 标题"));

    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /移动到/ }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(moveDocument).toHaveBeenCalled());
    const editOrder = setEditState.mock.invocationCallOrder[0] ?? 0;
    const moveOrder = moveDocument.mock.invocationCallOrder[0] ?? 0;
    expect(editOrder).toBeLessThan(moveOrder);
  });

  it("inserts a table and an alert from the paragraph menu", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "段落" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /插入表格/ }));
    const dialog = await screen.findByRole("dialog", { name: "插入表格" });
    fireEvent.click(within(dialog).getByRole("button", { name: "插入" }));
    await waitFor(() => expect(content.textContent).toContain("| 列 1 | 列 2 |"));

    fireEvent.click(screen.getByRole("menuitem", { name: "段落" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /注意框/ }));
    await waitFor(() => expect(content.textContent).toContain("> [!NOTE]"));

    content.focus();
    fireEvent.keyDown(content, { key: "u", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("<u></u>"));
  });

  it("edits, copies and removes a link from the format submenu", async () => {
    const linkDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "[文字](https://a.example)", html: '<p><a href="https://a.example">文字</a></p>' },
    };
    const writeClipboardText = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ openFile: async () => linkDoc, writeClipboardText })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByText("文字");
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "链接操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑地址…" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑链接地址" });
    fireEvent.change(within(dialog).getByLabelText("地址"), { target: { value: "https://b.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(content.textContent).toContain("[文字](https://b.example)"));

    content.focus();
    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "链接操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制链接地址" }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("https://b.example"));

    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "链接操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移除链接" }));
    await waitFor(() => expect(content.textContent).toBe("文字"));
  });

  it("copies a chosen image into assets and inserts its Markdown", async () => {
    const pickImage = vi.fn(async () => ({
      kind: "picked" as const,
      token: "t1",
      name: "图.png",
      target: "E:/notes/assets/图.png",
      size: 1024,
    }));
    const copyImage = vi.fn(async () => ({
      kind: "copied" as const,
      path: "E:/notes/assets/图.png",
      markdown: "assets/%E5%9B%BE.png",
      name: "图.png",
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, pickImage, copyImage })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /插入图片/ }));
    const dialog = await screen.findByRole("dialog", { name: "复制图片到文档资源目录？" });
    expect(dialog.textContent).toContain("E:/notes/assets/图.png");
    fireEvent.click(within(dialog).getByRole("button", { name: "复制并插入" }));

    await waitFor(() => expect(copyImage).toHaveBeenCalledWith("t1"));
    expect(content.textContent).toContain("![图](assets/%E5%9B%BE.png)");
  });

  it("replaces the image syntax under the cursor and keeps the old file", async () => {
    const imageDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "![图](assets/a.png)", html: '<p><img alt="图"></p>' },
    };
    const pickImage = vi.fn(async () => ({
      kind: "picked" as const,
      token: "t2",
      name: "b.png",
      target: "E:/notes/assets/b.png",
      size: 1024,
    }));
    const copyImage = vi.fn(async () => ({
      kind: "copied" as const,
      path: "E:/notes/assets/b.png",
      markdown: "assets/b.png",
      name: "b.png",
    }));
    render(<App transport={fakeTransport({ openFile: async () => imageDoc, pickImage, copyImage })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(document.querySelector(".reader img")).not.toBeNull());
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "格式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /更换图片/ }));
    const dialog = await screen.findByRole("dialog", { name: "复制并替换图片？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "复制并替换" }));

    await waitFor(() => expect(content.textContent).toContain("![图](assets/b.png)"));
    expect(content.textContent).not.toContain("assets/a.png");
  });

  it("copies source selections as plain text, HTML and simplified HTML", async () => {
    const copyPlainTextSource = vi.fn(async () => ({ kind: "copied" as const }));
    const copyClipboardHTML = vi.fn(async () => ({ kind: "copied" as const }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => loadedDoc,
          copyPlainTextSource,
          copyClipboardHTML,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(content, { key: "a", ctrlKey: true });

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制为纯文本" }));
    await waitFor(() => expect(copyPlainTextSource).toHaveBeenCalledWith("# 标题\n\n正文"));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制为 HTML 代码" }));
    await waitFor(() => expect(copyClipboardHTML).toHaveBeenCalledWith("# 标题\n\n正文", true, false));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制内容并简化格式" }));
    await waitFor(() => expect(copyClipboardHTML).toHaveBeenCalledWith("# 标题\n\n正文", true, true));
  });

  it("copies a reading selection as HTML through the DOM fragment", async () => {
    const copyClipboardHTML = vi.fn(async () => ({ kind: "copied" as const }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, copyClipboardHTML })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    const heading = await screen.findByRole("heading", { name: "标题" });
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    const item = screen.getByRole("menuitem", { name: "复制为 HTML 代码" });
    expect(item.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(item);
    await waitFor(() =>
      expect(copyClipboardHTML).toHaveBeenCalledWith(
        expect.stringContaining("<h1>标题</h1>"),
        false,
        false,
      ),
    );
  });

  it("copies the image under the editor caret and the image selected in the reader", async () => {
    const imageDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "![图](assets/a.png)", html: '<p><img alt="图" src="http://mtres.localhost/token"></p>' },
    };
    const copyImageToClipboard = vi.fn(async () => ({ kind: "copied" as const }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => imageDoc,
          copyImageToClipboard,
          renderSource: async () => ({
            kind: "ok" as const,
            html: '<p><img alt="图" src="http://mtres.localhost/token"></p>',
            counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(document.querySelector(".markdown img")).not.toBeNull());
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "拷贝图片" }));
    await waitFor(() => expect(copyImageToClipboard).toHaveBeenCalledWith("assets/a.png"));

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const image = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>(".markdown img");
      expect(found).not.toBeNull();
      return found!;
    });
    const range = document.createRange();
    range.selectNode(image);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "拷贝图片" }));
    await waitFor(() =>
      expect(copyImageToClipboard).toHaveBeenCalledWith("http://mtres.localhost/token"),
    );
  });

  it("pastes clipboard text on Ctrl+V and falls back to an image", async () => {
    const readClipboardText = vi.fn(async () => ({ ok: true as const, value: "粘贴文本" }));
    const insertDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "正文", html: "<p>正文</p>" },
    };
    const { unmount } = render(
      <App transport={fakeTransport({ openFile: async () => insertDoc, readClipboardText })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByText("正文");
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("粘贴文本"));
    unmount();

    const pick = vi.fn(async () => ({
      kind: "picked" as const,
      token: "p1",
      name: "粘贴图片.png",
      target: "E:/notes/assets/粘贴图片.png",
      size: 1024,
    }));
    const copyImage = vi.fn(async () => ({
      kind: "copied" as const,
      path: "E:/notes/assets/粘贴图片.png",
      markdown: "assets/%E7%B2%98%E8%B4%B4%E5%9B%BE%E7%89%87.png",
      name: "粘贴图片.png",
    }));
    render(
      <App
        transport={fakeTransport({
          openFile: async () => insertDoc,
          readClipboardText: async () => ({ ok: true, value: "" }),
          readClipboardImage: pick,
          copyImage,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByText("正文");
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const imageContent = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    imageContent.focus();
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "复制图片到文档资源目录？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "复制并插入" }));
    await waitFor(() => expect(imageContent.textContent).toContain("![粘贴图片](assets/%E7%B2%98%E8%B4%B4%E5%9B%BE%E7%89%87.png)"));
  });

  it("exports HTML and PDF from the file menu", async () => {
    const exportHTML = vi.fn(async () => ({
      kind: "exported" as const,
      path: "E:/notes/笔记.html",
      warnings: [],
    }));
    const exportPDF = vi.fn(async () => ({
      kind: "exported" as const,
      path: "E:/notes/笔记.pdf",
      warnings: ["图片超过 20 MiB，已省略"],
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, exportHTML, exportPDF })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });

    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "HTML…" }));
    await waitFor(() =>
      expect(exportHTML).toHaveBeenCalledWith(expect.stringContaining("<h1>标题</h1>"), "笔记"),
    );
    expect(await screen.findByText(/已导出到 E:\/notes\/笔记\.html/)).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF…" }));
    const dialog = await screen.findByRole("dialog", { name: "PDF 已导出" });
    expect(dialog.textContent).toContain("图片超过 20 MiB");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "PDF 已导出" })).toBeNull();
  });

  it("prints through the dedicated print view with Alt+Shift+P", async () => {
    const printDocument = vi.fn(async () => ({ kind: "printed" as const, warnings: [] }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, printDocument })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });

    fireEvent.keyDown(window, { key: "p", altKey: true, shiftKey: true });
    await waitFor(() =>
      expect(printDocument).toHaveBeenCalledWith(expect.stringContaining("<h1>标题</h1>"), "笔记"),
    );
    expect(await screen.findByText("已打开打印预览")).toBeTruthy();
  });

  it("explains that focus and typewriter modes need source editing", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "F8" });
    expect(await screen.findByText("专注模式只在编辑模式可用")).toBeTruthy();
    fireEvent.keyDown(window, { key: "F9" });
    expect(await screen.findByText("打字机模式只在编辑模式可用")).toBeTruthy();
  });

  it("toggles focus and typewriter modes in the editor", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    fireEvent.keyDown(window, { key: "F8" });
    await waitFor(() => expect(document.querySelector(".cm-focus-dim")).not.toBeNull());
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /专注模式/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /打字机模式/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /打字机模式/ }).getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("changes fullscreen and zoom only through the view bindings", async () => {
    const setFullScreen = vi.fn(async (value: boolean) => ({
      kind: "ok" as const,
      state: { fullScreen: value, alwaysOnTop: false, zoom: 1 },
    }));
    const setZoom = vi.fn(async (zoom: number) => ({
      kind: "ok" as const,
      state: { fullScreen: false, alwaysOnTop: false, zoom },
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, setFullScreen, setZoom })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(setFullScreen).toHaveBeenCalledWith(true));
    fireEvent.keyDown(window, { key: "=", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(setZoom).toHaveBeenCalledWith(1.1));
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    expect(screen.getByText("缩放：110%")).toBeTruthy();
  });

  it("switches windows with Ctrl+Tab and shows word statistics", async () => {
    const cycleWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const countWords = vi.fn(async () => ({
      kind: "ok" as const,
      count: { characters: 12, charactersNoSpaces: 10, words: 5, paragraphs: 2 },
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, cycleWindow, countWords })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => expect(cycleWindow).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "字数统计…" }));
    const dialog = await screen.findByRole("dialog", { name: "字数统计" });
    expect(dialog.textContent).toContain("12");
    expect(dialog.textContent).toContain("5");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  });

  it("keeps a connection failure visible with the status bar hidden", async () => {
    render(
      <App
        transport={fakeTransport({
          ready: async () => ({ ok: false as const, message: "绑定不可用" }),
          getSettings: async () => ({
            kind: "ok" as const,
            settings: { startup: "blank", appearance: "system", showStatusBar: false, recent: [] },
            corrupt: false,
          }),
        })}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("绑定不可用");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("persists the status bar preference from the view menu", async () => {
    const saveSettings = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, saveSettings })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "显示状态栏" }));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ showStatusBar: false })),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps keyboard control of a menu opened with the mouse", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    const format = screen.getByRole("menuitem", { name: "格式" });
    fireEvent.mouseDown(format);
    expect(document.activeElement).toBe(format);
    fireEvent.click(format);
    expect(screen.getByRole("menu", { name: "格式" })).toBeTruthy();
    fireEvent.keyDown(format, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "格式" })).toBeNull();
  });

  it("attaches the parent folder when showing a single file in the sidebar", async () => {
    const attachParentFolder = vi.fn(async () => ({
      kind: "attached" as const,
      root: "E:/notes",
      name: "notes",
      rel: "笔记.md",
    }));
    const scan = vi.fn((onFrame: (frame: unknown) => void) => {
      queueMicrotask(() => {
        onFrame({ entries: [{ path: "笔记.md", name: "笔记.md", isDir: false }], done: false });
        onFrame({ entries: [], done: true, truncated: false });
      });
      return { abort: () => {}, done: Promise.resolve() };
    });
    render(
      <App
        transport={fakeTransport({
          openFile: async () => loadedDoc,
          attachParentFolder,
          scan: scan as never,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在侧边栏中显示" }));
    const dialog = await screen.findByRole("dialog", { name: "打开所在目录？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "打开目录" }));
    await waitFor(() => expect(attachParentFolder).toHaveBeenCalledTimes(1));
    const tree = await screen.findByRole("tree", { name: "文件树" });
    expect(within(tree).getByText("笔记.md")).toBeTruthy();
  });

  it("shows unsaved properties locally for an untitled document", async () => {
    const documentProperties = vi.fn();
    render(<App transport={fakeTransport({ documentProperties })} />);
    await screen.findByText("窗口 3 · v0.1.0");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await screen.findAllByText("未命名-1");
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /属性/ }));
    const dialog = await screen.findByRole("dialog", { name: "文件属性" });
    expect(within(dialog).getByText("尚未保存")).toBeTruthy();
    expect(documentProperties).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("asks for confirmation when Delete is pressed in the tree", async () => {
    const trashDocument = vi.fn(async () => ({
      kind: "done" as const,
      path: "E:/notes/sub/b.md",
      name: "b.md",
    }));
    render(
      <App
        transport={fakeTransport({
          openFolder: async () => ({ kind: "opened", root: "E:/notes", name: "notes" }),
          scan: (onFrame) => {
            queueMicrotask(() => {
              onFrame({
                entries: [
                  { path: "sub", name: "sub", isDir: true },
                  { path: "sub/b.md", name: "b.md", isDir: false },
                ],
                done: false,
              } as never);
              onFrame({ entries: [], done: true, truncated: false } as never);
            });
            return { abort: () => {}, done: Promise.resolve() };
          },
          trashDocument,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    const tree = await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Delete" });
    expect(await screen.findByRole("dialog", { name: "移至回收站？" })).toBeTruthy();
    expect(trashDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移至回收站" }));
    await waitFor(() => expect(trashDocument).toHaveBeenCalledWith("sub/b.md"));
  });
});

describe("left views and directory search", () => {
  const treeEntries = [
    { path: "sub", name: "sub", isDir: true },
    { path: "sub/a.md", name: "a.md", isDir: false },
    { path: "a.md", name: "a.md", isDir: false },
    { path: "b.md", name: "b.md", isDir: false },
  ];

  function folderWith(overrides: Partial<Transport> = {}) {
    return fakeTransport({
      openFolder: async () => ({ kind: "opened", root: "E:/notes", name: "notes" }),
      scan: (onFrame) => {
        queueMicrotask(() => {
          onFrame({ entries: treeEntries, done: false } as never);
          onFrame({ entries: [], done: true, truncated: false } as never);
        });
        return { abort: () => {}, done: Promise.resolve() };
      },
      ...overrides,
    });
  }

  it("switches to the outline and back to the tree", async () => {
    const extractOutline = vi.fn(async () => ({
      kind: "ok" as const,
      headings: [
        { level: 1, text: "标题", line: 1 },
        { level: 2, text: "小节", line: 3 },
      ],
      truncated: false,
    }));
    render(
      <App
        transport={folderWith({
          openTreeFile: async (rel) => ({
            kind: "file" as const,
            rel,
            doc: { ...loadedDoc.doc, name: "b.md", path: `E:/notes/${rel}` },
          }),
          extractOutline,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByRole("tree", { name: "文件树" });
    fireEvent.mouseDown(await screen.findByRole("treeitem", { name: /b\.md/ }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "!", ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole("complementary", { name: "大纲" })).toBeTruthy();
    expect(await screen.findByText("小节")).toBeTruthy();
    fireEvent.click(screen.getByText("小节"));
    fireEvent.keyDown(window, { key: "#", ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole("complementary", { name: "文件树" })).toBeTruthy();
  });

  it("shows a flat document list with relative paths for duplicate names", async () => {
    render(<App transport={folderWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(window, { key: "@", ctrlKey: true, shiftKey: true });
    const list = await screen.findByRole("complementary", { name: "文档列表" });
    expect(within(list).getAllByText("a.md").length).toBeGreaterThanOrEqual(2);
    expect(within(list).getByText("b.md")).toBeTruthy();
    expect(within(list).getByText("sub/a.md")).toBeTruthy();
  });

  it("searches the folder and shows plain text matches", async () => {
    let captured: { query: string; onFrame: (frame: unknown) => void } | null = null;
    const searchDirectory = vi.fn((query, onFrame) => {
      captured = { query, onFrame };
      return { abort: () => {}, done: Promise.resolve() };
    });
    const openTreeFile = vi.fn(async (rel: string) => ({
      kind: "file" as const,
      rel,
      doc: { ...loadedDoc.doc, name: rel, path: `E:/notes/${rel}` },
    }));
    render(
      <App
        transport={folderWith({
          searchDirectory: searchDirectory as never,
          openTreeFile,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const input = await screen.findByRole("searchbox", { name: "搜索当前目录" });
    fireEvent.change(input, { target: { value: "命中" } });
    await waitFor(() => expect(searchDirectory).toHaveBeenCalledWith("命中", expect.any(Function)));
    act(() => {
      captured?.onFrame({ matches: [{ path: "a.md", name: "a.md", line: 2, text: "这里是命中" }], done: false });
    });
    expect(await screen.findByText("这里是命中")).toBeTruthy();
    fireEvent.click(screen.getByText("这里是命中"));
    await waitFor(() => expect(openTreeFile).toHaveBeenCalledWith("a.md", false));
    const findInput = (await screen.findByLabelText("在文中查找")) as HTMLInputElement;
    expect(findInput.value).toBe("命中");
  });

  it("marks the active left view in the View menu", async () => {
    render(<App transport={folderWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    await screen.findByRole("searchbox", { name: "搜索当前目录" });
    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    const searchItem = screen.getByRole("menuitemcheckbox", { name: /搜索/ });
    const treeItem = screen.getByRole("menuitemcheckbox", { name: /文件树/ });
    expect(searchItem.getAttribute("aria-checked")).toBe("true");
    expect(treeItem.getAttribute("aria-checked")).toBe("false");
    expect(searchItem.querySelector("svg")).toBeTruthy();
    expect(treeItem.querySelector("svg")).toBeNull();
  });

  it("asks to open the parent folder before listing a single file", async () => {
    const attachParentFolder = vi.fn(async () => ({
      kind: "attached" as const,
      root: "E:/notes",
      name: "notes",
      rel: "笔记.md",
    }));
    render(
      <App
        transport={folderWith({
          openFile: async () => loadedDoc,
          attachParentFolder,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "@", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "打开所在目录并列出？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "打开目录" }));
    await waitFor(() => expect(attachParentFolder).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("complementary", { name: "文档列表" })).toBeTruthy();
  });

  it("closes directory search with Escape", async () => {
    render(<App transport={folderWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByRole("tree", { name: "文件树" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    await screen.findByRole("searchbox", { name: "搜索当前目录" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("complementary", { name: "文件树" })).toBeTruthy();
  });

  it("asks to open the parent folder before searching a single file", async () => {
    const attachParentFolder = vi.fn(async () => ({
      kind: "attached" as const,
      root: "E:/notes",
      name: "notes",
      rel: "笔记.md",
    }));
    render(
      <App
        transport={folderWith({
          openFile: async () => loadedDoc,
          attachParentFolder,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "打开所在目录并搜索？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "打开目录" }));
    await waitFor(() => expect(attachParentFolder).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("searchbox", { name: "搜索当前目录" })).toBeTruthy();
  });
});

describe("opening a file a request names", () => {
  it("opens the requested file as soon as the request arrives", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 4, path: "E:/notes\a.md" }] });
    const openRequested = vi.fn(async () => ({ kind: "file" as const, doc: loadedDoc.doc }));
    render(<App transport={fakeTransport({ pending, openRequested })} />);
    expect(await screen.findByRole("heading", { name: "标题" })).toBeTruthy();
    expect(openRequested).toHaveBeenCalledWith(4);
    expect(screen.getByText("只读")).toBeTruthy();
  });

  it("shows the failure of a requested file and keeps the window usable", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 5, path: "E:/notes\gone.md" }] });
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
      openFolder: async () => ({ kind: "opened", root: "E:/notes", name: "notes" }),
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

  it("opens a tree file in this window and keeps the tree", async () => {
    const openTreeFile = vi.fn(async () => ({
      kind: "file" as const,
      doc: loadedDoc.doc,
      rel: "a.md",
    }));
    render(<App transport={withTree({ openTreeFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    fireEvent.mouseDown(await screen.findByText("a.md"));
    expect(openTreeFile).toHaveBeenCalledWith("a.md", false);
    // The folder stays, and the row shows as selected (AC-06).
    expect(await screen.findByRole("tree", { name: "文件树" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /a\.md/, selected: true })).toBeTruthy(),
    );
  });

  it("opens a tree file in a new window from its button", async () => {
    const openTreeFile = vi.fn(async () => ({ kind: "handedOff" as const }));
    render(<App transport={withTree({ openTreeFile })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    fireEvent.mouseDown(await screen.findByRole("button", { name: "在新窗口打开 a.md" }));
    expect(openTreeFile).toHaveBeenCalledWith("a.md", true);
  });

  it("starts browsing when a request names a folder", async () => {
    const pending = async () => ({ ok: true as const, value: [{ seq: 3, path: "E:/notes" }] });
    const openRequested = vi.fn(async () => ({ kind: "folder" as const, root: "E:/notes", name: "notes" }));
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

describe("in-document search", () => {
  const doc = {
    kind: "loaded" as const,
    doc: {
      ...loadedDoc.doc,
      html: "<h1>标题</h1><p>正文里有标题两个字，还有标题。</p>",
    },
  };

  it("opens with Ctrl+F and counts the matches", async () => {
    render(<App transport={fakeTransport({ openFile: async () => doc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "在文中查找" });
    fireEvent.change(input, { target: { value: "标题" } });
    expect(await screen.findByText("1 / 3")).toBeTruthy();
  });

  it("says so when nothing matches", async () => {
    render(<App transport={fakeTransport({ openFile: async () => doc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "在文中查找" }), {
      target: { value: "找不到的词" },
    });
    expect(await screen.findByText("未找到匹配内容")).toBeTruthy();
  });

  it("closes with Escape and clears the bar", async () => {
    render(<App transport={fakeTransport({ openFile: async () => doc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "在文中查找" })).toBeNull();
  });
});

describe("the recent list", () => {
  const settings = {
    kind: "ok" as const,
    settings: {
      startup: "blank",
      appearance: "system",
      showStatusBar: true,
      recent: [
        { path: "E:/notes\a.md", name: "a.md", isDir: false },
        { path: "E:/notes", name: "notes", isDir: true },
      ],
    },
    corrupt: false,
  };

  it("shows what was opened and opens it again", async () => {
    const openRecent = vi.fn(async () => ({ kind: "handedOff" as const }));
    render(<App transport={fakeTransport({ getSettings: async () => settings, openRecent })} />);
    expect(await screen.findByText("最近打开")).toBeTruthy();
    fireEvent.click(screen.getByTitle("E:/notes\a.md"));
    expect(openRecent).toHaveBeenCalledWith("E:/notes\a.md");
  });

  it("clears the list", async () => {
    const clearRecent = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ getSettings: async () => settings, clearRecent })} />);
    fireEvent.click(await screen.findByRole("button", { name: "清空记录" }));
    expect(clearRecent).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("最近打开")).toBeNull());
  });

  it("says when the settings could not be read", async () => {
    const broken = {
      kind: "ok" as const,
      settings: { startup: "blank", appearance: "system", showStatusBar: true, recent: [] },
      corrupt: true,
      notice: "设置文件损坏，已按默认设置启动，原文件已保留",
    };
    render(<App transport={fakeTransport({ getSettings: async () => broken })} />);
    expect(await screen.findByText(/设置文件损坏/)).toBeTruthy();
  });
});

describe("the settings dialog", () => {
  it("opens with Ctrl+comma and saves the startup choice", async () => {
    const saveSettings = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ saveSettings })} />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /恢复上一份文档/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ startup: "resume" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull());
  });

  it("keeps the dialog open and says so when saving fails", async () => {
    const saveSettings = async () => ({ ok: false as const, message: "本次设置未保存" });
    render(<App transport={fakeTransport({ saveSettings })} />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));
    expect(await screen.findByText("本次设置未保存")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
  });

  it("closes without saving on Escape", async () => {
    const saveSettings = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ saveSettings })} />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("shows why a restore fell back to a blank page", async () => {
    const ready = async () => ({
      ok: true as const,
      value: { windowId: 1, version: "0.1.0", startupNotice: "上次阅读的内容已不存在，已打开空白页" },
    });
    render(<App transport={fakeTransport({ ready })} />);
    expect(await screen.findByText(/上次阅读的内容已不存在/)).toBeTruthy();
  });
});

describe("the appearance preference", () => {
  it("applies the saved preference once the settings load", async () => {
    const settings = {
      kind: "ok" as const,
      settings: { startup: "blank", appearance: "dark", showStatusBar: true, recent: [] },
      corrupt: false,
    };
    render(<App transport={fakeTransport({ getSettings: async () => settings })} />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("follows a change made in any window", async () => {
    let push: (change: { appearance: string }) => void = () => {};
    const onThemeChange = (listener: (change: { appearance: string }) => void) => {
      push = listener;
      return () => {};
    };
    render(<App transport={fakeTransport({ onThemeChange })} />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    act(() => push({ appearance: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("saves the appearance chosen in the dialog", async () => {
    const saveSettings = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ saveSettings })} />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.click(await screen.findByRole("radio", { name: /深色/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ appearance: "dark" }));
    // The window shows the choice before the save even answers.
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("M5-8 editing aids and the theme menu", () => {
  it("switches and persists the appearance from the 主题 menu", async () => {
    const saveSettings = vi.fn(async () => ({ ok: true as const, value: undefined }));
    render(<App transport={fakeTransport({ saveSettings })} />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    fireEvent.click(screen.getByRole("menuitem", { name: "主题" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "深色" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ appearance: "dark" }));
  });

  it("converts line endings, undoes the conversion, and saves the chosen ending", async () => {
    const saveDocument = vi.fn(async () => ({
      kind: "saved" as const,
      path: "E:/notes/笔记.md",
      name: "笔记.md",
      size: 2048,
      hash: "hash-2",
      hasBom: false,
      lineEnding: "CRLF",
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, saveDocument })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /换行符：/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "转换为 CRLF" }));
    await waitFor(() => expect(document.title).toBe("笔记.md •"));

    content.focus();
    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(document.title).toBe("笔记.md"));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /换行符：LF/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "转换为 CRLF" }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saveDocument).toHaveBeenCalled());
    await waitFor(() => expect(document.title).toBe("笔记.md"));
    expect(screen.getByText("CRLF")).toBeTruthy();
  });

  it("deletes the current line only while the editor has focus", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除范围" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除当前行" }));
    await waitFor(() => expect(content.textContent).toBe("正文"));
    expect(content.querySelectorAll(".cm-line").length).toBe(2);

    fireEvent.blur(content);
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    const range = screen.getByRole("menuitem", { name: "删除范围" });
    expect(range.getAttribute("aria-disabled")).toBe("true");
  });

  it("trims trailing spaces, ensures a final newline, and shows the Win+. hint", async () => {
    const spacedDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "正文 ", html: "<p>正文</p>" },
    };
    render(<App transport={fakeTransport({ openFile: async () => spacedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByText("正文", { selector: "p" });
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "空格与换行" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "确保文件末尾换行" }));
    await waitFor(() => expect(content.querySelectorAll(".cm-line").length).toBe(2));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "空格与换行" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "清理行尾空格" }));
    await waitFor(() => expect(content.textContent).toBe("正文"));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "表情与符号" }));
    expect(await screen.findByText(/Windows 表情面板/)).toBeTruthy();
  });
});

describe("M6-1 import", () => {
  it("imports into an empty window and lists format-loss warnings", async () => {
    const importDocument = vi.fn(async () => ({
      kind: "imported" as const,
      text: "# 导入标题\n\n正文\n",
      name: "导入-文章",
      warnings: ["已忽略脚本、样式、表单或嵌入内容"],
      windowId: 3,
    }));
    render(<App transport={fakeTransport({ importDocument })} />);
    await screen.findByText(/窗口 3/);
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导入…" }));

    const dialog = await screen.findByRole("dialog", { name: "导入完成" });
    expect(dialog.textContent).toContain("导入-文章");
    expect(dialog.textContent).toContain("脚本");
    expect(document.title).toBe("导入-文章 •");
    expect(await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 })).toBeTruthy();
  });

  it("keeps the current document when the import opened another window", async () => {
    const importDocument = vi.fn(async () => ({
      kind: "imported" as const,
      text: "",
      name: "导入-另一份",
      warnings: [],
      windowId: 99,
    }));
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc, importDocument })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导入…" }));
    await screen.findByRole("dialog", { name: "导入完成" });
    expect(document.title).toBe("笔记.md");
  });
});

describe("M6-2 math tools", () => {
  it("inserts inline formulas and templates from the math submenu", async () => {
    const mathDoc = {
      kind: "loaded" as const,
      doc: { ...loadedDoc.doc, text: "前后", html: "<p>前后</p>" },
    };
    render(<App transport={fakeTransport({ openFile: async () => mathDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByText("前后");
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "数学工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "行内公式" }));
    await waitFor(() => expect(content.textContent).toContain("$公式$"));

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "数学工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "分数" }));
    await waitFor(() => expect(content.textContent).toContain("frac{分子}"));
  });

  it("disables math tools outside source editing", async () => {
    render(<App transport={fakeTransport({ openFile: async () => loadedDoc })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await screen.findByRole("heading", { name: "标题" });
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    const math = screen.getByRole("menuitem", { name: "数学工具" });
    expect(math.getAttribute("aria-disabled")).toBe("true");
  });
});
