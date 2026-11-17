// The only module that imports the generated client src/mygo.ts
// (CLAUDE.md §5.8). Components receive a Transport, so tests and design-time
// mocks can supply their own.
import { isCallError } from "mygo-runtime";
import { Channel } from "mygo-runtime";
import {
  WindowService,
  events,
  type Doc,
  type DocUpdate,
  type OpenRequest,
  type ReadyInfo,
  type LinkTarget,
  type LoadResult,
  type Notice,
  type OpenRequestResult,
  type RecentEntry,
  type RenderSourceResult,
  type SaveResult,
  type ImportResult,
  type SettingsResult,
  type SettingsView,
  type SettingsChange,
  type WindowViewState,
  type WindowCount,
  type WindowCycleResult,
  type ScanFrame,
  type ThemeChange,
  type SaveAllSummary,
  type SaveAllResult,
  type FileOpResult,
  type FileProperties,
  type AttachFolderResult,
  type FileTrashed,
  type OutlineResult,
  type OutlineHeading,
  type SearchFrame,
  type SearchMatch,
  type ImagePickResult,
  type ImageCopyResult,
} from "../mygo";
import { failureMessage, failureText } from "./errors";

export type { Doc as OpenedDoc, DocUpdate, OpenRequest, ReadyInfo, ScanFrame, SaveAllSummary, SaveAllResult };
export type { FileProperties, FileTrashed };
export type { OutlineHeading, SearchFrame, SearchMatch };

/** One row of the file tree, as Go sends it. */
export type TreeEntry = ScanFrame["entries"][number];

/** What an open request produced. Nothing opened means it went to a new
 * window, which opens it there. */
export type RequestedOutcome =
  | { kind: "file"; doc: Doc; rel?: string }
  | { kind: "folder"; root: string; name: string }
  | { kind: "handedOff" }
  | { kind: "failed"; code: string; message: string };

export type { RecentEntry, SettingsView };

/** What reading the settings produced. */
export type SettingsOutcome =
  | { kind: "ok"; settings: SettingsView; corrupt: boolean; notice?: string }
  | { kind: "failed"; message: string };

/** What a link click means once Go has looked at it. */
export type LinkOutcome =
  | { kind: "anchor"; anchor: string }
  | { kind: "document"; rel: string }
  /** Nothing to open: the reason belongs in the status bar. */
  | { kind: "notice"; reason: string }
  /** Go handled it already, or the user cancelled. */
  | { kind: "none" };

/** What opening a folder produced. */
export type OpenFolderResult =
  | { kind: "cancelled" }
  | { kind: "opened"; root: string; name: string }
  | { kind: "handedOff" }
  | { kind: "failed"; code: string; message: string };

/** What a save or save-as produced. */
export type SaveOutcome =
  | { kind: "saved"; path: string; name: string; size: number; hash: string; hasBom: boolean; lineEnding: string }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string; message: string };

/** What an import produced. Text is empty when a new window received it. */
export type ImportOutcome =
  | { kind: "imported"; text: string; name: string; warnings: string[]; windowId: number }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string; message: string };

/** What rendering an edited buffer produced. */
export type SourcePreview =
  | { kind: "ok"; html: string; counts: RenderSourceResult["counts"] }
  | { kind: "failed"; code: string; message: string };

/** What opening a file produced: a document, a cancellation, or a problem. */
export type OpenFileResult =
  | { kind: "cancelled" }
  | { kind: "loaded"; doc: Doc }
  | { kind: "failed"; code: string; message: string };

/** What a move, trash or reveal produced. */
export type FileOpOutcome =
  | { kind: "done"; path: string; name: string }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string; message: string };

/** What reading a file's properties produced. */
export type PropertiesOutcome =
  | { kind: "ok"; properties: FileProperties }
  | { kind: "failed"; code: string; message: string };

/** What attaching the document's parent folder produced. */
export type AttachFolderOutcome =
  | { kind: "attached"; root: string; name: string; rel: string }
  | { kind: "failed"; code: string; message: string };

/** What extracting an outline produced. */
export type OutlineOutcome =
  | { kind: "ok"; headings: OutlineResult["headings"]; truncated: boolean }
  | { kind: "failed"; code: string; message: string };

/** What picking an image produced, before the copy confirmation. */
export type ImagePickOutcome =
  | { kind: "picked"; token: string; name: string; target: string; size: number }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string; message: string };

/** What copying a confirmed image produced. */
export type ImageCopyOutcome =
  | { kind: "copied"; path: string; markdown: string; name: string }
  | { kind: "failed"; code: string; message: string };

/** What a clipboard copy command produced (M5-5). */
export type ClipboardCopyOutcome =
  | { kind: "copied" }
  | { kind: "failed"; code: string; message: string };

/** What an HTML/PDF export produced (M5-6). */
export type ExportOutcome =
  | { kind: "exported"; path: string; warnings: string[] }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string; message: string };

/** What opening the print preview produced (M5-6). */
export type PrintOutcome =
  | { kind: "printed"; warnings: string[] }
  | { kind: "failed"; code: string; message: string };

/** One view operation's result (M5-7). */
export type ViewOutcome =
  | { kind: "ok"; state: WindowViewState }
  | { kind: "failed"; code: string; message: string };

/** Word statistics from the parsed document (M5-7 VIEW-10). */
export type CountOutcome =
  | { kind: "ok"; count: WindowCount }
  | { kind: "failed"; code: string; message: string };

/** The result of a call: its value, or a message for a failure. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

export interface Transport {
  ready(): Promise<Outcome<ReadyInfo>>;
  /** Opens another window; resolves once the app has created it. */
  newWindow(): Promise<Outcome<void>>;
  /**
   * Subscribes to open requests that arrive after the handshake. Subscribe
   * before calling ready(), so a request cannot fall between the two.
   */
  onOpenRequest(listener: (request: OpenRequest) => void): () => void;
  /** Open requests after seq that the page has not acknowledged yet. */
  pending(after: number): Promise<Outcome<OpenRequest[]>>;
  /** Confirms that every request up to seq was handled, freeing the queue. */
  ack(seq: number): Promise<void>;
  /** Asks for a Markdown file with the system dialog and reads it. */
  openFile(): Promise<OpenFileResult>;
  /**
   * Opens the file a queued request names: a file association, a command-line
   * argument, or another instance's request.
   */
  openRequested(seq: number): Promise<RequestedOutcome>;
  /** Asks Go what a link means and lets it do the part the page cannot. */
  openLink(href: string): Promise<LinkOutcome>;
  /** Subscribes to appearance changes made in any window. */
  onThemeChange(listener: (change: ThemeChange) => void): () => void;
  /**
   * Subscribes to changes the app noticed in the file the window shows. A
   * failure leaves the old document on screen, marked stale (PRD FR-07).
   */
  onDocUpdated(listener: (update: DocUpdate) => void): () => void;
  /** Subscribes to structural changes of the window's folder (PRD FR-03.12). */
  onTreeChanged(listener: () => void): () => void;
  /** Subscribes to short notices about a request the app refused (PRD §9.2.4). */
  onNotice(listener: (notice: Notice) => void): () => void;
  /** Reads the window's document again (F5, or the stale banner's retry). */
  refresh(): Promise<OpenFileResult>;
  /**
   * Renders an editing buffer with the same renderer as a file, without
   * writing it (PRD 10.1, P1 preview).
   */
  renderSource(text: string): Promise<SourcePreview>;
  /** Drops the window's document, leaving its folder open (PRD FR-07.5). */
  closeDocument(): Promise<Outcome<void>>;
  /** Closes this window; force skips the dirty check after the page asked. */
  closeWindow(force: boolean): Promise<Outcome<void>>;
  /** Subscribes to a native close that waits for the unsaved prompt. */
  onCloseRequested(listener: () => void): () => void;
  /** Starts an unsaved document here (empty window) or in a new window. */
  newDocument(): Promise<Outcome<number>>;
  /** Stops the ready handshake from asking for an unsaved document again. */
  clearStartUntitled(): Promise<void>;
  /** Converts a chosen HTML or DOCX file into a new unsaved buffer (FILE-15). */
  importDocument(): Promise<ImportOutcome>;
  /** Writes the buffer to the window's file; force overwrites a conflict. */
  saveDocument(text: string, force: boolean): Promise<SaveOutcome>;
  /** Asks for a path and writes the buffer there. */
  saveDocumentAs(text: string): Promise<SaveOutcome>;
  /** Starts a save-all run over every window (P1 FILE-10). */
  saveAll(): Promise<Outcome<number>>;
  /** Reports this window's save-all outcome back to Go. */
  reportSaveAll(requestId: number, name: string, status: string, message: string): Promise<Outcome<void>>;
  /** Subscribes to the save-all request for this window. */
  onSaveAllRequest(listener: (requestId: number) => void): () => void;
  /** Subscribes to the save-all aggregate. */
  onSaveAllDone(listener: (summary: SaveAllSummary) => void): () => void;
  /** Reads the system clipboard's plain text (P1 EDIT-06/11). */
  readClipboardText(): Promise<Outcome<string>>;
  /** Writes plain text to the system clipboard. */
  writeClipboardText(text: string): Promise<Outcome<void>>;
  /** Copies a source selection as readable text (M5-5 EDIT-07). */
  copyPlainTextSource(source: string): Promise<ClipboardCopyOutcome>;
  /** Copies a selection as cleaned HTML with a text fallback (EDIT-09/10). */
  copyClipboardHTML(content: string, fromSource: boolean, simplified: boolean): Promise<ClipboardCopyOutcome>;
  /** Copies one authorized local image as PNG (EDIT-05). */
  copyImageToClipboard(source: string): Promise<ClipboardCopyOutcome>;
  /** Turns a clipboard image into a pending asset copy (EDIT-06). */
  readClipboardImage(): Promise<ImagePickOutcome>;
  /** Writes the enhanced document as a standalone HTML file (M5-6). */
  exportHTML(bodyHTML: string, title: string): Promise<ExportOutcome>;
  /** Writes the enhanced document as PDF (M5-6). */
  exportPDF(bodyHTML: string, title: string): Promise<ExportOutcome>;
  /** Opens the system print preview on the dedicated print view (M5-6). */
  printDocument(bodyHTML: string, title: string): Promise<PrintOutcome>;
  /** Tells Go whether the buffer is dirty and which version it started from. */
  setEditState(dirty: boolean, hash: string, hasBom: boolean, lineEnding: string): Promise<void>;
  /** Reads the settings and the recent list. */
  getSettings(): Promise<SettingsOutcome>;
  /** Writes the settings the page edited. diagnosticChanged tells the caller
   *  to show the restart notice (M6-6 VIEW-17). */
  saveSettings(view: SettingsView): Promise<Outcome<void> & { diagnosticChanged?: boolean }>;
  /** Subscribes to a shared preference changed in any window. */
  onSettingsChange(listener: (change: SettingsChange) => void): () => void;
  /** Current window fullscreen, topmost and zoom state (M5-7). */
  getWindowView(): Promise<ViewOutcome>;
  setFullScreen(value: boolean): Promise<ViewOutcome>;
  setAlwaysOnTop(value: boolean): Promise<ViewOutcome>;
  setZoom(factor: number): Promise<ViewOutcome>;
  /** Opens the calling window's web inspector; Go re-checks the diagnostic
   *  mode and refuses print views (M6-6 VIEW-17). */
  openDevTools(): Promise<Outcome<void>>;
  /** Focuses the next/previous app window in MRU order. */
  cycleWindow(backwards: boolean): Promise<Outcome<void>>;
  /** Counts the parsed source, excluding document front matter when whole. */
  countWords(source: string, selection: boolean): Promise<CountOutcome>;
  /** Empties the recent list. */
  clearRecent(): Promise<Outcome<void>>;
  /** Opens an entry the app recorded itself. */
  openRecent(path: string): Promise<RequestedOutcome>;
  /** Drops one recent entry that turned out to be unavailable (PRD §7.2). */
  removeRecent(path: string): Promise<Outcome<void>>;
  /**
   * Opens a file the tree names, relative to the window's folder, here or in
   * a new window (PRD FR-02, AC-06).
   */
  openTreeFile(rel: string, newWindow: boolean): Promise<RequestedOutcome>;
  /** Asks for a folder and makes it the window's root. */
  openFolder(): Promise<OpenFolderResult>;
  /** Moves the current document or a tree file to a folder the user picks. */
  moveDocument(rel: string): Promise<FileOpOutcome>;
  /** Sends the current document or a tree file to the recycle bin. */
  trashDocument(rel: string): Promise<FileOpOutcome>;
  /** Reads a file's read-only properties. */
  documentProperties(rel: string): Promise<PropertiesOutcome>;
  /** Selects the current document in Windows Explorer. */
  revealDocument(): Promise<FileOpOutcome>;
  /** Makes the current document's folder the window root, keeping the document. */
  attachParentFolder(): Promise<AttachFolderOutcome>;
  /** Subscribes to a file being moved to the recycle bin by another window. */
  onFileTrashed(listener: (event: FileTrashed) => void): () => void;
  /** Extracts the headings of a source buffer for the left outline. */
  extractOutline(text: string): Promise<OutlineOutcome>;
  /** Streams directory-search matches; abort closes the channel. */
  searchDirectory(query: string, onFrame: (frame: SearchFrame) => void): { abort: () => void; done: Promise<void> };
  /** Picks a local image and prepares its assets/ target (M5-4). */
  pickImage(): Promise<ImagePickOutcome>;
  /** Copies the picked image after the page confirms. */
  copyImage(token: string): Promise<ImageCopyOutcome>;
  /** Drops a pick the page cancelled. */
  cancelImage(token: string): Promise<void>;
  /**
   * Streams the tree of the window's folder. Each frame appends rows; the
   * frame marked done carries the outcome. Abort stops the stream.
   */
  scan(onFrame: (frame: ScanFrame) => void): { abort: () => void; done: Promise<void> };
}

/**
 * subscribe keeps the page usable outside a mygo window: the browser preview
 * (web-shell) has no runtime, so events do not exist. Inside the app this is
 * the same subscription; the page still reports the failed handshake.
 */
function subscribe(open: () => () => void): () => void {
  try {
    return open();
  } catch {
    return () => {};
  }
}

/** wrap turns a rejected call into an Outcome, so callers never see a throw. */
export async function wrap<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (err) {
    if (isCallError(err)) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** clipboardCopy maps one clipboard binding's expected failure or error. */
async function clipboardCopy(
  call: () => Promise<{ failure?: { code: string; detail?: string } }>,
): Promise<ClipboardCopyOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    return { kind: "copied" };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
    };
  }
}

/** exportOutcome maps the HTML/PDF binding's failure and cancellation. */
async function exportOutcome(
  call: () => Promise<{ path?: string; warnings?: string[]; failure?: { code: string; detail?: string } }>,
): Promise<ExportOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      if (result.failure.code === "cancelled") return { kind: "cancelled" };
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    return { kind: "exported", path: result.path ?? "", warnings: result.warnings ?? [] };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
    };
  }
}

async function printOutcome(
  call: () => Promise<{ warnings?: string[]; failure?: { code: string; detail?: string } }>,
): Promise<PrintOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    return { kind: "printed", warnings: result.warnings ?? [] };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
    };
  }
}

/** viewOutcome maps one per-window view binding result. */
async function viewOutcome(call: () => Promise<WindowViewState>): Promise<ViewOutcome> {
  try {
    const state = await call();
    if (state.failure) {
      return { kind: "failed", code: state.failure.code, message: failureText(state.failure) };
    }
    return { kind: "ok", state };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
    };
  }
}

export const mygoTransport: Transport = {
  ready: () => wrap(() => WindowService.ready()),
  newWindow: () =>
    wrap(async () => {
      const result = await WindowService.newWindow();
      // Expected failures arrive in the result, not as a CallError (§1).
      if (result.failure) throw new Error(result.failure.detail);
    }),
  onOpenRequest: (listener) => subscribe(() => events.openRequest.on(listener)),
  pending: () =>
    wrap(async () => {
      const result = await WindowService.pending(0);
      return result.requests;
    }),
  ack: (seq) => WindowService.ack(seq),
  openFolder: async () => {
    try {
      const result = await WindowService.openFolderDialog();
      if (result.failure) {
        return {
          kind: "failed",
          code: result.failure.code,
          message: failureText(result.failure),
        };
      }
      if (!result.root) {
        // The dialog was cancelled, or a window that already shows
        // something took the folder: a new window browses it.
        return { kind: "handedOff" };
      }
      return { kind: "opened", root: result.root, name: result.name };
    } catch (err) {
      return { kind: "failed", code: "unknown", message: failureMessage("unknown", err instanceof Error ? err.message : "") };
    }
  },
  moveDocument: (rel) => fileOpOutcome(() => WindowService.moveDocument(rel)),
  trashDocument: (rel) => fileOpOutcome(() => WindowService.trashDocument(rel)),
  documentProperties: async (rel) => {
    try {
      const result = await WindowService.documentProperties(rel);
      if (result.failure) {
        return {
          kind: "failed",
          code: result.failure.code,
          message: failureText(result.failure),
        };
      }
      return { kind: "ok", properties: result };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({
          code: "unknown",
          detail: err instanceof Error ? err.message : "",
        }),
      };
    }
  },
  revealDocument: () => fileOpOutcome(() => WindowService.revealDocument()),
  attachParentFolder: async () => {
    try {
      const result = await WindowService.attachParentFolder();
      if (result.failure || !result.folder) {
        return {
          kind: "failed",
          code: result.failure?.code ?? "unknown",
          message: result.failure
            ? failureText(result.failure)
            : failureMessage("unknown", "无法打开文件所在目录"),
        };
      }
      return {
        kind: "attached",
        root: result.folder.root,
        name: result.folder.name,
        rel: result.rel ?? "",
      };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({
          code: "unknown",
          detail: err instanceof Error ? err.message : "",
        }),
      };
    }
  },
  onFileTrashed: (listener) => subscribe(() => events.fileTrashed.on(listener)),
  extractOutline: async (text) => {
    try {
      const result = await WindowService.extractOutline(text);
      if (result.failure) {
        return {
          kind: "failed",
          code: result.failure.code,
          message: failureText(result.failure),
        };
      }
      return { kind: "ok", headings: result.headings ?? [], truncated: result.truncated ?? false };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({
          code: "unknown",
          detail: err instanceof Error ? err.message : "",
        }),
      };
    }
  },
  searchDirectory: (query, onFrame) => {
    const frames = new Channel<SearchFrame>();
    const reading = (async () => {
      for await (const frame of frames) onFrame(frame);
    })();
    const done = WindowService.searchDirectory(query, frames).then(
      () => reading,
      () => reading,
    );
    return { abort: () => frames.close(), done };
  },
  pickImage: async () => {
    try {
      const result = await WindowService.pickImage();
      if (result.failure) {
        return { kind: "failed", code: result.failure.code, message: failureText(result.failure) };
      }
      if (!result.token) return { kind: "cancelled" };
      return {
        kind: "picked",
        token: result.token,
        name: result.name ?? "",
        target: result.target ?? "",
        size: result.size ?? 0,
      };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
      };
    }
  },
  copyImage: async (token) => {
    try {
      const result = await WindowService.copyImage(token);
      if (result.failure) {
        return { kind: "failed", code: result.failure.code, message: failureText(result.failure) };
      }
      return {
        kind: "copied",
        path: result.path ?? "",
        markdown: result.markdown ?? "",
        name: result.name ?? "",
      };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
      };
    }
  },
  cancelImage: (token) => WindowService.cancelImage(token),
  scan: (onFrame) => {
    const frames = new Channel<ScanFrame>();
    const reading = (async () => {
      for await (const frame of frames) onFrame(frame);
    })();
    const done = WindowService.scan(frames).then(
      () => reading,
      () => reading,
    );
    return { abort: () => frames.close(), done };
  },
  openFile: async () => openResult(() => WindowService.openFileDialog()),
  openRequested: async (seq) => requestedOutcome(() => WindowService.openRequested(seq)),
  openLink: async (href) => linkOutcome(() => WindowService.openLink(href)),
  onThemeChange: (listener) => subscribe(() => events.themeChange.on(listener)),
  onDocUpdated: (listener) => subscribe(() => events.docUpdated.on(listener)),
  onTreeChanged: (listener) => subscribe(() => events.treeChanged.on(() => listener())),
  onNotice: (listener) => subscribe(() => events.appNotice.on(listener)),
  saveAll: () =>
    wrap(async () => {
      const result = await WindowService.saveAll();
      return result.requestId;
    }),
  reportSaveAll: (requestId, name, status, message) =>
    wrap(async () => {
      await WindowService.reportSaveAll(requestId, name, status, message);
    }),
  onSaveAllRequest: (listener) => subscribe(() => events.saveAllRequest.on((request) => listener(request.requestId))),
  onSaveAllDone: (listener) => subscribe(() => events.saveAllDone.on(listener)),
  refresh: async () => openResult(() => WindowService.refresh()),
  renderSource: async (text) => {
    try {
      const result = await WindowService.renderSource(text);
      if (result.failure) {
        return {
          kind: "failed",
          code: result.failure.code,
          message: failureText(result.failure),
        };
      }
      return { kind: "ok", html: result.html ?? "", counts: result.counts };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({
          code: "unknown",
          detail: err instanceof Error ? err.message : "",
        }),
      };
    }
  },
  closeDocument: () =>
    wrap(async () => {
      await WindowService.closeDocument();
    }),
  closeWindow: (force) =>
    wrap(async () => {
      await WindowService.closeWindow(force);
    }),
  onCloseRequested: (listener) => subscribe(() => events.closeRequested.on(() => listener())),
  newDocument: () =>
    wrap(async () => {
      const result = await WindowService.newDocument();
      if (result.failure) throw new Error(result.failure.detail);
      return result.windowId;
    }),
  clearStartUntitled: () => WindowService.clearStartUntitled(),
  importDocument: async () => {
    try {
      const result = await WindowService.importDocument();
      if (result.failure) {
        if (result.failure.code === "cancelled") return { kind: "cancelled" };
        return {
          kind: "failed",
          code: result.failure.code,
          message: failureText(result.failure),
        };
      }
      return {
        kind: "imported",
        text: result.text ?? "",
        name: result.name ?? "导入文档",
        warnings: result.warnings ?? [],
        windowId: result.windowId,
      };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({
          code: "unknown",
          detail: err instanceof Error ? err.message : "",
        }),
      };
    }
  },
  saveDocument: async (text, force) => saveOutcome(() => WindowService.saveDocument(text, force)),
  saveDocumentAs: async (text) => saveOutcome(() => WindowService.saveDocumentAs(text)),
  readClipboardText: () => wrap(() => WindowService.clipboardReadText()),
  writeClipboardText: (text) =>
    wrap(async () => {
      await WindowService.clipboardWriteText(text);
    }),
  copyPlainTextSource: (source) => clipboardCopy(() => WindowService.clipboardCopyPlainText(source)),
  copyClipboardHTML: (content, fromSource, simplified) =>
    clipboardCopy(() => WindowService.clipboardCopyHTML(content, fromSource, simplified)),
  copyImageToClipboard: (source) => clipboardCopy(() => WindowService.clipboardCopyImage(source)),
  readClipboardImage: async () => {
    try {
      const result = await WindowService.clipboardReadImage();
      if (result.failure) {
        return { kind: "failed", code: result.failure.code, message: failureText(result.failure) };
      }
      if (!result.token) return { kind: "failed", code: "no_image", message: "剪贴板中没有图片" };
      return {
        kind: "picked",
        token: result.token,
        name: result.name ?? "",
        target: result.target ?? "",
        size: result.size ?? 0,
      };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
      };
    }
  },
  exportHTML: (bodyHTML, title) => exportOutcome(() => WindowService.exportHTML(bodyHTML, title)),
  exportPDF: (bodyHTML, title) => exportOutcome(() => WindowService.exportPDF(bodyHTML, title)),
  printDocument: (bodyHTML, title) => printOutcome(() => WindowService.printDocument(bodyHTML, title)),
  setEditState: (dirty, hash, hasBom, lineEnding) =>
    WindowService.setEditState(dirty, hash, hasBom, lineEnding),
  getSettings: async () => {
    try {
      const result = await WindowService.getSettings();
      return {
        kind: "ok",
        settings: result.settings,
        corrupt: result.corrupt ?? false,
        notice: result.failure ? failureMessage(result.failure.code, result.failure.detail) : undefined,
      };
    } catch (err) {
      return { kind: "failed", message: failureMessage("unknown", err instanceof Error ? err.message : "") };
    }
  },
  saveSettings: async (view) => {
    try {
      const before = await WindowService.getSettings().catch(() => null);
      const outcome = await WindowService.saveSettings(view);
      if (outcome.failure) {
        return { ok: false as const, message: failureMessage(outcome.failure.code, outcome.failure.detail) };
      }
      const diagnosticChanged = before != null && before.settings.diagnosticMode !== view.diagnosticMode;
      return { ok: true as const, value: undefined, diagnosticChanged };
    } catch (err) {
      return { ok: false as const, message: failureMessage("unknown", err instanceof Error ? err.message : "") };
    }
  },
  onSettingsChange: (listener) => subscribe(() => events.settingsChanged.on(listener)),
  getWindowView: () => viewOutcome(() => WindowService.getWindowView()),
  setFullScreen: (value) => viewOutcome(() => WindowService.setFullScreen(value)),
  setAlwaysOnTop: (value) => viewOutcome(() => WindowService.setAlwaysOnTop(value)),
  setZoom: (factor) => viewOutcome(() => WindowService.setZoom(factor)),
  openDevTools: () =>
    wrap(async () => {
      const outcome = await WindowService.openDevTools();
      if (outcome.failure) throw new Error(failureMessage(outcome.failure.code, outcome.failure.detail));
    }),
  cycleWindow: (backwards) =>
    wrap(async () => {
      const result = await WindowService.cycleWindow(backwards);
      if (result.failure) throw new Error(failureMessage(result.failure.code, result.failure.detail));
    }),
  countWords: async (source, selection) => {
    try {
      const result = await WindowService.countWords(source, selection);
      if (result.failure) {
        return { kind: "failed", code: result.failure.code, message: failureText(result.failure) };
      }
      return { kind: "ok", count: result };
    } catch (err) {
      return {
        kind: "failed",
        code: "unknown",
        message: failureText({ code: "unknown", detail: err instanceof Error ? err.message : "" }),
      };
    }
  },
  clearRecent: () =>
    wrap(async () => {
      const outcome = await WindowService.clearRecent();
      if (outcome.failure) throw new Error(failureMessage(outcome.failure.code, outcome.failure.detail));
    }),
  openRecent: async (path) => requestedOutcome(() => WindowService.openRecent(path)),
  removeRecent: (path) =>
    wrap(async () => {
      await WindowService.removeRecent(path);
    }),
  openTreeFile: async (rel, newWindow) => requestedOutcome(() => WindowService.openTreeFile(rel, newWindow)),
};

/** openResult turns a call's LoadResult into what the page shows. */
async function openResult(call: () => Promise<LoadResult>): Promise<OpenFileResult> {
  try {
    const result = await call();
    if (result.failure) {
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    if (!result.doc) return { kind: "cancelled" };
    return { kind: "loaded", doc: result.doc };
  } catch (err) {
    // An unexpected failure: the page shows it and keeps reading.
    return {
      kind: "failed",
      code: "unknown",
      message: failureMessage("unknown", err instanceof Error ? err.message : ""),
    };
  }
}

/** requestedOutcome turns an open request's result into what the page does. */
async function requestedOutcome(call: () => Promise<OpenRequestResult>): Promise<RequestedOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    if (result.kind === "folder" && result.folder) {
      return { kind: "folder", root: result.folder.root, name: result.folder.name };
    }
    if (result.kind === "file" && result.doc) {
      return { kind: "file", doc: result.doc, rel: result.rel };
    }
    return { kind: "handedOff" };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureMessage("unknown", err instanceof Error ? err.message : ""),
    };
  }
}

/** saveOutcome turns a SaveResult into what the page does. */
async function saveOutcome(call: () => Promise<SaveResult>): Promise<SaveOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      if (result.failure.code === "cancelled") return { kind: "cancelled" };
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    return {
      kind: "saved",
      path: result.path ?? "",
      name: result.name ?? "",
      size: result.size ?? 0,
      hash: result.hash ?? "",
      hasBom: result.hasBom ?? false,
      lineEnding: result.lineEnding ?? "",
    };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({
        code: "unknown",
        detail: err instanceof Error ? err.message : "",
      }),
    };
  }
}

/** fileOpOutcome turns a move, trash or reveal result into what the page does. */
async function fileOpOutcome(call: () => Promise<FileOpResult>): Promise<FileOpOutcome> {
  try {
    const result = await call();
    if (result.failure) {
      return {
        kind: "failed",
        code: result.failure.code,
        message: failureText(result.failure),
      };
    }
    if (!result.path) return { kind: "cancelled" };
    return { kind: "done", path: result.path, name: result.name ?? "" };
  } catch (err) {
    return {
      kind: "failed",
      code: "unknown",
      message: failureText({
        code: "unknown",
        detail: err instanceof Error ? err.message : "",
      }),
    };
  }
}

/** linkOutcome turns Go's answer about a link into what the page does. */
async function linkOutcome(call: () => Promise<LinkTarget>): Promise<LinkOutcome> {
  try {
    const target = await call();
    switch (target.kind) {
      case "anchor":
        return { kind: "anchor", anchor: target.anchor ?? "" };
      case "document":
        return { kind: "document", rel: target.rel ?? "" };
      case "attachment":
      case "blocked":
        return { kind: "notice", reason: target.reason ?? "无法打开此链接" };
      default:
        return { kind: "none" };
    }
  } catch {
    return { kind: "notice", reason: "无法打开此链接" };
  }
}
