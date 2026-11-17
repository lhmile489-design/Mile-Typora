import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import type { DocUpdate, Transport } from "../lib/transport";

afterEach(cleanup);

const firstDoc = {
  name: "笔记.md",
  path: "E:/notes/笔记.md",
  size: 2048,
  hasBom: false,
  lineEnding: "LF",
  hash: "",
  text: "# 标题\n\n正文",
  html: "<h1>标题</h1>\n<p>正文</p>",
  counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
};

/** changedDoc is what the file holds after the edit outside the app. */
const changedDoc = {
  ...firstDoc,
  text: "# 新标题\n\n新正文",
  html: "<h1>新标题</h1>\n<p>新正文</p>",
};

function fakeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    ready: async () => ({ ok: true, value: { windowId: 3, version: "0.1.0" } }),
    newWindow: async () => ({ ok: true, value: undefined }),
    onOpenRequest: () => () => {},
    pending: async () => ({ ok: true, value: [] }),
    ack: async () => {},
    openFile: async () => ({ kind: "loaded" as const, doc: firstDoc }),
    openFolder: async () => ({ kind: "cancelled" as const }),
    openRequested: async () => ({ kind: "handedOff" as const }),
    openTreeFile: async () => ({ kind: "handedOff" as const }),
    openLink: async () => ({ kind: "none" as const }),
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
    refresh: async () => ({ kind: "loaded" as const, doc: changedDoc }),
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

async function openFirstDoc(transport: Transport) {
  render(<App transport={transport} />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await screen.findByRole("heading", { name: "标题" });
}

describe("external changes", () => {
  it("replaces the document the app noticed changing", async () => {
    let send: (update: DocUpdate) => void = () => {};
    await openFirstDoc(
      fakeTransport({
        onDocUpdated: (listener) => {
          send = listener;
          return () => {};
        },
      }),
    );

    act(() => send({ seq: 1, doc: changedDoc }));
    expect(await screen.findByRole("heading", { name: "新标题" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "标题" })).toBeNull();
    // The status bar says when it last refreshed (DESIGN.md §8.8).
    expect(screen.getByText(/已更新 \d{2}:\d{2}/)).toBeTruthy();
  });

  it("drops a result a newer change overtook", async () => {
    let send: (update: DocUpdate) => void = () => {};
    await openFirstDoc(
      fakeTransport({
        onDocUpdated: (listener) => {
          send = listener;
          return () => {};
        },
      }),
    );

    act(() => send({ seq: 2, doc: changedDoc }));
    await screen.findByRole("heading", { name: "新标题" });
    act(() =>
      send({
        seq: 1,
        doc: { ...firstDoc, html: "<h1>迟到的标题</h1>" },
      }),
    );
    expect(screen.queryByRole("heading", { name: "迟到的标题" })).toBeNull();
  });

  it("keeps the content and marks it stale when the file is gone", async () => {
    let send: (update: DocUpdate) => void = () => {};
    const refresh = vi.fn(async () => ({
      kind: "failed" as const,
      code: "not_found",
      message: "文件不存在或已被移动",
    }));
    await openFirstDoc(
      fakeTransport({
        refresh,
        onDocUpdated: (listener) => {
          send = listener;
          return () => {};
        },
      }),
    );

    act(() => send({ seq: 1, failure: { code: "not_found", detail: "文件已不存在" } }));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("文件已不存在");
    // The old content is still readable (PRD FR-07.5).
    expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("closes the document from the stale banner", async () => {
    let send: (update: DocUpdate) => void = () => {};
    const closeDocument = vi.fn(async () => ({ ok: true as const, value: undefined }));
    await openFirstDoc(
      fakeTransport({
        closeDocument,
        onDocUpdated: (listener) => {
          send = listener;
          return () => {};
        },
      }),
    );

    act(() => send({ seq: 1, failure: { code: "not_found", detail: "文件已不存在" } }));
    fireEvent.click(await screen.findByRole("button", { name: "关闭当前文档" }));
    expect(await screen.findByText("开始阅读")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "标题" })).toBeNull();
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });
});

describe("manual refresh", () => {
  it("reads the document again from the toolbar", async () => {
    const refresh = vi.fn(async () => ({ kind: "loaded" as const, doc: changedDoc }));
    await openFirstDoc(fakeTransport({ refresh }));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByRole("heading", { name: "新标题" })).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the document again from F5 (PRD FR-09)", async () => {
    const refresh = vi.fn(async () => ({ kind: "loaded" as const, doc: changedDoc }));
    await openFirstDoc(fakeTransport({ refresh }));

    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "新标题" })).toBeTruthy();
  });

  it("shows the refresh in the status bar while it runs", async () => {
    let finish: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<Transport["refresh"]>>>((resolve) => {
          finish = () => resolve({ kind: "loaded", doc: changedDoc });
        }),
    );
    await openFirstDoc(fakeTransport({ refresh }));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("刷新中")).toBeTruthy();
    act(() => finish());
    expect(await screen.findByRole("heading", { name: "新标题" })).toBeTruthy();
    expect(screen.queryByText("刷新中")).toBeNull();
  });

  it("refreshes only the tree with F5 when no document is selected", async () => {
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
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开目录" }));
    await screen.findByText("a.md");
    expect(screen.getByRole("button", { name: "刷新" }).getAttribute("aria-disabled")).toBeNull();

    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
  });
});
