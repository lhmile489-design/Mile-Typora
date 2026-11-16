import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import type { OpenedDoc, OpenRequest, ReadyInfo, Transport } from "../lib/transport";
import { formatBytes } from "../lib/errors";

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
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);

  // Requests live in the Go-side queue until acknowledged, so subscribing
  // before the handshake and fetching what is pending loses nothing: a
  // remount gets the same requests again. Seq keeps order and drops repeats.
  useEffect(() => {
    const seen = new Set<number>();
    const add = (request: OpenRequest) => {
      if (seen.has(request.seq)) return;
      seen.add(request.seq);
      setRequests((prev) => [...prev, request]);
      void transport.ack(request.seq).catch(() => {});
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
  }, [transport]);

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
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        void newWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, newWindow]);

  return (
    <div className="win">
      <div className="toolbar" role="toolbar" aria-label="工具栏">
        <ToolButton label="打开文件" icon={<FileText />} labeled onClick={() => void openFile()} />
        <ToolButton label="打开目录" icon={<FolderOpen />} labeled disabled />
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
            <div className="empty">
              <p>{doc ? doc.name : "尚未打开文件或目录"}</p>
            </div>
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

/** The reader as it stands in M1-3: the file's text. M1-4 renders it. */
function Reader({ doc }: { doc: OpenedDoc }) {
  if (doc.text === "") {
    return (
      <div className="empty">
        <p>这是一个空 Markdown 文件</p>
      </div>
    );
  }
  return (
    <div className="reader">
      <pre className="plain-doc">{doc.text}</pre>
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
