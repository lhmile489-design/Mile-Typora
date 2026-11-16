import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleX,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  SquarePlus,
} from "lucide-react";
import type {
  OpenedDoc,
  OpenRequest,
  ReadyInfo,
  RecentEntry,
  RequestedOutcome,
  ScanFrame,
  Transport,
  TreeEntry,
} from "../lib/transport";
import { failureMessage, formatBytes } from "../lib/errors";
import { FileTree } from "../components/FileTree";
import { SettingsDialog } from "../components/SettingsDialog";
import { FindBar } from "../components/FindBar";
import { advance, clearHighlights, collectRanges, paint, scrollToRange } from "../render/find";
import { capture, metricsOf, restore, type Position } from "../render/position";
import { renderMath } from "../render/math";
import { renderDiagrams, rerenderDiagrams } from "../render/mermaid";

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
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [settings, setSettings] = useState<{ startup: string; appearance: string }>({
    startup: "blank",
    appearance: "system",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const scanRef = useRef<{ abort: () => void } | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  // Requests are opened one after another: a folder must be in place before
  // the document inside it opens (PRD §9.2.3, ordered).
  const requestQueue = useRef(Promise.resolve());
  // The folder is read from a ref as well: the request queue hands a stale
  // closure to a later request, and a file inside the folder must still see
  // the folder that was just opened.
  const folderRef = useRef<{ root: string; name: string } | null>(null);
  const applyFolder = useCallback((next: { root: string; name: string } | null) => {
    folderRef.current = next;
    setFolder(next);
  }, []);
  const findRanges = useRef<Range[]>([]);
  const positions = useRef(new Map<string, Position>());
  const [showLeft, setShowLeft] = useState(true);
  // The reserved pane starts collapsed: reading comes first, and the pane
  // has nothing in it yet (PRD D-06, decisions.md D-T23).
  const [showRight, setShowRight] = useState(false);

  // Start reading a folder: the tree streams in while the page draws.
  const startScan = useCallback(
    (root: string, name: string) => {
      scanRef.current?.abort();
      applyFolder({ root, name });
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
    },
    [applyFolder, transport],
  );

  // The appearance preference decides the theme for every window at once;
  // diagrams are redrawn because their SVG keeps its own colours
  // (PRD FR-10.12, DESIGN.md §1).
  const applyTheme = useCallback((preference: string) => {
    const root = document.documentElement;
    const dark =
      preference === "dark" ||
      (preference === "system" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.style.colorScheme = dark ? "dark" : "light";
    if (preference === "system") root.removeAttribute("data-theme-pinned");
    else root.setAttribute("data-theme-pinned", "1");
    const article = readerRef.current?.querySelector(".markdown");
    if (article?.querySelector(".diagram")) void rerenderDiagrams(article);
  }, []);

  useEffect(() => {
    return transport.onThemeChange((change) => applyTheme(change.appearance));
  }, [applyTheme, transport]);

  // The settings and the recent list (PRD FR-08, FR-10).
  const loadSettings = useCallback(async () => {
    const result = await transport.getSettings();
    if (result.kind === "failed") {
      setNotice(result.message);
      return;
    }
    setRecent(result.settings.recent ?? []);
    setSettings({ startup: result.settings.startup, appearance: result.settings.appearance });
    applyTheme(result.settings.appearance);
    if (result.notice) setNotice(result.notice);
  }, [applyTheme, transport]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const clearRecent = useCallback(async () => {
    const result = await transport.clearRecent();
    if (result.ok) setRecent([]);
    else setNotice(result.message);
  }, [transport]);

  // Where the reader is in this file, kept before another replaces it.
  const rememberHere = useCallback(() => {
    const scroller = readerRef.current;
    if (!doc || !scroller) return;
    positions.current.set(doc.path, capture(metricsOf(scroller)));
  }, [doc]);

  // Everything that opens something ends here: a request, the tree, or a
  // dialog whose result a new window may take instead.
  const applyOutcome = useCallback(
    (result: RequestedOutcome) => {
      switch (result.kind) {
        case "file":
          rememberHere();
          setDoc(result.doc);
          void loadSettings();
          setLoadError(null);
          // A file inside the folder being browsed keeps the tree and
          // becomes its selection (PRD FR-10.5, AC-06); another one makes
          // this a single-file window.
          if (result.rel && folderRef.current) {
            setSelected(result.rel);
          } else {
            scanRef.current?.abort();
            applyFolder(null);
            setTree([]);
            setSelected(null);
          }
          return;
        case "folder":
          startScan(result.root, result.name);
          void loadSettings();
          return;
        case "failed":
          setLoadError({ code: result.code, message: result.message });
          return;
        case "handedOff":
          // A new window opens it; this one keeps what it shows.
          return;
      }
    },
    [applyFolder, rememberHere, startScan],
  );

  // Opening what a request names: a double-clicked file, a command-line
  // argument, or another instance's request (PRD FR-02.8, docs/踩坑记录.md).
  const openRequested = useCallback(
    async (seq: number) => {
      applyOutcome(await transport.openRequested(seq));
    },
    [applyOutcome, transport],
  );

  // A click in the tree opens the file here; its arrow opens it elsewhere.
  const openRecent = useCallback(
    async (entry: RecentEntry) => {
      applyOutcome(await transport.openRecent(entry.path));
    },
    [applyOutcome, transport],
  );

  const openTreeFile = useCallback(
    async (entry: TreeEntry, newWindow: boolean) => {
      setSelected(entry.path);
      applyOutcome(await transport.openTreeFile(entry.path, newWindow));
    },
    [applyOutcome, transport],
  );

  // A link in the document: Go decides, the page scrolls or opens.
  const handleLink = useCallback(
    async (href: string) => {
      const result = await transport.openLink(href);
      switch (result.kind) {
        case "anchor": {
          const id = decodeURIComponent(result.anchor);
          const target = id ? document.getElementById(id) : null;
          target?.scrollIntoView({ block: "start" });
          return;
        }
        case "document": {
          const name = result.rel.split("/").pop() ?? result.rel;
          await openTreeFile({ path: result.rel, name, isDir: false }, false);
          return;
        }
        case "notice":
          setNotice(result.reason);
          return;
        case "none":
          return;
      }
    },
    [openTreeFile, transport],
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
      requestQueue.current = requestQueue.current
        .then(() => openRequested(request.seq))
        .catch(() => {});
    };
    const off = transport.onOpenRequest(add);
    let alive = true;
    void transport.ready().then(async (r) => {
      if (!alive) return;
      if (!r.ok) {
        setReady({ kind: "failed", message: r.message });
        return;
      }
      if (r.value.startupNotice) setNotice(r.value.startupNotice);
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
    startScan(result.root, result.name);
  }, [startScan, transport]);

  useEffect(() => () => scanRef.current?.abort(), []);

  const saveSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    // The page edits the startup choice; the appearance follows until M3-3
    // gives it a control of its own.
    const result = await transport.saveSettings({
      startup: settings.startup,
      appearance: settings.appearance,
      recent: [],
    });
    setSettingsSaving(false);
    if (result.ok) {
      setSettingsOpen(false);
      return;
    }
    setSettingsError(result.message);
  }, [settings, transport]);

  const newWindow = useCallback(async () => {
    setNotice(null);
    const r = await transport.newWindow();
    // A failure belongs in the window that asked (PRD §7.2).
    if (!r.ok) setNotice(r.message);
  }, [transport]);

  // Search the rendered document without touching its DOM (PRD FR-05).
  useEffect(() => {
    if (!findOpen) {
      clearHighlights();
      findRanges.current = [];
      setFindCount(0);
      return;
    }
    const article = readerRef.current?.querySelector(".markdown");
    if (!article) {
      findRanges.current = [];
      setFindCount(0);
      return;
    }
    const ranges = collectRanges(article, findQuery);
    findRanges.current = ranges;
    setFindCount(ranges.length);
    const current = Math.min(findIndex, Math.max(0, ranges.length - 1));
    paint(ranges, current);
    const active = ranges[current];
    if (active) scrollToRange(active);
  }, [findOpen, findQuery, doc?.html]);

  // Put the reader back where it was in this file (PRD FR-07.3).
  useEffect(() => {
    const scroller = readerRef.current;
    if (!doc || !scroller) return;
    const saved = positions.current.get(doc.path);
    if (saved) scroller.scrollTop = restore(metricsOf(scroller), saved);
  }, [doc?.path, doc?.html]);

  const stepFind = useCallback(
    (backwards: boolean) => {
      const ranges = findRanges.current;
      if (ranges.length === 0) return;
      const next = advance(findIndex, ranges.length, backwards);
      setFindIndex(next);
      paint(ranges, next);
      const active = ranges[next];
      if (active) scrollToRange(active);
    },
    [findIndex],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
    clearHighlights();
  }, []);

  const changeQuery = useCallback((query: string) => {
    setFindQuery(query);
    setFindIndex(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsError(null);
        setSettingsOpen(true);
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (e.key === "Escape" && findOpen) {
        e.preventDefault();
        closeFind();
        return;
      }
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
  }, [closeFind, findOpen, newWindow, openFile, openFolder]);

  return (
    <div className="win">
      <div className="toolbar" role="toolbar" aria-label="工具栏">
        <ToolButton label="打开文件" icon={<FileText />} labeled onClick={() => void openFile()} />
        <ToolButton label="打开目录" icon={<FolderOpen />} labeled onClick={() => void openFolder()} />
        <ToolButton label="新建窗口" icon={<SquarePlus />} onClick={() => void newWindow()} />
        <span className="sep" aria-hidden="true" />
        <ToolButton label="刷新" icon={<RefreshCw />} disabled />
        <ToolButton label="查找" icon={<Search />} onClick={() => setFindOpen(true)} />
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
        <ToolButton
          label="设置"
          icon={<Settings />}
          onClick={() => {
            setSettingsError(null);
            setSettingsOpen(true);
          }}
        />
      </div>
      <div className="body">
        {showLeft && (
          <aside className="side left" aria-label="文件树">
            {folder ? (
              <FileTree
                rootName={folder.name}
                entries={tree}
                selected={selected}
                onOpen={(entry) => void openTreeFile(entry, false)}
                onOpenInNewWindow={(entry) => void openTreeFile(entry, true)}
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
          {findOpen && doc && (
            <FindBar
              query={findQuery}
              count={findCount}
              index={findIndex}
              onChange={changeQuery}
              onStep={stepFind}
              onClose={closeFind}
            />
          )}
          {loadError ? (
            <LoadFailure error={loadError} onRetry={() => void openFile()} />
          ) : doc ? (
            <Reader doc={doc} scrollerRef={readerRef} onLink={(href) => void handleLink(href)} />
          ) : (
            <div className="start-wrap">
              <div className="start">
                <h2>开始阅读</h2>
                <p>打开一个 Markdown 文件，或打开一个目录浏览其中的文档。</p>
                <div className="actions">
                  <button className="btn primary" type="button" onClick={() => void openFile()}>
                    <FileText aria-hidden="true" />
                    打开文件
                    <span className="kbd">Ctrl+O</span>
                  </button>
                  <button className="btn secondary" type="button" onClick={() => void openFolder()}>
                    <FolderOpen aria-hidden="true" />
                    打开目录
                    <span className="kbd">Ctrl+Shift+O</span>
                  </button>
                </div>
                {recent.length > 0 && (
                  <>
                    <div className="recent-head">
                      <span>最近打开</span>
                      <button className="btn text" type="button" onClick={() => void clearRecent()}>
                        清空记录
                      </button>
                    </div>
                    <ul className="recent">
                      {recent.slice(0, 8).map((entry) => (
                        <li key={entry.path}>
                          <button
                            type="button"
                            className="recent-row"
                            title={entry.path}
                            onClick={() => void openRecent(entry)}
                          >
                            {entry.isDir ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />}
                            <span className="txt">
                              <span className="nm">{entry.name}</span>
                              <span className="path">{entry.path}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
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
      {settingsOpen && (
        <SettingsDialog
          startup={settings.startup}
          onChangeStartup={(startup) => setSettings({ ...settings, startup })}
          appearance={settings.appearance}
          onChangeAppearance={(appearance) => {
            setSettings({ ...settings, appearance });
            applyTheme(appearance);
          }}
          onCancel={() => setSettingsOpen(false)}
          onSave={() => void saveSettings()}
          saving={settingsSaving}
          error={settingsError}
        />
      )}
    </div>
  );
}

/**
 * The reader shows the HTML Go rendered and cleaned (decisions.md D-T02):
 * whatever the document contains, only whitelisted markup arrives here.
 */
function Reader({
  doc,
  onLink,
  scrollerRef,
}: {
  doc: OpenedDoc;
  onLink: (href: string) => void;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLElement>(null);

  // One pass per document: formulas and diagrams are the page's job (D-T02).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Links never navigate the page: Go decides what a click means (FR-06).
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (href) onLink(href);
    };
    root.addEventListener("click", onClick);
    // Task list boxes show state and take no input (PRD FR-04).
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      box.setAttribute("aria-readonly", "true");
    }
    renderMath(root);
    void renderDiagrams(root);
    return () => root.removeEventListener("click", onClick);
  }, [doc.html, onLink]);

  if (doc.text === "") {
    return (
      <div className="empty">
        <p>这是一个空 Markdown 文件</p>
      </div>
    );
  }
  return (
    <div className="reader" ref={scrollerRef}>
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
