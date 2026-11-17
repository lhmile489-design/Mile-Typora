import { describe, expect, it } from "vitest";
import {
  insertAlert,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertLinkReference,
  insertTable,
  insertTOC,
  tableAddColumn,
  tableAddRow,
  tableAlign,
  tableAt,
  tableDelete,
  tableDeleteColumn,
  tableDeleteRow,
  toggleUnderline,
} from "./extended";

const snap = (text: string, at = 0) => ({ text, anchor: at, head: at });

describe("extended Markdown commands", () => {
  it("inserts a GFM table and edits its rows and columns", () => {
    const created = insertTable(snap("正文", 2), 2, 2);
    expect(created.text).toContain("| 列 1 | 列 2 |");
    expect(created.text).toContain("| --- | --- |");
    const info = tableAt(created);
    expect(info?.columns).toBe(2);
    const dataAt = created.text.indexOf("|   |") + 1;
    const atData = { ...created, anchor: dataAt, head: dataAt };
    const added = tableAddRow(atData, "below");
    expect(added?.text.split("\n").filter((line) => line.startsWith("|")).length).toBe(4);
    const column = tableAddColumn(created, "right");
    expect(column?.text).toContain("| 列 1 | 列 2 |");
    const aligned = tableAlign(created, "center");
    expect(aligned?.text).toContain("| --- | :---: |");
    expect(tableDeleteRow(atData)).not.toBeNull();
    expect(tableDeleteColumn(created)).not.toBeNull();
    expect(tableDelete(created)?.text.trim()).toBe("正文");
  });

  it("keeps escaped pipes in table cells", () => {
    const table = "| a | b |\n| --- | --- |\n| x \\| y | z |\n";
    const at = table.indexOf("x");
    const added = tableAddColumn(snap(table, at), "right");
    expect(added?.text).toContain("x \\| y");
    expect(added?.text).toContain("| z |");
  });

  it("inserts footnotes with a definition", () => {
    const edit = insertFootnote(snap("正文", 2));
    expect(edit.text).toContain("正文[^1]");
    expect(edit.text).toContain("[^1]: ");
    expect(edit.anchor).toBe(edit.text.length);
  });

  it("wraps the current block in an alert", () => {
    const edit = insertAlert(snap("第一行\n第二行", 1), "WARNING");
    expect(edit.text).toBe("> [!WARNING]\n> 第一行\n> 第二行");
  });

  it("inserts a link reference and its definition", () => {
    const edit = insertLinkReference({ text: "文字", anchor: 0, head: 2 });
    expect(edit.text).toContain("[文字][ref-1]");
    expect(edit.text).toContain("[ref-1]: https://");
  });

  it("inserts TOC and front matter", () => {
    expect(insertTOC(snap("正文", 1)).text).toContain("[TOC]");
    const fm = insertFrontMatter(snap("正文"));
    expect(fm.text.startsWith("---\ntitle: ")).toBe(true);
    expect(fm.anchor).toBe("---\ntitle: ".length);
  });

  it("toggles underline and comments", () => {
    const selected = { text: "文字", anchor: 0, head: 2 };
    const underline = toggleUnderline(selected);
    expect(underline.text).toBe("<u>文字</u>");
    expect(toggleUnderline(underline).text).toBe("文字");
    const comment = insertComment(selected);
    expect(comment.text).toBe("<!-- 文字 -->");
  });
});
