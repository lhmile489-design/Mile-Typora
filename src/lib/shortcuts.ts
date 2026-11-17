// The P0 shortcut table (PRD FR-09): one place maps a key press to the
// command it runs, so every shortcut has a test and the page has one switch.
// Shortcuts only work while the app window is focused: the listener lives on
// window, and nothing registers a system-wide hotkey (PRD FR-09).

export type Command =
  | "open-file"
  | "open-folder"
  | "new-window"
  | "new-document"
  | "find"
  | "refresh"
  | "close-window"
  | "settings"
  | "toggle-left"
  | "view-outline"
  | "view-list"
  | "view-tree"
  | "search-folder"
  | "toggle-source"
  | "save-blocked"
  | "save-as"
  | "print-document"
  | "focus-mode"
  | "typewriter-mode"
  | "fullscreen"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "next-window"
  | "previous-window"
  | "copy-markdown"
  | "paste"
  | "paste-plain"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "paragraph"
  | "heading-promote"
  | "heading-demote"
  | "quote"
  | "formula-block"
  | "code-block"
  | "ordered-list"
  | "unordered-list"
  | "task-list"
  | "bold"
  | "italic"
  | "inline-code"
  | "strikethrough"
  | "link"
  | "clear-format"
  | "underline"
  | "move-line-up"
  | "move-line-down"
  | "dismiss";

/** The keyboard fields the table reads. */
export type KeyPress = {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** True while an input method composes; its key presses are the IME's. */
  isComposing?: boolean;
  /** 229 marks the key event a composition reports on old browsers. */
  keyCode?: number;
  /** True while the key is held down; its repeats run nothing again. */
  repeat?: boolean;
};

/**
 * commandFor returns the command a key press runs, or null. Ctrl+C is not
 * here: copying the selection is the web view's own job (PRD FR-09).
 */
export function commandFor(e: KeyPress): Command | null {
  // An input method must keep its keys: composing Chinese text with Ctrl
  // chords would otherwise open dialogs under the candidate window.
  if (e.isComposing || e.keyCode === 229) return null;
  // Holding a key repeats keydown; a repeated shortcut would open a window
  // per repeat (Ctrl+Shift+N) or close several (Ctrl+W).
  if (e.repeat) return null;

  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (!ctrl && !shift && !e.altKey && key === "F5") return "refresh";
  if (!ctrl && !shift && !e.altKey && key === "F8") return "focus-mode";
  if (!ctrl && !shift && !e.altKey && key === "F9") return "typewriter-mode";
  if (!ctrl && !shift && !e.altKey && key === "F11") return "fullscreen";
  if (!ctrl && !shift && !e.altKey && key === "Escape") return "dismiss";
  if (e.ctrlKey && !e.altKey && !e.metaKey && key === "Tab") {
    return shift ? "previous-window" : "next-window";
  }
  if (!e.ctrlKey && shift && e.altKey && !e.metaKey && (key === "p" || key === "P")) return "print-document";
  if (!e.ctrlKey && shift && e.altKey && !e.metaKey && (key === "5" || key === "%")) return "strikethrough";
  if (!e.ctrlKey && !shift && e.altKey && !e.metaKey && key === "ArrowUp") return "move-line-up";
  if (!e.ctrlKey && !shift && e.altKey && !e.metaKey && key === "ArrowDown") return "move-line-down";
  if (!ctrl) return null;

  if (!shift && key === "o") return "open-file";
  if (shift && key === "o") return "open-folder";
  if (shift && key === "n") return "new-window";
  if (!shift && key === "n") return "new-document";
  if (!shift && key === "f") return "find";
  if (!shift && key === "w") return "close-window";
  if (!shift && key === "s") return "save-blocked";
  if (!shift && key === "/") return "toggle-source";
  if (shift && key === "s") return "save-as";
  if (shift && (key === "=" || key === "+")) return "zoom-in";
  if (shift && (key === "-" || key === "_")) return "zoom-out";
  if (shift && (key === "9" || key === "(")) return "zoom-reset";
  if (shift && key === "c") return "copy-markdown";
  if (shift && key === "v") return "paste-plain";
  if (!shift && key === "v") return "paste";
  if (!shift && key >= "1" && key <= "6") return `heading-${key}` as Command;
  if (!shift && key === "0") return "paragraph";
  if (!shift && key === "=") return "heading-promote";
  if (!shift && key === "-") return "heading-demote";
  if (shift && key === "q") return "quote";
  if (shift && key === "m") return "formula-block";
  if (shift && key === "k") return "code-block";
  if (shift && (key === "[" || key === "{")) return "ordered-list";
  if (shift && (key === "]" || key === "}")) return "unordered-list";
  if (shift && key === "x") return "task-list";
  if (!shift && key === "b") return "bold";
  if (!shift && key === "i") return "italic";
  if (!shift && key === "k") return "link";
  if (!shift && key === "u") return "underline";
  if (!shift && key === "\\") return "clear-format";
  if (shift && (key === "`" || key === "~")) return "inline-code";
  if (!shift && key === ",") return "settings";
  if (shift && key === "l") return "toggle-left";
  if (shift && (key === "1" || key === "!")) return "view-outline";
  if (shift && (key === "2" || key === "@")) return "view-list";
  if (shift && (key === "3" || key === "#")) return "view-tree";
  if (shift && key === "f") return "search-folder";
  return null;
}

/** The shortcut a toolbar command shows, for aria-keyshortcuts and titles. */
export const SHORTCUT_HINT: Partial<Record<Command, string>> = {
  "open-file": "Ctrl+O",
  "open-folder": "Ctrl+Shift+O",
  "new-window": "Ctrl+Shift+N",
  "new-document": "Ctrl+N",
  find: "Ctrl+F",
  refresh: "F5",
  "close-window": "Ctrl+W",
  settings: "Ctrl+,",
  "toggle-left": "Ctrl+Shift+L",
  "view-outline": "Ctrl+Shift+1",
  "view-list": "Ctrl+Shift+2",
  "view-tree": "Ctrl+Shift+3",
  "search-folder": "Ctrl+Shift+F",
  "toggle-source": "Ctrl+/",
  "save-blocked": "Ctrl+S",
  "save-as": "Ctrl+Shift+S",
  "print-document": "Alt+Shift+P",
  "focus-mode": "F8",
  "typewriter-mode": "F9",
  fullscreen: "F11",
  "zoom-in": "Ctrl+Shift+=",
  "zoom-out": "Ctrl+Shift+-",
  "zoom-reset": "Ctrl+Shift+9",
  "next-window": "Ctrl+Tab",
  "previous-window": "Ctrl+Shift+Tab",
  "copy-markdown": "Ctrl+Shift+C",
  "paste-plain": "Ctrl+Shift+V",
  "heading-1": "Ctrl+1",
  "heading-2": "Ctrl+2",
  "heading-3": "Ctrl+3",
  "heading-4": "Ctrl+4",
  "heading-5": "Ctrl+5",
  "heading-6": "Ctrl+6",
  paragraph: "Ctrl+0",
  "heading-promote": "Ctrl+=",
  "heading-demote": "Ctrl+-",
  quote: "Ctrl+Shift+Q",
  "formula-block": "Ctrl+Shift+M",
  "code-block": "Ctrl+Shift+K",
  "ordered-list": "Ctrl+Shift+[",
  "unordered-list": "Ctrl+Shift+]",
  "task-list": "Ctrl+Shift+X",
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  "inline-code": "Ctrl+Shift+`",
  strikethrough: "Alt+Shift+5",
  link: "Ctrl+K",
  underline: "Ctrl+U",
  "clear-format": "Ctrl+\\",
  "move-line-up": "Alt+↑",
  "move-line-down": "Alt+↓",
};
