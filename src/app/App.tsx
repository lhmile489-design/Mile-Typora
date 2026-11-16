import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleX,
  FileText,
  FolderOpen,
  Lock,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  SquarePlus,
} from "lucide-react";
import type { OpenedDoc, OpenRequest, ReadyInfo, ScanFrame, Transport, TreeEntry } from "../lib/transport";
import { failureMessage, formatBytes } from "../lib/errors";
import { FileTree } from "../components/FileTree";
import { renderMath } from "../render/math";
import { renderDiagrams } from "../render/mermaid";

type ReadyState =
  | { kind: "waiting" }
  | { kind: "ready"; info: ReadyInfo }
  | { kind: "failed"; message: string };

type LoadError = { code: string; message: string };

/**
 * The window shell, laid out after artboard 2 of the design draft
 * (DESIGN.md §8.1, §8.8–§8.11). Toolbar commands appear once their stage
 * wires them; until then they are disabled rather than absent, so the
 * toolbar matches the design and nothing looks clickable that is not.
 */
export function App({ transport }: { transport: Transport }) {
  const [ready, setReady] = useState<ReadyState>({ kind: "waiting" });
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [doc, setDoc] = useState<OpenedDoc | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [folder, setFolder] = useState<{ root: string; name: string } | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [treeNotice, setTreeNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scanRef = useRef<{ abort: () => void } | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  // The reserved pane starts collapsed: reading comes first, and the pane
  // has nothing in it yet (PRD D-06, decisions.md D-T23).
  const [showRight, setShowRight] = useState(false);

  // Opening what a request names: a double-clicked file, a command-line
  // argument, or another instance's request (PRD FR-02.8, docs/踩坑记录.md).
  const openRequested = useCallback(
    async (seq: number) => {
      const result = await transport.openRequested(seq);
      if (result.kind === "loaded") {
        setDoc(result.doc);
        setLoadError(null);
        // The window is now a single-file one.
        scanRef.current?.abort();
        setFolder(null);
        setTree([]);
        setSelected(null);
      } else if (result.kind === "failed") {
        setLoadError({ code: result.code, message: result.message });
      }
    },
    [transport],
  );

  // Requests live in the Go-side queue until acknowledged, so subscribing
  // before the handshake and fetching what is pending loses nothing: a
  // remount gets the same requests again. Seq keeps order and drops repeats.
  useEffect(() => {
    const seen = new Set<number>();
    const add = (request: OpenRequest) => {
      if (seen.has(request.seq)) return;
      seen.add(request.seq);
      setRequests((prev) => [...prev, request]);
      // Go acknowledges the request once it has tried to open it, and gives
      // the same document back to a page that asks again after a remount.
      void openRequested(request.seq);
    };
    const off = transport.onOpenRequest(add);
    let alive = true;
    void transport.ready().then(async (r) => {
      if (!alive) return;
      if (!r.ok) {
        setReady({ kind: "failed", message: r.message });
        return;
      }
      setReady({ kind: "ready", info: r.value });
      const pending = await transport.pending(0);
      if (!alive || !pending.ok) return;
      pending.value.forEach(add);
    });
    return () => {
      alive = false;
      off();
    };
  }, [openRequested, transport]);

  // Opening a file replaces what the window shows; cancelling changes nothing.
  const openFile = useCallback(async () => {
    setNotice(null);
    const result = await transport.openFile();
    if (result.kind === "loaded") {
      setDoc(result.doc);
      setLoadError(null);
    } else if (result.kind === "failed") {
      setLoadError({ code: result.code, message: result.message });
    }
  }, [transport]);

  // Opening a folder replaces the tree, dropping any scan still running.
  const openFolder = useCallback(async () => {
    setNotice(null);
    const result = await transport.openFolder();
    if (result.kind === "failed") {
      setLoadError({ code: result.code, message: result.message });
      return;
    }
    if (result.kind !== "opened") return;

    scanRef.current?.abort();
    setFolder({ root: result.root, name: result.name });
    setDoc(null);
    setLoadError(null);
    setSelected(null);
    setTree([]);
    setTreeNotice(null);
    setScanning(true);

    const rows: TreeEntry[] = [];
    scanRef.current = transport.scan((frame: ScanFrame) => {
      if (frame.failure) {
        setScanning(false);
        setTreeNotice(failureMessage(frame.failure.code, frame.failure.detail));
        return;
      }
      if (frame.entries.length > 0) {
        rows.push(...frame.entries);
        setTree([...rows]);
      }
      if (frame.done) {
        setScanning(false);
        setTreeNotice(frame.truncated ? scanNotice(frame) : null);
      }
    });
  }, [transport]);

  useEffect(() => () => scanRef.current?.abort(), []);

  const newWindow = useCallback(async () => {
    setNotice(null);
    const r = await transport.newWindow();
    // A failure belongs in the window that asked (PRD §7.2).
    if (!r.ok) setNotice(r.message);
  }, [transport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        void openFile();
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        void openFolder();
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        void newWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, openFolder, newWindow]);

  return (
    <div className="win">
      <div className="toolbar" role="toolbar" aria-label="工具栏">
        <ToolButton label="打开文件" icon={<FileText />} labeled onClick={() => void openFile()} />
        <ToolButton label="打开目录" icon={<FolderOpen />} labeled onClick={() => void openFolder()} />
        <ToolButton label="新建窗口" icon={<SquarePlus />} onClick={() => void newWindow()} />
        <span className="sep" aria-hidden="true" />
        <ToolButton label="刷新" icon={<RefreshCw />} disabled />
        <ToolButton label="查找" icon={<Search />} disabled />
        <span className="spacer" />
        <ToolButton
          label="左侧栏"
          icon={<PanelLeft />}
          pressed={showLeft}
          onClick={() => setShowLeft((v) => !v)}
        />
        <ToolButton
          label="预留侧栏"
          icon={<PanelRight />}
          pressed={showRight}
          onClick={() => setShowRight((v) => !v)}
        />
        <ToolButton label="设置" icon={<Settings />} disabled />
      </div>
      <div className="body">
        {showLeft && (
          <aside className="side left" aria-label="文件树">
            {folder ? (
              <FileTree
                rootName={folder.name}
                entries={tree}
                selected={selected}
                onSelect={(entry) => setSelected(entry.path)}
                busy={scanning}
                notice={treeNotice}
              />
            ) : (
              <div className="empty">
                <p>{doc ? doc.name : "尚未打开文件或目录"}</p>
              </div>
            )}
          </aside>
        )}
        <main className="center">
          {loadError ? (
            <LoadFailure error={loadError} onRetry={() => void openFile()} />
          ) : doc ? (
            <Reader doc={doc} />
          ) : (
            <div className="start-wrap">
              <div className="start">
                <h2>开始阅读</h2>
                <p>打开一个 Markdown 文件，或打开一个目录浏览其中的文档。</p>
              </div>
            </div>
          )}
        </main>
        {showRight && (
          <aside className="side right" aria-label="预留侧栏">
            <div className="reserve-head">
              <span>预留侧栏</span>
            </div>
          </aside>
        )}
      </div>
      <footer className="statusbar" role="status">
        {doc ? (
          <>
            <span className="badge-ro">
              <Lock aria-hidden="true" />
              只读
            </span>
            <span className="item" title={doc.path}>
              {doc.name}
            </span>
            <span className="grow" />
            <span className="item">{formatBytes(doc.size)}</span>
            <span className="item">{doc.hasBom ? "UTF-8 BOM" : "UTF-8"}</span>
            <span className="item">{doc.lineEnding}</span>
          </>
        ) : (
          <>
            <PendingRequest requests={requests} />
            <span className="grow" />
          </>
        )}
        {notice && (
          <span className="item st-danger">
            <CircleAlert aria-hidden="true" />
            {notice}
          </span>
        )}
        <ReadyBadge state={ready} />
      </footer>
    </div>
  );
}

/**
 * The reader shows the HTML Go rendered and cleaned (decisions.md D-T02):
 * whatever the document contains, only whitelisted markup arrives here.
 */
function Reader({ doc }: { doc: OpenedDoc }) {
  const ref = useRef<HTMLElement>(null);

  // One pass per document: formulas and diagrams are the page's job (D-T02).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    renderMath(root);
    void renderDiagrams(root);
  }, [doc.html]);

  if (doc.text === "") {
    return (
      <div className="empty">
        <p>这是一个空 Markdown 文件</p>
      </div>
    );
  }
  return (
    <div className="reader">
      <article ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}

function LoadFailure({ error, onRetry }: { error: LoadError; onRetry: () => void }) {
  return (
    <div className="empty error">
      <div>
        <CircleX className="ic" aria-hidden="true" />
        <h3>无法打开文件</h3>
        <p>{error.message}</p>
        <div className="row">
          <button className="btn secondary" type="button" onClick={onRetry}>
            重新选择
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * M1-2 shows the queued open requests here so the plumbing is visible; M2
 * turns requests into opened files.
 */
function PendingRequest({ requests }: { requests: OpenRequest[] }) {
  const last = requests.at(-1);
  if (!last) return <span className="item">未打开文档</span>;
  return (
    <span className="item" title={last.path}>
      待打开{requests.length > 1 ? `（${requests.length}）` : ""}：{last.path}
    </span>
  );
}

type ToolButtonProps = {
  label: string;
  icon: ReactNode;
  /** Shows the label beside the icon (DESIGN.md §8.1). */
  labeled?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function ToolButton({ label, icon, labeled, pressed, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      className={labeled ? "tb labeled" : "tb"}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
      {labeled && <span>{label}</span>}
    </button>
  );
}

function ReadyBadge({ state }: { state: ReadyState }) {
  switch (state.kind) {
    case "waiting":
      return <span className="item">正在连接</span>;
    case "ready":
      return (
        <span className="item">
          窗口 {state.info.windowId} · v{state.info.version || "dev"}
        </span>
      );
    case "failed":
      return (
        <span className="item st-danger">
          <CircleAlert aria-hidden="true" />
          连接失败：{state.message}
        </span>
      );
  }
}

/** scanNotice says which bound stopped the scan and what it left out. */
function scanNotice(frame: ScanFrame): string {
  const bound = frame.bound === "markdown" ? "文件数量" : frame.bound === "depth" ? "目录深度" : "条目数量";
  const skipped = frame.skipped ? `，另有 ${frame.skipped} 项未包含` : "";
  return `结果不完整：达到${bound}上限${skipped}`;
}
