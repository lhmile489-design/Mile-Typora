// The P0 shortcut table (PRD FR-09): one place maps a key press to the
// command it runs, so every shortcut has a test and the page has one switch.
// Shortcuts only work while the app window is focused: the listener lives on
// window, and nothing registers a system-wide hotkey (PRD FR-09).

export type Command =
  | "open-file"
  | "open-folder"
  | "new-window"
  | "find"
  | "refresh"
  | "close-window"
  | "settings"
  | "toggle-left"
  | "save-blocked"
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
  if (!ctrl && !shift && !e.altKey && key === "Escape") return "dismiss";
  if (!ctrl) return null;

  if (!shift && key === "o") return "open-file";
  if (shift && key === "o") return "open-folder";
  if (shift && key === "n") return "new-window";
  if (!shift && key === "f") return "find";
  if (!shift && key === "w") return "close-window";
  if (!shift && key === "s") return "save-blocked";
  if (!shift && key === ",") return "settings";
  if (shift && key === "l") return "toggle-left";
  return null;
}

/** The shortcut a toolbar command shows, for aria-keyshortcuts and titles. */
export const SHORTCUT_HINT: Partial<Record<Command, string>> = {
  "open-file": "Ctrl+O",
  "open-folder": "Ctrl+Shift+O",
  "new-window": "Ctrl+Shift+N",
  find: "Ctrl+F",
  refresh: "F5",
  "close-window": "Ctrl+W",
  settings: "Ctrl+,",
  "toggle-left": "Ctrl+Shift+L",
  "save-blocked": "Ctrl+S",
};
