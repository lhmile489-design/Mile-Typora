import { afterEach, describe, expect, it } from "vitest";
import { serializeExportBody } from "./export";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("export body serialization", () => {
  it("drops front matter and turns KaTeX into static MathML", () => {
    const article = document.createElement("article");
    article.className = "markdown";
    article.innerHTML = `
      <details class="fm"><summary>元信息</summary><pre>title: x</pre></details>
      <h2 id="标题">标题</h2>
      <p>正文</p>
      <span class="math" data-display="true"><span class="katex">
        <span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span>
        <span class="katex-html">x</span>
      </span></span>
      <script>alert(1)</script>
    `;
    const html = serializeExportBody(article);
    expect(html).not.toContain("details");
    expect(html).not.toContain("katex");
    expect(html).not.toContain("<script");
    expect(html).toContain(`<math display="block">`);
    expect(html).toContain("<h2");
  });

  it("keeps a math error as readable source", () => {
    const article = document.createElement("article");
    article.className = "markdown";
    article.innerHTML = `<span class="math math-error" data-reason="bad">\\bad</span>`;
    const html = serializeExportBody(article);
    expect(html).toContain("math-error");
    expect(html).toContain("\\bad");
  });
});
