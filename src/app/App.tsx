import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  PanelLeft,
  PanelRight,
  Pencil,
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
  SaveAllSummary,
  SaveOutcome,
  ScanFrame,
  Transport,
  TreeEntry,
} from "../lib/transport";
import { failureMessage, failureText, formatBytes } from "../lib/errors";
import { FileTree } from "../components/FileTree";
import { SaveConflictDialog } from "../components/SaveConflictDialog";
import { SaveAllDialog } from "../components/SaveAllDialog";
import { MenuBar, type MenuGroup } from "../components/MenuBar";
import { RecentDialog } from "../components/RecentDialog";
import { HelpDialog } from "../components/HelpDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { UnsavedDialog } from "../components/UnsavedDialog";
import { FindBar } from "../components/FindBar";
import { SourceEditor, type SourceCommands } from "../components/SourceEditor";
import { advance, clearHighlights, collectRanges, paint, scrollToRange } from "../render/find";
import { capture, metricsOf, restore, type Position } from "../render/position";
import { renderMath } from "../render/math";
import { renderDiagrams, rerenderDiagrams } from "../render/mermaid";
import { commandFor, SHORTCUT_HINT, type Command } from "../lib/shortcuts";

type ReadyState =
  | { kind: "waiting" }
  | { kind: "ready"; info: ReadyInfo }
  | { kind: "failed"; message: string };

type LoadError = { code: string; message: string; kind: "file" | "folder" };
type ViewMode = "reading" | "editing" | "preview";

/**
 * The window shell, laid out after artboard 2 of the design draft
 * (DESIGN.md §8.1, §8.8–§8.11). Toolbar commands appear once their stage
 * wires them; until then they are disabled rather than absent, so the
 * toolbar matches the design and nothing looks clickable that is not.
 */
type MenuState = {
  editing: boolean;
  canSave: boolean;
  hasDoc: boolean;
  saveAllRunning: boolean;
  saving: boolean;
  promptOpen: boolean;
  recentCount: number;
};

function buildMenus(state: MenuState): MenuGroup[] {
  const reason = "源码编辑模式下可用";
  const editing = (id: string, label: string, shortcut?: string, disabled = !state.editing, why = reason) => ({
    id,
    label,
    shortcut,
    disabled,
    reason: disabled ? why : undefined,
  });
  const item = (id: string, label: string, shortcut?: string) => ({ id, label, shortcut });
  const sep = { kind: "separator" as const };
  return [
    {
      id: "file",
      label: "文件",
      items: [
        editing("new-document", "新建", "Ctrl+N", false),
        item("new-window", "新建窗口", "Ctrl+Shift+N"),
        item("open-file", "打开…", "Ctrl+O"),
        item("open-folder", "打开文件夹…", "Ctrl+Shift+O"),
        sep,
        editing("recent", "最近打开…", undefined, state.recentCount === 0, "还没有最近记录"),
        sep,
        editing("save", "保存", "Ctrl+S", !state.canSave || state.saving || state.promptOpen, state.saving ? "正在保存" : state.promptOpen ? "先处理当前保存提示" : "打开文档后可保存"),
        editing("save-as", "另存为…", "Ctrl+Shift+S", !state.canSave || state.saving || state.promptOpen, state.saving ? "正在保存" : state.promptOpen ? "先处理当前保存提示" : "打开文档后可另存为"),
        editing("save-all", "保存全部…", undefined, state.saveAllRunning || state.promptOpen || state.saving, state.saving ? "正在保存" : state.promptOpen ? "先处理当前保存提示" : "保存全部正在进行"),
        sep,
        item("settings", "偏好设置…", "Ctrl+,"),
        item("close", "关闭", "Ctrl+W"),
      ],
    },
    {
      id: "edit",
      label: "编辑",
      items: [
        editing("undo", "撤销", "Ctrl+Z"),
        editing("redo", "重做", "Ctrl+Y"),
        sep,
        editing("cut", "剪切", "Ctrl+X"),
        item("copy", "复制", "Ctrl+C"),
        editing("paste", "粘贴", "Ctrl+V"),
        editing("paste-plain", "粘贴为纯文本", "Ctrl+Shift+V"),
        editing("copy-markdown", "复制为 Markdown", "Ctrl+Shift+C"),
        sep,
        editing("select-all", "全选", "Ctrl+A"),
        editing("select-line", "选择当前行"),
        editing("select-paragraph", "选择当前段落"),
        sep,
        editing("move-line-up", "上移该行", "Alt+↑"),
        editing("move-line-down", "下移该行", "Alt+↓"),
        editing("delete", "删除"),
        sep,
        item("find", "查找和替换…", "Ctrl+F"),
      ],
    },
    {
      id: "paragraph",
      label: "段落",
      items: [
        editing("heading-1", "一级标题", "Ctrl+1"),
        editing("heading-2", "二级标题", "Ctrl+2"),
        editing("heading-3", "三级标题", "Ctrl+3"),
        editing("heading-4", "四级标题", "Ctrl+4"),
        editing("heading-5", "五级标题", "Ctrl+5"),
        editing("heading-6", "六级标题", "Ctrl+6"),
        editing("paragraph", "普通段落", "Ctrl+0"),
        sep,
        editing("heading-promote", "提升标题级别", "Ctrl+="),
        editing("heading-demote", "降低标题级别", "Ctrl+-"),
        sep,
        editing("quote", "引用", "Ctrl+Shift+Q"),
        editing("formula-block", "公式块", "Ctrl+Shift+M"),
        editing("code-block", "代码块", "Ctrl+Shift+K"),
        sep,
        editing("ordered-list", "有序列表", "Ctrl+Shift+["),
        editing("unordered-list", "无序列表", "Ctrl+Shift+]"),
        editing("task-list", "任务列表", "Ctrl+Shift+X"),
        editing("task-done", "任务状态：已完成"),
        editing("task-todo", "任务状态：未完成"),
        editing("indent-in", "增加列表缩进"),
        editing("indent-out", "减少列表缩进"),
        sep,
        editing("paragraph-above", "在上方插入段落"),
        editing("paragraph-below", "在下方插入段落"),
        editing("horizontal-rule", "水平分割线"),
      ],
    },
    {
      id: "format",
      label: "格式",
      items: [
        editing("bold", "加粗", "Ctrl+B"),
        editing("italic", "斜体", "Ctrl+I"),
        editing("inline-code", "代码", "Ctrl+Shift+反引号"),
        editing("strikethrough", "删除线", "Alt+Shift+5"),
        editing("link", "超链接", "Ctrl+K"),
        editing("clear-format", "清除样式", "Ctrl+\\"),
      ],
    },
    {
      id: "view",
      label: "视图",
      items: [
        editing("toggle-source", "源码 / 预览模式", "Ctrl+/", !state.hasDoc, "尚未打开文档"),
      ],
    },
    {
      id: "help",
      label: "帮助",
      items: [item("help-shortcuts", "快捷键说明"), item("help-about", "关于 Mile Typora")],
    },
  ];
}

/** Editor commands that only run while the source editor has focus (PRD 15.1). */
const EDITOR_ACTIONS: Partial<Record<Command, (editor: SourceCommands) => boolean>> = {
  "heading-1": (editor) => editor.setHeading(1),
  "heading-2": (editor) => editor.setHeading(2),
  "heading-3": (editor) => editor.setHeading(3),
  "heading-4": (editor) => editor.setHeading(4),
  "heading-5": (editor) => editor.setHeading(5),
  "heading-6": (editor) => editor.setHeading(6),
  paragraph: (editor) => editor.setParagraph(),
  "heading-promote": (editor) => editor.promoteHeading(),
  "heading-demote": (editor) => editor.demoteHeading(),
  quote: (editor) => editor.toggleQuote(),
  "formula-block": (editor) => editor.insertFormulaBlock(),
  "code-block": (editor) => editor.insertCodeBlock(),
  "ordered-list": (editor) => editor.toggleOrderedList(),
  "unordered-list": (editor) => editor.toggleUnorderedList(),
  "task-list": (editor) => editor.toggleTaskList(),
  bold: (editor) => editor.toggleBold(),
  italic: (editor) => editor.toggleItalic(),
  "inline-code": (editor) => editor.toggleInlineCode(),
  strikethrough: (editor) => editor.toggleStrikethrough(),
  link: (editor) => editor.insertLink(),
  "clear-format": (editor) => editor.clearFormatting(),
  "move-line-up": (editor) => editor.moveLine("up"),
  "move-line-down": (editor) => editor.moveLine("down"),
};

export function App({ transport }: { transport: Transport }) {
  const [ready, setReady] = useState<ReadyState>({ kind: "waiting" });
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [doc, setDoc] = useState<OpenedDoc | null>(null);
  // M4-1: one buffer per window; preview renders the same string through Go.
  const [mode, setMode] = useState<ViewMode>("reading");
  const [buffer, setBuffer] = useState("");
  const [preview, setPreview] = useState<{ html: string; counts: OpenedDoc["counts"] } | null>(null);
  // M4-2: the buffer is dirty when it differs from the last saved/loaded text.
  const [savedText, setSavedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [unsavedError, setUnsavedError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ kind: "conflict" | "missing"; message: string } | null>(null);
  const [saveAllSummary, setSaveAllSummary] = useState<SaveAllSummary | null>(null);
  const [saveAllRunning, setSaveAllRunning] = useState(false);
  const saveAllTimer = useRef<number | null>(null);
  const savingRef = useRef(false);
  const unsavedOpenRef = useRef(false);
  unsavedOpenRef.current = unsavedOpen;
  const conflictOpenRef = useRef(false);
  conflictOpenRef.current = conflict !== null;
  const [recentOpen, setRecentOpen] = useState(false);
  const [helpKind, setHelpKind] = useState<"shortcuts" | "about" | null>(null);
  const saveAllConflict = useRef<number | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const editorRef = useRef<SourceCommands | null>(null);
  const dirty = mode !== "reading" && buffer !== savedText;
  const untitledCount = useRef(0);
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
  const [findReplacement, setFindReplacement] = useState("");
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
  const modeRef = useRef<ViewMode>("reading");
  const bufferRef = useRef("");
  const dirtyRef = useRef(false);
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
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Go needs the dirty flag for the native close prompt, and the hash the
  // buffer started from for save conflicts (PRD 10.2, 10.3).
  useEffect(() => {
    if (!doc) return;
    void transport.setEditState(dirty, doc.hash, doc.hasBom, doc.lineEnding);
  }, [dirty, doc, transport]);

  const holdForDirty = useCallback((action: () => void) => {
    pendingAction.current = action;
    setUnsavedError(null);
    setUnsavedOpen(true);
  }, []);

  // Ctrl+N: an unsaved buffer, no file written until the user saves it.
  const startUntitled = useCallback(() => {
    untitledCount.current += 1;
    const untitled: OpenedDoc = {
      name: `未命名-${untitledCount.current}`,
      path: "",
      size: 0,
      hasBom: false,
      lineEnding: "LF",
      hash: "",
      text: "",
      html: "",
      counts: { math: 0, mathLimited: 0, mermaid: 0, mermaidLimited: 0 },
    };
    setDoc(untitled);
    setBuffer("");
    setSavedText("");
    setMode("editing");
    setPreview(null);
    setLoadError(null);
    setStale(null);
    setUpdatedAt(null);
    setSelected(null);
    setFindOpen(false);
    clearHighlights();
    void transport.clearStartUntitled();
  }, [transport]);

  useEffect(() => {
    return transport.onNotice((notice) => setNotice(notice.text));
  }, [transport]);

  // A change outside the app replaces the document, or marks it stale when
  // the file cannot be read any more (PRD FR-07.1, FR-07.5, FR-07.11).
  useEffect(() => {
    return transport.onDocUpdated((update: DocUpdate) => {
      if (update.seq <= updateSeq.current) return;
      updateSeq.current = update.seq;
      if (modeRef.current !== "reading") {
        setNotice("编辑中，外部修改暂未应用");
        return;
      }
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
          setMode("reading");
          setBuffer(result.doc.text);
          setSavedText(result.doc.text);
          setPreview(null);
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

  // M4-1 has no save yet, so an open that would replace the buffer is held
  // back until M4-2 brings the save/discard prompt.
  // Opening what a request names: a double-clicked file, a command-line
  // argument, or another instance's request (PRD FR-02.8, docs/踩坑记录.md).
  const openRequested = useCallback(
    async (seq: number) => {
      if (dirtyRef.current) {
        holdForDirty(() => void openRequested(seq));
        return;
      }
      applyOutcome(await transport.openRequested(seq));
    },
    [applyOutcome, holdForDirty, transport],
  );

  // A click in the tree opens the file here; its arrow opens it elsewhere.
  const openRecent = useCallback(
    async (entry: RecentEntry) => {
      if (dirtyRef.current) {
        holdForDirty(() => void openRecent(entry));
        return;
      }
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
    [applyOutcome, holdForDirty, transport],
  );

  const openTreeFile = useCallback(
    async (entry: TreeEntry, newWindow: boolean) => {
      if (dirtyRef.current) {
        holdForDirty(() => void openTreeFile(entry, newWindow));
        return;
      }
      setSelected(entry.path);
      applyOutcome(await transport.openTreeFile(entry.path, newWindow));
    },
    [applyOutcome, holdForDirty, transport],
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
      if (r.value.startUntitled && !docRef.current) startUntitled();
      const pending = await transport.pending(0);
      if (!alive || !pending.ok) return;
      pending.value.forEach(add);
    });
    return () => {
      alive = false;
      off();
    };
  }, [openRequested, startUntitled, transport]);

  // Opening a file replaces what the window shows; cancelling changes nothing.
  const openFile = useCallback(async () => {
    if (dirtyRef.current) {
      holdForDirty(() => void openFile());
      return;
    }
    setNotice(null);
    const result = await transport.openFile();
    if (result.kind === "loaded") {
      setDoc(result.doc);
      setMode("reading");
      setBuffer(result.doc.text);
      setSavedText(result.doc.text);
      setPreview(null);
      setLoadError(null);
      setStale(null);
      setUpdatedAt(nowHM());
    } else if (result.kind === "failed") {
      if (docRef.current || folderRef.current) setNotice(result.message);
      else setLoadError({ code: result.code, message: result.message, kind: "file" });
    }
  }, [holdForDirty, transport]);

  // Opening a folder replaces the tree, dropping any scan still running.
  const openFolder = useCallback(async () => {
    if (dirtyRef.current) {
      holdForDirty(() => void openFolder());
      return;
    }
    setNotice(null);
    const result = await transport.openFolder();
    if (result.kind === "failed") {
      if (docRef.current || folderRef.current) setNotice(result.message);
      else setLoadError({ code: result.code, message: result.message, kind: "folder" });
      return;
    }
    if (result.kind !== "opened") return;
    startScan(result.root, result.name);
  }, [holdForDirty, startScan, transport]);

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
    if (modeRef.current !== "reading") {
      setNotice("编辑中不刷新，请先保存或放弃修改");
      return;
    }
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
    if (dirtyRef.current) {
      holdForDirty(() => void closeDocument());
      return;
    }
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
    setMode("reading");
    setPreview(null);
  }, [holdForDirty, transport]);

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

  const newDocument = useCallback(async () => {
    if (dirtyRef.current) {
      holdForDirty(() => void newDocument());
      return;
    }
    const result = await transport.newDocument();
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    if (ready.kind === "ready" && result.value === ready.info.windowId) {
      startUntitled();
    }
  }, [holdForDirty, ready, startUntitled, transport]);

  // Ctrl+W closes this window; the app quits with its last window (PRD FR-09).
  const forceClose = useCallback(async () => {
    const result = await transport.closeWindow(true);
    if (!result.ok) setNotice(result.message);
  }, [transport]);

  const requestClose = useCallback(() => {
    if (!dirtyRef.current) {
      void forceClose();
      return;
    }
    holdForDirty(() => void forceClose());
  }, [forceClose, holdForDirty]);

  useEffect(() => {
    return transport.onCloseRequested(() => requestClose());
  }, [requestClose, transport]);

  // M4-2: the buffer is saved through the window's file, or through Save As
  // when it has none. A conflict opens the explicit overwrite prompt.
  const applySaved = useCallback((result: Extract<SaveOutcome, { kind: "saved" }>) => {
    const text = bufferRef.current;
    setDoc((prev) =>
      prev
        ? {
            ...prev,
            path: result.path || prev.path,
            name: result.name || prev.name,
            size: result.size,
            hasBom: result.hasBom,
            lineEnding: result.lineEnding,
            hash: result.hash,
            text,
          }
        : prev,
    );
    setSavedText(text);
    dirtyRef.current = false;
    setUpdatedAt(nowHM());
    setNotice("已保存");
  }, []);

  const saveBufferAs = useCallback(async (): Promise<boolean> => {
    if (!docRef.current || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const result = await transport.saveDocumentAs(bufferRef.current);
    savingRef.current = false;
    setSaving(false);
    if (result.kind === "saved") {
      applySaved(result);
      return true;
    }
    if (result.kind === "cancelled") return false;
    setSaveError(result.message);
    setUnsavedError(result.message);
    setNotice(result.message);
    return false;
  }, [applySaved, transport]);

  const saveBuffer = useCallback(
    async (force = false): Promise<boolean> => {
      if (!docRef.current || savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const result = await transport.saveDocument(bufferRef.current, force);
      savingRef.current = false;
      setSaving(false);
      if (result.kind === "saved") {
        applySaved(result);
        return true;
      }
      if (result.kind === "cancelled") return false;
      if (result.code === "no_path") return saveBufferAs();
      if (result.code === "conflict" || result.code === "missing") {
        setUnsavedOpen(false);
        setConflict({ kind: result.code, message: result.message });
        return false;
      }
      setSaveError(result.message);
      setUnsavedError(result.message);
      setNotice(result.message);
      return false;
    },
    [applySaved, saveBufferAs, transport],
  );

  const reportSaveAll = useCallback(
    async (requestId: number, status: string, message = "", reportName?: string) => {
      const name = reportName || docRef.current?.name || "未命名";
      const result = await transport.reportSaveAll(requestId, name, status, message);
      if (!result.ok) setNotice(result.message);
    },
    [transport],
  );

  const saveAllAsStep = useCallback(
    async (requestId: number) => {
      if (savingRef.current) {
        await reportSaveAll(requestId, "unhandled", "窗口正在保存");
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const result = await transport.saveDocumentAs(bufferRef.current);
      savingRef.current = false;
      setSaving(false);
      if (result.kind === "saved") {
        applySaved(result);
        await reportSaveAll(requestId, "saved", "", result.name);
        return;
      }
      if (result.kind === "cancelled") {
        await reportSaveAll(requestId, "unhandled", "已取消另存为");
        return;
      }
      await reportSaveAll(requestId, "failed", result.message);
    },
    [applySaved, reportSaveAll, transport],
  );

  const saveAllForceStep = useCallback(
    async (requestId: number) => {
      if (savingRef.current) {
        await reportSaveAll(requestId, "unhandled", "窗口正在保存");
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const result = await transport.saveDocument(bufferRef.current, true);
      savingRef.current = false;
      setSaving(false);
      if (result.kind === "saved") {
        applySaved(result);
        await reportSaveAll(requestId, "saved", "", result.name);
        return;
      }
      await reportSaveAll(requestId, "failed", result.kind === "cancelled" ? "已取消" : result.message);
    },
    [applySaved, reportSaveAll, transport],
  );

  const saveAllStep = useCallback(
    async (requestId: number) => {
      if (unsavedOpenRef.current || conflictOpenRef.current) {
        await reportSaveAll(requestId, "unhandled", "窗口有未处理的保存提示");
        return;
      }
      if (savingRef.current) {
        await reportSaveAll(requestId, "unhandled", "窗口正在保存");
        return;
      }
      if (!docRef.current || !dirtyRef.current) {
        await reportSaveAll(requestId, "clean");
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const result = await transport.saveDocument(bufferRef.current, false);
      savingRef.current = false;
      setSaving(false);
      if (result.kind === "saved") {
        applySaved(result);
        await reportSaveAll(requestId, "saved", "", result.name);
        return;
      }
      if (result.kind === "cancelled") {
        await reportSaveAll(requestId, "unhandled", "已取消保存");
        return;
      }
      if (result.code === "no_path") {
        await saveAllAsStep(requestId);
        return;
      }
      if (result.code === "conflict" || result.code === "missing") {
        saveAllConflict.current = requestId;
        setUnsavedOpen(false);
        setConflict({ kind: result.code, message: result.message });
        return;
      }
      await reportSaveAll(requestId, "failed", result.message);
    },
    [applySaved, reportSaveAll, saveAllAsStep, transport],
  );

  const startSaveAll = useCallback(async () => {
    if (saveAllRunning || savingRef.current || unsavedOpenRef.current || conflictOpenRef.current) return;
    setSaveAllRunning(true);
    setNotice("正在保存全部…");
    if (saveAllTimer.current !== null) window.clearTimeout(saveAllTimer.current);
    saveAllTimer.current = window.setTimeout(() => {
      setSaveAllRunning(false);
      setNotice("保存全部超时，请重试");
    }, 6 * 60 * 1000);
    const result = await transport.saveAll();
    if (!result.ok) {
      if (saveAllTimer.current !== null) window.clearTimeout(saveAllTimer.current);
      setSaveAllRunning(false);
      setNotice(result.message);
    }
  }, [saveAllRunning, transport]);

  useEffect(() => {
    return () => {
      if (saveAllTimer.current !== null) window.clearTimeout(saveAllTimer.current);
    };
  }, []);

  useEffect(() => {
    return transport.onSaveAllRequest((requestId) => {
      void saveAllStep(requestId);
    });
  }, [saveAllStep, transport]);

  useEffect(() => {
    return transport.onSaveAllDone((summary) => {
      if (saveAllTimer.current !== null) {
        window.clearTimeout(saveAllTimer.current);
        saveAllTimer.current = null;
      }
      setSaveAllRunning(false);
      setSaveAllSummary(summary);
      setNotice(`保存全部完成：已保存 ${summary.saved}，失败 ${summary.failed}，未处理 ${summary.unhandled}`);
    });
  }, [transport]);

  const continuePending = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    setUnsavedOpen(false);
    setUnsavedError(null);
    setConflict(null);
    if (action) action();
  }, []);

  const discardChanges = useCallback(() => {
    const current = docRef.current;
    if (current) {
      setBuffer(current.text);
      setSavedText(current.text);
    }
    dirtyRef.current = false;
    continuePending();
  }, [continuePending]);

  const save = useCallback(async () => {
    if (conflictOpenRef.current || unsavedOpenRef.current) return;
    if (modeRef.current === "reading") {
      setNotice("阅读模式没有可保存的修改");
      return;
    }
    const ok = await saveBuffer(false);
    if (ok) {
      if (pendingAction.current) continuePending();
      else setUnsavedOpen(false);
    }
  }, [continuePending, saveBuffer]);

  const saveAs = useCallback(async () => {
    if (conflictOpenRef.current || unsavedOpenRef.current) return;
    if (modeRef.current === "reading") {
      setNotice("阅读模式没有可保存的修改");
      return;
    }
    const ok = await saveBufferAs();
    if (ok) {
      if (pendingAction.current) continuePending();
      else setUnsavedOpen(false);
    }
  }, [continuePending, saveBufferAs]);

  // M4-1: Ctrl+/ enters source editing, shows the preview, or returns to the
  // source. The buffer stays in the window; no file is written (M4-2 saves).
  const toggleSource = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    if (modeRef.current === "reading") {
      setBuffer(current.text);
      setPreview(null);
      setFindOpen(false);
      clearHighlights();
      setMode("editing");
      return;
    }
    if (modeRef.current === "editing") {
      const result = await transport.renderSource(buffer);
      if (result.kind === "failed") {
        setNotice(result.message);
        return;
      }
      setPreview({ html: result.html, counts: result.counts });
      setFindOpen(false);
      clearHighlights();
      setMode("preview");
      return;
    }
    setFindOpen(false);
    clearHighlights();
    setMode("editing");
  }, [buffer, transport]);

  const onMenuCommand = useCallback(
    (id: string) => {
      const editor = editorRef.current;
      const inEditor = modeRef.current === "editing" && editor !== null;
      const run = (fn: (commands: SourceCommands) => void) => {
        if (inEditor && editor) fn(editor);
      };
      switch (id) {
        case "new-document": void newDocument(); return;
        case "new-window": void newWindow(); return;
        case "open-file": void openFile(); return;
        case "open-folder": void openFolder(); return;
        case "recent": setRecentOpen(true); return;
        case "save": void save(); return;
        case "save-as": void saveAs(); return;
        case "save-all": void startSaveAll(); return;
        case "settings": setSettingsError(null); setSettingsOpen(true); return;
        case "close": requestClose(); return;
        case "undo": run((c) => c.undo()); return;
        case "redo": run((c) => c.redo()); return;
        case "cut": run((c) => void c.cut()); return;
        case "copy":
          if (inEditor && editor) {
            void editor.copy();
          } else {
            const selected = window.getSelection()?.toString() ?? "";
            if (selected !== "") {
              void transport.writeClipboardText(selected).then((result) => {
                if (!result.ok) setNotice(result.message);
              });
            }
          }
          return;
        case "paste": run((c) => void c.paste()); return;
        case "paste-plain": run((c) => void c.pastePlain()); return;
        case "copy-markdown": run((c) => void c.copyMarkdown()); return;
        case "select-all": run((c) => c.selectAll()); return;
        case "select-line": run((c) => c.selectLine()); return;
        case "select-paragraph": run((c) => c.selectParagraph()); return;
        case "move-line-up": run((c) => c.moveLine("up")); return;
        case "move-line-down": run((c) => c.moveLine("down")); return;
        case "delete": run((c) => c.deleteForward()); return;
        case "find":
          setFindOpen(true);
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".find-bar input")?.focus());
          return;
        case "heading-1": run((c) => c.setHeading(1)); return;
        case "heading-2": run((c) => c.setHeading(2)); return;
        case "heading-3": run((c) => c.setHeading(3)); return;
        case "heading-4": run((c) => c.setHeading(4)); return;
        case "heading-5": run((c) => c.setHeading(5)); return;
        case "heading-6": run((c) => c.setHeading(6)); return;
        case "paragraph": run((c) => c.setParagraph()); return;
        case "heading-promote": run((c) => c.promoteHeading()); return;
        case "heading-demote": run((c) => c.demoteHeading()); return;
        case "quote": run((c) => c.toggleQuote()); return;
        case "formula-block": run((c) => c.insertFormulaBlock()); return;
        case "code-block": run((c) => c.insertCodeBlock()); return;
        case "ordered-list": run((c) => c.toggleOrderedList()); return;
        case "unordered-list": run((c) => c.toggleUnorderedList()); return;
        case "task-list": run((c) => c.toggleTaskList()); return;
        case "task-done": run((c) => c.setTaskStatus(true)); return;
        case "task-todo": run((c) => c.setTaskStatus(false)); return;
        case "indent-in": run((c) => c.indentList("in")); return;
        case "indent-out": run((c) => c.indentList("out")); return;
        case "paragraph-above": run((c) => c.insertParagraph("above")); return;
        case "paragraph-below": run((c) => c.insertParagraph("below")); return;
        case "horizontal-rule": run((c) => c.insertHorizontalRule()); return;
        case "bold": run((c) => c.toggleBold()); return;
        case "italic": run((c) => c.toggleItalic()); return;
        case "inline-code": run((c) => c.toggleInlineCode()); return;
        case "strikethrough": run((c) => c.toggleStrikethrough()); return;
        case "link": run((c) => c.insertLink()); return;
        case "clear-format": run((c) => c.clearFormatting()); return;
        case "toggle-source": void toggleSource(); return;
        case "help-shortcuts": setHelpKind("shortcuts"); return;
        case "help-about": setHelpKind("about"); return;
      }
    },
    [newDocument, newWindow, openFile, openFolder, requestClose, save, saveAs, startSaveAll, toggleSource, transport],
  );

  // Links in the preview do not replace the buffer before M4-2's protection.
  const handlePreviewLink = useCallback((href: string) => {
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      document.getElementById(id)?.scrollIntoView({ block: "start" });
      return;
    }
    setNotice("编辑预览中暂不打开链接");
  }, []);

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
    if (!findOpen || mode === "editing") {
      clearHighlights();
      findRanges.current = [];
      if (!findOpen) setFindCount(0);
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
  }, [findOpen, findQuery, doc?.html, mode]);

  // Source editing searches the buffer, not the rendered DOM. The find input
  // keeps focus; the editor only moves its selection.
  useEffect(() => {
    if (!findOpen || mode !== "editing") return;
    const result = editorRef.current?.find(findQuery);
    if (!result) return;
    setFindCount(result.count);
    setFindIndex(result.index);
  }, [findOpen, findQuery, mode]);

  // Put the reader back where it was in this file (PRD FR-07.3).
  useEffect(() => {
    const scroller = readerRef.current;
    if (!doc || !scroller) return;
    const saved = positions.current.get(doc.path);
    if (saved) scroller.scrollTop = restore(metricsOf(scroller), saved);
  }, [doc?.path, doc?.html]);

  const stepFind = useCallback(
    (backwards: boolean) => {
      if (modeRef.current === "editing") {
        const result = editorRef.current?.stepFind(findQuery, findIndex, backwards);
        if (!result) return;
        setFindCount(result.count);
        setFindIndex(result.index);
        return;
      }
      const ranges = findRanges.current;
      if (ranges.length === 0) return;
      const next = advance(findIndex, ranges.length, backwards);
      setFindIndex(next);
      paint(ranges, next);
      const active = ranges[next];
      if (active) scrollToRange(active);
    },
    [findIndex, findQuery],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
    clearHighlights();
    if (modeRef.current === "editing") editorRef.current?.focus();
  }, []);

  const changeQuery = useCallback((query: string) => {
    setFindQuery(query);
    setFindIndex(0);
  }, []);

  const replaceFind = useCallback(() => {
    if (modeRef.current !== "editing") {
      setNotice("替换仅在源码编辑模式可用");
      return;
    }
    const result = editorRef.current?.replace(findQuery, findReplacement, findIndex);
    if (!result) return;
    setFindCount(result.count);
    setFindIndex(result.index);
  }, [findIndex, findQuery, findReplacement]);

  const replaceAllFind = useCallback(() => {
    if (modeRef.current !== "editing") {
      setNotice("替换仅在源码编辑模式可用");
      return;
    }
    const result = editorRef.current?.replaceAll(findQuery, findReplacement);
    if (!result) return;
    setFindCount(result.count);
    setFindIndex(0);
  }, [findQuery, findReplacement]);

  // One key listener runs the table in src/lib/shortcuts.ts. The find bar
  // and the settings dialog handle their own keys first, so a handled press
  // arrives here already prevented.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const command = commandFor(e);
      if (!command) return;
      if ((settingsOpen || unsavedOpen || conflict !== null || saveAllSummary !== null || recentOpen || helpKind !== null) && command !== "dismiss") return;
      const editorAction = EDITOR_ACTIONS[command];
      if (editorAction) {
        const active = document.activeElement;
        const inEditor = active instanceof HTMLElement && active.closest(".source-editor") !== null;
        if (modeRef.current !== "editing" || !inEditor) return;
        e.preventDefault();
        if (editorRef.current) editorAction(editorRef.current);
        return;
      }
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
        case "new-document":
          e.preventDefault();
          void newDocument();
          return;
        case "find":
          e.preventDefault();
          if (!findOpen) setFindQuery("");
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
          requestClose();
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
        case "toggle-source":
          e.preventDefault();
          void toggleSource();
          return;
        case "save-blocked":
          e.preventDefault();
          void save();
          return;
        case "save-as":
          e.preventDefault();
          void saveAs();
          return;
        case "copy-markdown":
          e.preventDefault();
          if (modeRef.current !== "editing") {
            setNotice("请在源码编辑模式复制 Markdown");
            return;
          }
          void (async () => {
            const ok = await editorRef.current?.copyMarkdown();
            setNotice(ok ? "已复制源码" : "先选择要复制的源码");
          })();
          return;
        case "paste-plain":
          e.preventDefault();
          if (modeRef.current !== "editing") {
            setNotice("请在源码编辑模式粘贴");
            return;
          }
          void (async () => {
            const ok = await editorRef.current?.pastePlain();
            if (!ok) setNotice("无法读取剪贴板，请使用 Ctrl+V");
          })();
          return;
      }
    };
    // Capture so an app shortcut wins over WebView/CodeMirror defaults;
    // commands we do not own fall through untouched.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    closeFind,
    findOpen,
    newDocument,
    newWindow,
    notice,
    openFile,
    openFolder,
    refresh,
    requestClose,
    save,
    saveAs,
    settingsOpen,
    unsavedOpen,
    conflict,
    saveAllSummary,
    recentOpen,
    helpKind,
    toggleSource,
  ]);

  return (
    <div className="win">
      <MenuBar
        menus={buildMenus({
          editing: mode === "editing",
          canSave: mode !== "reading" && Boolean(doc),
          hasDoc: Boolean(doc),
          saveAllRunning,
          saving,
          promptOpen: unsavedOpen || conflict !== null,
          recentCount: recent.length,
        })}
        onCommand={onMenuCommand}
      />
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
              editing={mode === "editing"}
              replacement={findReplacement}
              onReplacementChange={setFindReplacement}
              onReplace={replaceFind}
              onReplaceAll={replaceAllFind}
            />
          )}
          {doc && stale && mode === "reading" && (
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
          {mode === "editing" && doc ? (
            <SourceEditor
              ref={editorRef}
              value={buffer}
              onChange={setBuffer}
              readClipboard={async () => {
                const result = await transport.readClipboardText();
                return result.ok ? result.value : null;
              }}
              writeClipboard={async (text) => (await transport.writeClipboardText(text)).ok}
            />
          ) : mode === "preview" && doc && preview ? (
            <Reader
              doc={{ ...doc, html: preview.html, text: buffer, counts: preview.counts }}
              scrollerRef={readerRef}
              onLink={handlePreviewLink}
            />
          ) : loadError ? (
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
              {mode === "reading" ? (
                <>
                  <Lock aria-hidden="true" />
                  只读
                </>
              ) : mode === "editing" ? (
                <>
                  <Pencil aria-hidden="true" />
                  编辑中
                </>
              ) : (
                <>
                  <Eye aria-hidden="true" />
                  预览
                </>
              )}
            </span>
            <span className="item" title={doc.path}>
              {doc.name}
            </span>
            {mode !== "reading" && (
              <span className="item">{mode === "editing" ? "Ctrl+/ 预览" : "Ctrl+/ 返回编辑"}</span>
            )}
            {dirty && (
              <span className="item st-danger">
                <CircleAlert aria-hidden="true" />
                未保存
              </span>
            )}
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
          <span className={notice.startsWith("已保存") ? "item st-ok" : "item st-danger"}>
            <CircleAlert aria-hidden="true" />
            {notice}
          </span>
        )}
        <ReadyBadge state={ready} />
      </footer>
      {unsavedOpen && (
        <UnsavedDialog
          saving={saving}
          error={unsavedError}
          onSave={() => void save()}
          onDiscard={discardChanges}
          onCancel={() => {
            pendingAction.current = null;
            setUnsavedOpen(false);
            setUnsavedError(null);
          }}
        />
      )}
      {conflict && (
        <SaveConflictDialog
          kind={conflict.kind}
          message={conflict.message}
          saving={saving}
          error={saveError}
          onSaveAs={() => {
            const request = saveAllConflict.current;
            if (request !== null) {
              saveAllConflict.current = null;
              setConflict(null);
              setSaveError(null);
              void saveAllAsStep(request);
              return;
            }
            void (async () => {
              if (await saveBufferAs()) continuePending();
            })();
          }}
          onForce={() => {
            const request = saveAllConflict.current;
            if (request !== null) {
              saveAllConflict.current = null;
              setConflict(null);
              setSaveError(null);
              void saveAllForceStep(request);
              return;
            }
            void (async () => {
              if (await saveBuffer(true)) continuePending();
            })();
          }}
          onCancel={() => {
            const request = saveAllConflict.current;
            saveAllConflict.current = null;
            pendingAction.current = null;
            setConflict(null);
            setSaveError(null);
            if (request !== null) void reportSaveAll(request, "unhandled", "已取消保存");
          }}
        />
      )}
      {saveAllSummary && (
        <SaveAllDialog
          rows={saveAllSummary.results}
          saved={saveAllSummary.saved}
          failed={saveAllSummary.failed}
          unhandled={saveAllSummary.unhandled}
          onClose={() => setSaveAllSummary(null)}
        />
      )}
      {recentOpen && (
        <RecentDialog
          entries={recent}
          onOpen={(path) => {
            const entry = recent.find((item) => item.path === path);
            if (entry) {
              setRecentOpen(false);
              void openRecent(entry);
            }
          }}
          onClose={() => setRecentOpen(false)}
        />
      )}
      {helpKind && (
        <HelpDialog
          kind={helpKind}
          version={ready.kind === "ready" ? ready.info.version : ""}
          onClose={() => setHelpKind(null)}
        />
      )}
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
