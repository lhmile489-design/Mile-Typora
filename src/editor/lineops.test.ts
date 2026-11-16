import { describe, expect, it } from "vitest";
import { deleteForward, moveLines, selectLine, selectParagraph } from "./lineops";
import type { Snapshot } from "./paragraph";

function pos(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", offset);
    offset = next === -1 ? text.length : next + 1;
  }
  return Math.min(offset + column, text.length);
}

function snap(text: string, line = 0, column = 0, endLine = line, endColumn = column): Snapshot {
  return { text, anchor: pos(text, line, column), head: pos(text, endLine, endColumn) };
}

describe("selection commands", () => {
  it("selects the current line", () => {
    const source = "一\n二\n三";
    expect(selectLine(snap(source, 1, 1))).toEqual({
      text: source,
      anchor: 2,
      head: 3,
    });
  });

  it("selects the blank-line separated paragraph", () => {
    const source = "一\n二\n\n三";
    const edit = selectParagraph(snap(source, 1, 0));
    expect(edit.anchor).toBe(0);
    expect(edit.head).toBe(3);
    expect(edit.text).toBe(source);
  });
});

describe("moving lines", () => {
  it("moves the current line up and down", () => {
    const source = "一\n二\n三";
    const up = moveLines(snap(source, 1, 1), "up");
    expect(up?.text).toBe("二\n一\n三");
    const down = moveLines(snap(source, 1, 1), "down");
    expect(down?.text).toBe("一\n三\n二");
  });

  it("moves a selected block and keeps a block selection", () => {
    const source = "一\n二\n三\n四";
    const edit = moveLines(snap(source, 1, 0, 2, 1), "up");
    expect(edit?.text).toBe("二\n三\n一\n四");
    expect(edit?.anchor).toBe(0);
    expect(edit?.head).toBe(3);
  });

  it("does not move past the first or last content line", () => {
    expect(moveLines(snap("一\n二", 0, 0), "up")).toBeNull();
    expect(moveLines(snap("一\n二", 1, 0), "down")).toBeNull();
    expect(moveLines(snap("一\n", 0, 0), "down")).toBeNull();
  });
});

describe("forward deletion", () => {
  it("deletes the selection", () => {
    expect(deleteForward(snap("正文", 0, 1, 0, 2))?.text).toBe("正");
  });

  it("deletes the next character or merges the next line", () => {
    const text = deleteForward(snap("正文"))?.text;
    expect(text).toBe("文");
    expect(deleteForward(snap("一\n二", 0, 1))?.text).toBe("一二");
  });

  it("deletes a non-BMP character as one code point", () => {
    const source = "a" + String.fromCodePoint(0x1f600) + "b";
    expect(deleteForward(snap(source, 0, 1))?.text).toBe("ab");
  });

  it("does nothing at the end of the buffer", () => {
    expect(deleteForward(snap("正文", 0, 2))).toBeNull();
  });
});
