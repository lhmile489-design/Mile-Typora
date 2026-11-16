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
  type SettingsResult,
  type SettingsView,
  type ScanFrame,
  type ThemeChange,
} from "../mygo";
import { failureMessage, failureText } from "./errors";

export type { Doc as OpenedDoc, DocUpdate, OpenRequest, ReadyInfo, ScanFrame };

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

/** What rendering an edited buffer produced. */
export type SourcePreview =
  | { kind: "ok"; html: string; counts: RenderSourceResult["counts"] }
  | { kind: "failed"; code: string; message: string };

/** What opening a file produced: a document, a cancellation, or a problem. */
export type OpenFileResult =
  | { kind: "cancelled" }
  | { kind: "loaded"; doc: Doc }
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
  /** Closes this window; the last window quits the app (PRD FR-09, Ctrl+W). */
  closeWindow(): Promise<Outcome<void>>;
  /** Reads the settings and the recent list. */
  getSettings(): Promise<SettingsOutcome>;
  /** Writes the settings the page edited. */
  saveSettings(view: SettingsView): Promise<Outcome<void>>;
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
  closeWindow: () =>
    wrap(async () => {
      await WindowService.closeWindow();
    }),
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
  saveSettings: (view) =>
    wrap(async () => {
      const outcome = await WindowService.saveSettings(view);
      if (outcome.failure) throw new Error(failureMessage(outcome.failure.code, outcome.failure.detail));
    }),
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
