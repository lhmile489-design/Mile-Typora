import { describe, expect, it } from "vitest";
import {
  imageAt,
  insertAlert,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertImageLink,
  insertLinkReference,
  insertTable,
  insertTOC,
  linkAt,
  removeLink,
  replaceImageAt,
  setLinkAddress,
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

  it("finds and edits an inline link under the cursor", () => {
    const text = "前 [文字](https://a.example) 后";
    const at = text.indexOf("文字");
    const link = linkAt(snap(text, at));
    expect(link?.url).toBe("https://a.example");
    expect(link?.text).toBe("文字");

    const changed = setLinkAddress(snap(text, at), "https://b.example");
    expect(changed?.text).toBe("前 [文字](https://b.example) 后");

    const removed = removeLink(snap(text, at));
    expect(removed?.text).toBe("前 文字 后");
  });

  it("finds adjacent links and keeps a title when changing the address", () => {
    const text = '[一](https://a.example)[二](https://b.example "标题")';
    const at = text.indexOf("二");
    expect(linkAt(snap(text, at))?.url).toBe("https://b.example");
    const changed = setLinkAddress(snap(text, at), "https://c.example");
    expect(changed?.text).toBe('[一](https://a.example)[二](https://c.example "标题")');
  });

  it("reads and rewrites the definition of a reference link", () => {
    const text = "[文字][ref-1]\n\n[ref-1]: https://a.example";
    const at = text.indexOf("文字");
    expect(linkAt(snap(text, at))?.url).toBe("https://a.example");

    const changed = setLinkAddress(snap(text, at), "https://b.example");
    expect(changed?.text).toBe("[文字][ref-1]\n\n[ref-1]: https://b.example");

    const removed = removeLink(snap(text, at));
    expect(removed?.text).toBe("文字\n\n[ref-1]: https://a.example");
  });

  it("ignores images when looking for links", () => {
    const text = "![图](assets/a.png)";
    expect(linkAt(snap(text, 3))).toBeNull();
    const image = imageAt(snap(text, 3));
    expect(image?.url).toBe("assets/a.png");
    expect(replaceImageAt(snap(text, 3), "assets/b.png")?.text).toBe("![图](assets/b.png)");
  });

  it("inserts an image, using the selection as its label", () => {
    const plain = insertImageLink(snap("正文", 2), "assets/a.png", "a.png");
    expect(plain.text).toBe("正文![a.png](assets/a.png)");

    const selected = insertImageLink({ text: "文字", anchor: 0, head: 2 }, "assets/a.png", "a.png");
    expect(selected.text).toBe("![文字](assets/a.png)");
    expect(selected.anchor).toBe(2);
  });
});
