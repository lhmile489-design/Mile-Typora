// The only module that imports the generated client src/mygo.ts
// (CLAUDE.md §5.8). Components receive a Transport, so tests and design-time
// mocks can supply their own.
import { isCallError } from "mygo-runtime";
import { Channel } from "mygo-runtime";
import {
  WindowService,
  events,
  type Doc,
  type OpenRequest,
  type ReadyInfo,
  type LoadResult,
  type OpenRequestResult,
  type ScanFrame,
} from "../mygo";
import { failureMessage } from "./errors";

export type { Doc as OpenedDoc, OpenRequest, ReadyInfo, ScanFrame };

/** One row of the file tree, as Go sends it. */
export type TreeEntry = ScanFrame["entries"][number];

/** What an open request produced. Nothing opened means it went to a new
 * window, which opens it there. */
export type RequestedOutcome =
  | { kind: "file"; doc: Doc }
  | { kind: "folder"; root: string; name: string }
  | { kind: "handedOff" }
  | { kind: "failed"; code: string; message: string };

/** What opening a folder produced. */
export type OpenFolderResult =
  | { kind: "cancelled" }
  | { kind: "opened"; root: string; name: string }
  | { kind: "handedOff" }
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
  onOpenRequest: (listener) => events.openRequest.on(listener),
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
          message: failureMessage(result.failure.code, result.failure.detail),
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
        message: failureMessage(result.failure.code, result.failure.detail),
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
        message: failureMessage(result.failure.code, result.failure.detail),
      };
    }
    if (result.kind === "folder" && result.folder) {
      return { kind: "folder", root: result.folder.root, name: result.folder.name };
    }
    if (result.kind === "file" && result.doc) {
      return { kind: "file", doc: result.doc };
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
