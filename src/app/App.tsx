import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
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
  DocUpdate,
  OpenedDoc,
  OpenRequest,
  ReadyInfo,
  RecentEntry,
  RequestedOutcome,
  ScanFrame,
  Transport,
  TreeEntry,
} from "../lib/transport";
import { failureMessage, failureText, formatBytes } from "../lib/errors";
import { FileTree } from "../components/FileTree";
import { SettingsDialog } from "../components/SettingsDialog";
import { FindBar } from "../components/FindBar";
import { advance, clearHighlights, collectRanges, paint, scrollToRange } from "../render/find";
import { capture, metricsOf, restore, type Position } from "../render/position";
import { renderMath } from "../render/math";
import { renderDiagrams, rerenderDiagrams } from "../render/mermaid";
import { commandFor, SHORTCUT_HINT } from "../lib/shortcuts";

type ReadyState =
  | { kind: "waiting" }
  | { kind: "ready"; info: ReadyInfo }
  | { kind: "failed"; message: string };

type LoadError = { code: string; message: string; kind: "file" | "folder" };

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
  // stale is why the content on screen may no longer match its file; the
  // document stays until a refresh succeeds (PRD FR-07.5, FR-07.11).
  const [stale, setStale] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // updatedAt is the status bar's "已更新 14:32" (DESIGN.md §8.8).
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
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
  // Where the reader is in this file, kept before the content changes.
  const captureHere = useCallback(() => {
    const current = docRef.current;
    const scroller = readerRef.current;
    if (!current || !scroller) return;
    positions.current.set(current.path, capture(metricsOf(scroller)));
  }, []);

  const findRanges = useRef<Range[]>([]);
  // The last tree rows on screen; a failed rescan keeps them (PRD §7.1).
  const treeRows = useRef<TreeEntry[]>([]);
  const docRef = useRef<OpenedDoc | null>(null);
  const refreshingRef = useRef(false);
  // The newest document update applied; an older one arrives too late.
  const updateSeq = useRef(0);
  const positions = useRef(new Map<string, Position>());
  const [showLeft, setShowLeft] = useState(true);
  // The reserved pane starts collapsed: reading comes first, and the pane
  // has nothing in it yet (PRD D-06, decisions.md D-T23). What the user
  // wants is kept apart from what the width allows: below 1200 it collapses,
  // and widening shows it again only if the user did not hide it (PRD §5.2).
  const [rightWanted, setRightWanted] = useState(false);
  const [wideEnough, setWideEnough] = useState(true);
  const showRight = rightWanted && wideEnough;

  useEffect(() => {
    // The rule is about the window's width (PRD §5.2). Both signals are
    // followed: a resize, which the window manager and the embedded view
    // send, and the media query, which catches the same change where one of
    // the two is missed.
    const update = () => setWideEnough(window.innerWidth >= 1200);
    update();
    window.addEventListener("resize", update);
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1200px)") : null;
    query?.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      query?.removeEventListener("change", update);
    };
  }, []);

  // Start reading a folder: the tree streams in while the page draws. A
  // refresh keeps the open document until its own reload answers.
  const startScan = useCallback(
    (root: string, name: string, keepDoc = false) => {
      scanRef.current?.abort();
      applyFolder({ root, name });
      if (!keepDoc) {
        setDoc(null);
        setLoadError(null);
        setSelected(null);
        setStale(null);
        setUpdatedAt(null);
        treeRows.current = [];
      }
      setTree([]);
      setTreeNotice(null);
      setScanning(true);

      const rows: TreeEntry[] = [];
      scanRef.current = transport.scan((frame: ScanFrame) => {
        if (frame.failure) {
          setScanning(false);
          const message = failureMessage(frame.failure.code, frame.failure.detail);
          if (keepDoc && treeRows.current.length > 0) {
            // A failed rescan keeps the rows it had and says they may be old
            // (PRD §7.1: partial state + ready document stay usable).
            setTree([...treeRows.current]);
            setTreeNotice(`${message}，显示上次结果`);
          } else {
            setTreeNotice(message);
          }
          return;
        }
        if (frame.entries.length > 0) {
          rows.push(...frame.entries);
          treeRows.current = [...rows];
          setTree([...rows]);
        }
        if (frame.done) {
          setScanning(false);
          setTreeNotice(scanNotice(frame));
          if (keepDoc) {
            // A selected file the rescan no longer has is unselected; the
            // reader keeps what it shows (PRD FR-07.6).
            setSelected((prev) => (prev && rows.some((row) => row.path === prev) ? prev : null));
          }
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

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    return transport.onNotice((notice) => setNotice(notice.text));
  }, [transport]);

  // A change outside the app replaces the document, or marks it stale when
  // the file cannot be read any more (PRD FR-07.1, FR-07.5, FR-07.11).
  useEffect(() => {
    return transport.onDocUpdated((update: DocUpdate) => {
      if (update.seq <= updateSeq.current) return;
      updateSeq.current = update.seq;
      if (update.failure) {
        if (!docRef.current) return;
        setStale(failureText(update.failure));
        return;
      }
      if (!update.doc) return;
      // A refresh keeps the reading position (PRD FR-07.3, AC-11).
      captureHere();
      setDoc(update.doc);
      setStale(null);
      setLoadError(null);
      setUpdatedAt(nowHM());
    });
  }, [captureHere, transport]);

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

  // The same, for opening another file from a click handler.
  const rememberHere = useCallback(() => {
    captureHere();
  }, [captureHere]);

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
          setStale(null);
          setUpdatedAt(nowHM());
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
          if (docRef.current || folderRef.current) {
            // A failed open must not hide the document or folder that is
            // still open (PRD §7.1 combined states, FR-07.7).
            setNotice(result.message);
          } else {
            setLoadError({ code: result.code, message: result.message, kind: "file" });
          }
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
      const result = await transport.openRecent(entry.path);
      if (result.kind === "failed") {
        setNotice(`${entry.name} 不可用：${result.message}`);
        // Only a target that is gone leaves the list; a file that is merely
        // too large or in another encoding still exists (PRD §7.2, FR-08.3).
        if (result.code === "not_found" || result.code === "permission" || result.code === "out_of_scope") {
          setRecent((prev) => prev.filter((item) => item.path !== entry.path));
          void transport.removeRecent(entry.path);
        }
        return;
      }
      applyOutcome(result);
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
      setStale(null);
      setUpdatedAt(nowHM());
    } else if (result.kind === "failed") {
      if (docRef.current || folderRef.current) setNotice(result.message);
      else setLoadError({ code: result.code, message: result.message, kind: "file" });
    }
  }, [transport]);

  // Opening a folder replaces the tree, dropping any scan still running.
  const openFolder = useCallback(async () => {
    setNotice(null);
    const result = await transport.openFolder();
    if (result.kind === "failed") {
      if (docRef.current || folderRef.current) setNotice(result.message);
      else setLoadError({ code: result.code, message: result.message, kind: "folder" });
      return;
    }
    if (result.kind !== "opened") return;
    startScan(result.root, result.name);
  }, [startScan, transport]);

  useEffect(() => () => scanRef.current?.abort(), []);

  // The folder changed on disk: rescan it, keeping the open document and its
  // position (PRD FR-03.12, FR-07.1). Bursts of changes become one rescan.
  useEffect(() => {
    let timer: number | null = null;
    const off = transport.onTreeChanged(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const openFolder = folderRef.current;
        if (openFolder) startScan(openFolder.root, openFolder.name, true);
      }, 250);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [startScan, transport]);

  // F5 and the toolbar refresh the reading context: the tree as well in a
  // folder window (PRD FR-07.8). A failure keeps what is on screen.
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    const openFolder = folderRef.current;
    const hasDoc = docRef.current !== null;
    // With no document selected, F5 refreshes the tree alone (PRD FR-07.8).
    if (!hasDoc && !openFolder) return;
    if (openFolder) startScan(openFolder.root, openFolder.name, true);
    if (!hasDoc) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const result = await transport.refresh();
    refreshingRef.current = false;
    setRefreshing(false);
    if (result.kind === "loaded") {
      captureHere();
      setDoc(result.doc);
      setStale(null);
      setLoadError(null);
      setUpdatedAt(nowHM());
    } else if (result.kind === "failed") {
      setStale(result.message);
    }
  }, [captureHere, startScan, transport]);

  // Closing the document returns the window to its start state; the file
  // tree stays when a folder is open (PRD FR-07.5).
  const closeDocument = useCallback(async () => {
    const result = await transport.closeDocument();
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setDoc(null);
    setStale(null);
    setLoadError(null);
    setSelected(null);
    setUpdatedAt(null);
    // A handled request must not read as pending once the document is gone.
    setRequests([]);
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
    clearHighlights();
  }, [transport]);

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

  // Ctrl+W closes this window; the app quits with its last window (PRD FR-09).
  const closeWindow = useCallback(async () => {
    const result = await transport.closeWindow();
    if (!result.ok) setNotice(result.message);
  }, [transport]);

  // The reserved pane's switch has three states in effect: shown, hidden by
  // the user, and hidden because the window is narrow. Pressing it while
  // narrow records the wish and says when it will show.
  const toggleRight = useCallback(() => {
    if (!wideEnough) {
      const next = !rightWanted;
      setRightWanted(next);
      setNotice(
        next
          ? "窗口较窄，预留侧栏将在加宽到 1200 像素后显示"
          : "已取消显示预留侧栏，加宽窗口后也不会自动展开",
      );
      return;
    }
    setRightWanted((value) => !value);
  }, [rightWanted, wideEnough]);

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

  // One key listener runs the table in src/lib/shortcuts.ts. The find bar
  // and the settings dialog handle their own keys first, so a handled press
  // arrives here already prevented.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const command = commandFor(e);
      if (!command) return;
      if (settingsOpen && command !== "dismiss") return;
      switch (command) {
        case "dismiss":
          if (findOpen) {
            e.preventDefault();
            closeFind();
          } else if (notice) {
            e.preventDefault();
            setNotice(null);
          }
          return;
        case "open-file":
          e.preventDefault();
          void openFile();
          return;
        case "open-folder":
          e.preventDefault();
          void openFolder();
          return;
        case "new-window":
          e.preventDefault();
          void newWindow();
          return;
        case "find":
          e.preventDefault();
          setFindOpen(true);
          // Ctrl+F again returns to the open bar; opening it already focuses
          // the input through the bar's own mount effect.
          document.querySelector<HTMLInputElement>(".find-bar input")?.focus();
          return;
        case "refresh":
          e.preventDefault();
          void refresh();
          return;
        case "close-window":
          e.preventDefault();
          void closeWindow();
          return;
        case "settings":
          e.preventDefault();
          setSettingsError(null);
          setSettingsOpen(true);
          return;
        case "toggle-left":
          e.preventDefault();
          setShowLeft((value) => !value);
          return;
        case "save-blocked":
          // P0 reads; the web view would otherwise offer to save the page.
          e.preventDefault();
          setNotice("当前版本仅支持阅读，不会保存文件");
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    closeFind,
    closeWindow,
    findOpen,
    newWindow,
    notice,
    openFile,
    openFolder,
    refresh,
    settingsOpen,
  ]);

  return (
    <div className="win">
      <div className="toolbar" role="toolbar" aria-label="工具栏">
        <ToolButton
          label="打开文件"
          icon={<FileText />}
          labeled
          shortcut={SHORTCUT_HINT["open-file"]}
          onClick={() => void openFile()}
        />
        <ToolButton
          label="打开目录"
          icon={<FolderOpen />}
          labeled
          shortcut={SHORTCUT_HINT["open-folder"]}
          onClick={() => void openFolder()}
        />
        <ToolButton
          label="新建窗口"
          icon={<SquarePlus />}
          shortcut={SHORTCUT_HINT["new-window"]}
          onClick={() => void newWindow()}
        />
        <span className="sep" aria-hidden="true" />
        <ToolButton
          label="刷新"
          icon={<RefreshCw />}
          shortcut={SHORTCUT_HINT.refresh}
          disabled={(!doc && !folder) || refreshing}
          onClick={() => void refresh()}
        />
        <ToolButton
          label="查找"
          icon={<Search />}
          shortcut={SHORTCUT_HINT.find}
          onClick={() => setFindOpen(true)}
        />
        <span className="spacer" />
        <ToolButton
          label="左侧栏"
          icon={<PanelLeft />}
          shortcut={SHORTCUT_HINT["toggle-left"]}
          pressed={showLeft}
          onClick={() => setShowLeft((v) => !v)}
        />
        <ToolButton
          label="预留侧栏"
          icon={<PanelRight />}
          hint={wideEnough ? undefined : "窗口较窄，预留侧栏已自动收起"}
          pressed={showRight}
          onClick={toggleRight}
        />
        <ToolButton
          label="设置"
          icon={<Settings />}
          shortcut={SHORTCUT_HINT.settings}
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
          {doc && stale && (
            <div className="stale-banner" role="alert">
              <CircleAlert aria-hidden="true" />
              <span className="txt">{stale}</span>
              <button className="btn text" type="button" disabled={refreshing} onClick={() => void refresh()}>
                重试
              </button>
              <button className="btn text" type="button" onClick={() => void closeDocument()}>
                关闭当前文档
              </button>
            </div>
          )}
          {loadError ? (
            <LoadFailure
              error={loadError}
              onRetry={() => (loadError.kind === "folder" ? void openFolder() : void openFile())}
            />
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
            {refreshing ? (
              <span className="item">
                <RefreshCw aria-hidden="true" />
                刷新中
              </span>
            ) : updatedAt ? (
              <span className="item">
                <CircleCheck aria-hidden="true" />
                已更新 {updatedAt}
              </span>
            ) : null}
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
    // A registered image can still fail when it is fetched (deleted or
    // replaced between render and load): leave a reason, not a broken icon
    // (PRD §7.2, AC-18).
    const onImageError = (event: Event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !root.contains(img)) return;
      const box = document.createElement("div");
      box.className = "limited";
      box.dataset.kind = "image";
      box.dataset.reason = "图片无法加载";
      box.textContent = img.alt || "图片无法加载";
      img.replaceWith(box);
    };
    root.addEventListener("error", onImageError, true);
    // Task list boxes show state and take no input (PRD FR-04).
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      box.setAttribute("aria-readonly", "true");
    }
    renderMath(root);
    void renderDiagrams(root);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("error", onImageError, true);
    };
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
        <h3>{error.kind === "folder" ? "无法打开文件夹" : "无法打开文件"}</h3>
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
  /** The keyboard shortcut, shown on hover and exposed to assistive tech. */
  shortcut?: string;
  /** Extra explanation for the tooltip when there is no shortcut. */
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function ToolButton({ label, icon, labeled, shortcut, hint, pressed, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      className={labeled ? "tb labeled" : "tb"}
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut?.replaceAll("Ctrl+", "Control+")}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      title={shortcut ? `${label}（${shortcut}）` : hint}
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

/** nowHM is the status bar's "已更新 14:32" (DESIGN.md §8.8). */
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** scanNotice says which bound stopped the scan and what it left out. */
function scanNotice(frame: ScanFrame): string | null {
  const parts: string[] = [];
  if (frame.truncated) {
    const bound = frame.bound === "markdown" ? "文件数量" : frame.bound === "depth" ? "目录深度" : "条目数量";
    const skipped = frame.skipped ? `，另有 ${frame.skipped} 项未包含` : "";
    parts.push(`结果不完整：达到${bound}上限${skipped}`);
  } else if (frame.skipped) {
    parts.push(`已跳过 ${frame.skipped} 项链接、联接或超出深度的目录`);
  }
  if (frame.unreadable) {
    parts.push(`部分目录无法访问（${frame.unreadable} 个），可重试`);
  }
  return parts.length > 0 ? parts.join("；") : null;
}
