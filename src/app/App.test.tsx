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
      settings: { startup: "blank", appearance: "system", recent: [] },
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
      settings: { startup: "blank", appearance: "dark", recent: [] },
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
