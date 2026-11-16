import { describe, expect, it } from "vitest";
import { commandFor, type KeyPress } from "./shortcuts";

const base: KeyPress = {
  key: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
};

function press(key: string, mods: Partial<KeyPress> = {}): KeyPress {
  return { ...base, key, ...mods };
}

describe("the P0 shortcut table", () => {
  it.each([
    ["o", { ctrlKey: true }, "open-file"],
    ["O", { ctrlKey: true }, "open-file"],
    ["o", { ctrlKey: true, shiftKey: true }, "open-folder"],
    ["n", { ctrlKey: true, shiftKey: true }, "new-window"],
    ["n", { ctrlKey: true }, "new-document"],
    ["f", { ctrlKey: true }, "find"],
    ["F5", {}, "refresh"],
    ["w", { ctrlKey: true }, "close-window"],
    [",", { ctrlKey: true }, "settings"],
    ["l", { ctrlKey: true, shiftKey: true }, "toggle-left"],
    ["/", { ctrlKey: true }, "toggle-source"],
    ["s", { ctrlKey: true }, "save-blocked"],
    ["1", { ctrlKey: true }, "heading-1"],
    ["6", { ctrlKey: true }, "heading-6"],
    ["0", { ctrlKey: true }, "paragraph"],
    ["=", { ctrlKey: true }, "heading-promote"],
    ["-", { ctrlKey: true }, "heading-demote"],
    ["q", { ctrlKey: true, shiftKey: true }, "quote"],
    ["m", { ctrlKey: true, shiftKey: true }, "formula-block"],
    ["k", { ctrlKey: true, shiftKey: true }, "code-block"],
    ["[", { ctrlKey: true, shiftKey: true }, "ordered-list"],
    ["{", { ctrlKey: true, shiftKey: true }, "ordered-list"],
    ["]", { ctrlKey: true, shiftKey: true }, "unordered-list"],
    ["}", { ctrlKey: true, shiftKey: true }, "unordered-list"],
    ["x", { ctrlKey: true, shiftKey: true }, "task-list"],
    ["b", { ctrlKey: true }, "bold"],
    ["i", { ctrlKey: true }, "italic"],
    ["k", { ctrlKey: true }, "link"],
    ["`", { ctrlKey: true, shiftKey: true }, "inline-code"],
    ["~", { ctrlKey: true, shiftKey: true }, "inline-code"],
    ["\\", { ctrlKey: true }, "clear-format"],
    ["5", { altKey: true, shiftKey: true }, "strikethrough"],
    ["%", { altKey: true, shiftKey: true }, "strikethrough"],
    ["c", { ctrlKey: true, shiftKey: true }, "copy-markdown"],
    ["v", { ctrlKey: true, shiftKey: true }, "paste-plain"],
    ["Escape", {}, "dismiss"],
  ] as const)("%s with %o runs %s", (key, mods, command) => {
    expect(commandFor(press(key, mods))).toBe(command);
  });

  it("leaves keys the app does not own alone", () => {
    expect(commandFor(press("c", { ctrlKey: true }))).toBeNull();
    expect(commandFor(press("v", { ctrlKey: true }))).toBeNull();
    expect(commandFor(press("o", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(commandFor(press("o", { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(commandFor(press("o"))).toBeNull();
    expect(commandFor(press("F5", { shiftKey: true }))).toBeNull();
    expect(commandFor(press("F5", { ctrlKey: true }))).toBeNull();
    expect(commandFor(press("l", { ctrlKey: true }))).toBeNull();
    // The Shift variants stay free for P2 zoom and are not heading commands.
    expect(commandFor(press("=", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("-", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("1", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("b", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("i", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("`", { ctrlKey: true }))).toBeNull();
    expect(commandFor(press("5", { altKey: true }))).toBeNull();
    // Task status, list indent, inserted paragraphs and rules are menu-only.
    expect(commandFor(press("t", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(press("ArrowUp", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("ignores the repeats of a held key", () => {
    expect(commandFor(press("n", { ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull();
    expect(commandFor(press("w", { ctrlKey: true, repeat: true }))).toBeNull();
    expect(commandFor(press("F5", { repeat: true }))).toBeNull();
  });

  it("keeps an input method's keys to the input method", () => {
    expect(commandFor(press("o", { ctrlKey: true, isComposing: true }))).toBeNull();
    expect(commandFor(press("Escape", { isComposing: true }))).toBeNull();
    expect(commandFor(press("F5", { keyCode: 229 }))).toBeNull();
  });
});
