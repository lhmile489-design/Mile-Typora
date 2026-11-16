import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CircleAlert,
  FileText,
  FolderOpen,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  SquarePlus,
} from "lucide-react";
import type { ReadyInfo, Transport } from "../lib/transport";

type ReadyState =
  | { kind: "waiting" }
  | { kind: "ready"; info: ReadyInfo }
  | { kind: "failed"; message: string };

/**
 * The window shell, laid out after artboard 2 of the design draft
 * (DESIGN.md §8.1, §8.8–§8.11). Toolbar commands appear once their stage
 * wires them; until then they are disabled rather than absent, so the
 * toolbar matches the design and nothing looks clickable that is not.
 */
export function App({ transport }: { transport: Transport }) {
  const [ready, setReady] = useState<ReadyState>({ kind: "waiting" });
  const [notice, setNotice] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);

  useEffect(() => {
    let alive = true;
    void transport.ready().then((r) => {
      if (!alive) return;
      setReady(r.ok ? { kind: "ready", info: r.value } : { kind: "failed", message: r.message });
    });
    return () => {
      alive = false;
    };
  }, [transport]);

  // FR-09: the window shortcuts act on the app, so the page would otherwise
  // keep the keystroke.
  const newWindow = useCallback(async () => {
    setNotice(null);
    const r = await transport.newWindow();
    // A failure belongs in the window that asked (PRD §7.2).
    if (!r.ok) setNotice(r.message);
  }, [transport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        void newWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newWindow]);

  return (
    <div className="win">
      <div className="toolbar" role="toolbar" aria-label="工具栏">
        <ToolButton label="打开文件" icon={<FileText />} labeled disabled />
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
              <p>尚未打开文件或目录</p>
            </div>
          </aside>
        )}
        <main className="center">
          <div className="start-wrap">
            <div className="start">
              <h2>开始阅读</h2>
              <p>打开一个 Markdown 文件，或打开一个目录浏览其中的文档。</p>
            </div>
          </div>
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
        <span className="item grow">未打开文档</span>
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
