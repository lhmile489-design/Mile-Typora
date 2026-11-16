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
    ["f", { ctrlKey: true }, "find"],
    ["F5", {}, "refresh"],
    ["w", { ctrlKey: true }, "close-window"],
    [",", { ctrlKey: true }, "settings"],
    ["l", { ctrlKey: true, shiftKey: true }, "toggle-left"],
    ["s", { ctrlKey: true }, "save-blocked"],
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
