import { afterEach, describe, expect, it } from "vitest";
import { readerSelectionHTML, readerSelectionText, selectedReaderImage } from "./clipboard";

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function select(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function reader(html: string): HTMLElement {
  const article = document.createElement("article");
  article.className = "markdown";
  article.innerHTML = html;
  document.body.appendChild(article);
  return article;
}

describe("reading-view clipboard helpers", () => {
  it("turns a selected table into tab-separated rows", () => {
    const article = reader(`
      <h2>标题</h2>
      <p>正文 <strong>粗体</strong> 与 <a href="https://example.com">链接</a></p>
      <table><thead><tr><th>名称</th><th>值</th></tr></thead>
      <tbody><tr><td>甲</td><td>1</td></tr></tbody></table>
      <pre><code>fmt.Println("x")</code></pre>
      <p><img alt="示意图" src="http://mtres.localhost/token"></p>
    `);
    select(article);
    const text = readerSelectionText(window.getSelection());
    expect(text).toContain("标题");
    expect(text).toContain("正文 粗体 与 链接");
    expect(text).toContain("名称\t值");
    expect(text).toContain("甲\t1");
    expect(text).toContain('fmt.Println("x")');
    expect(text).toContain("示意图");
    expect(text).not.toContain("名称 | 值");
  });

  it("serializes KaTeX and Mermaid with their source", () => {
    const article = reader(`
      <p><span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">x^2</annotation></math></span><span class="katex-html">x2</span></span></p>
      <div class="diagram" data-source="flowchart LR&#10;A--&gt;B"><svg><text>A</text></svg></div>
    `);
    select(article);
    const html = readerSelectionHTML(window.getSelection());
    expect(html).toContain("x^2");
    expect(html).not.toContain("katex");
    expect(html).not.toContain("<svg");
    expect(html).toContain("flowchart LR");
  });

  it("clips a whole-page selection to the Markdown article", () => {
    const toolbar = document.createElement("div");
    toolbar.textContent = "工具栏按钮";
    document.body.appendChild(toolbar);
    const article = reader("<h2>标题</h2><p>正文</p>");
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const text = readerSelectionText(selection);
    expect(text).toContain("标题");
    expect(text).toContain("正文");
    expect(text).not.toContain("工具栏按钮");
    expect(readerSelectionHTML(selection)).toContain("<h2>标题</h2>");
    // The article is still the only image source considered.
    expect(selectedReaderImage(selection)).toBeNull();
    expect(article.textContent).toContain("标题");
  });

  it("offers only a local image selected in the reader", () => {
    const article = reader(`
      <p><img id="local" alt="本地" src="http://mtres.localhost/abc"></p>
      <p><img id="remote" alt="远程" src="https://example.com/a.png"></p>
    `);
    const local = article.querySelector("#local")!;
    const remote = article.querySelector("#remote")!;
    const range = document.createRange();
    range.selectNode(local);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selectedReaderImage(selection)).toBe("http://mtres.localhost/abc");

    range.selectNode(remote);
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selectedReaderImage(selection)).toBeNull();
  });
});
