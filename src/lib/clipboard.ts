// Reading-view selection helpers for M5-5. The reader DOM is post-processed
// (KaTeX markup, Mermaid SVG), so a copied fragment is normalized first and
// then sanitized again in Go before it reaches the clipboard.

/** selectedReaderImage returns one local image selected in the reader. */
export function selectedReaderImage(selection: Selection | null): string | null {
  const range = clippedSelection(selection);
  if (!range) return null;
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const images = Array.from(holder.querySelectorAll("img"));
  if (images.length !== 1) return null;
  const image = images[0]!;
  const alt = (image.getAttribute("alt") ?? "").trim();
  const selected = range.toString().trim();
  if (selected !== "" && selected !== alt) return null;
  const src = image.currentSrc || image.getAttribute("src") || "";
  try {
    const url = new URL(src);
    if (url.host.toLowerCase() !== "mtres.localhost") return null;
  } catch {
    return null;
  }
  return src;
}

/** readerSelectionText is the plain-text form of a reading-view selection. */
export function readerSelectionText(selection: Selection | null): string {
  const range = clippedSelection(selection);
  if (!range) return "";
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  prepareFragment(holder);
  return normalizeText(textOf(holder));
}

/** readerSelectionHTML serializes a reading-view selection for Go to clean. */
export function readerSelectionHTML(selection: Selection | null): string | null {
  const range = clippedSelection(selection);
  if (!range) return null;
  const holder = selectionHolder(range, nodeElement(range.commonAncestorContainer));
  prepareFragment(holder);
  const html = holder.innerHTML.trim();
  return html === "" ? null : html;
}

/**
 * clippedSelection intersects the live selection with the Markdown article,
 * so Ctrl+A or a selection that starts outside the article still copies only
 * the document and never the toolbar or status bar.
 */
function clippedSelection(selection: Selection | null): Range | null {
  const range = oneRange(selection);
  if (!range || range.collapsed) return null;
  const article = document.querySelector(".markdown");
  if (!article || !range.intersectsNode(article)) return null;
  const articleRange = document.createRange();
  articleRange.selectNodeContents(article);
  let startNode = range.startContainer;
  let startOffset = range.startOffset;
  if (range.compareBoundaryPoints(Range.START_TO_START, articleRange) < 0) {
    startNode = articleRange.startContainer;
    startOffset = articleRange.startOffset;
  }
  let endNode = range.endContainer;
  let endOffset = range.endOffset;
  if (range.compareBoundaryPoints(Range.END_TO_END, articleRange) > 0) {
    endNode = articleRange.endContainer;
    endOffset = articleRange.endOffset;
  }
  const clipped = document.createRange();
  clipped.setStart(startNode, startOffset);
  clipped.setEnd(endNode, endOffset);
  return clipped.collapsed ? null : clipped;
}

/** selectionHolder keeps a fully selected block's element, not just its text. */
function selectionHolder(range: Range, container: Element | null): HTMLElement {
  const holder = document.createElement("div");
  const block = container?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre") ?? null;
  const selected = range.toString().trim();
  if (block && selected !== "" && selected === (block.textContent ?? "").trim()) {
    holder.appendChild(block.cloneNode(true));
    return holder;
  }
  holder.appendChild(range.cloneContents());
  return holder;
}

function oneRange(selection: Selection | null): Range | null {
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0);
}

function nodeElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** prepareFragment replaces rendered math and diagrams with their source. */
function prepareFragment(root: Element): void {
  for (const math of Array.from(root.querySelectorAll(".katex"))) {
    const tex =
      math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
      math.getAttribute("aria-label") ??
      "";
    math.replaceWith(document.createTextNode(tex));
  }
  for (const diagram of Array.from(root.querySelectorAll(".diagram[data-source]"))) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = diagram.getAttribute("data-source") ?? "";
    pre.appendChild(code);
    diagram.replaceWith(pre);
  }
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL",
]);

function textOf(node: Node, inPre = false): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return inPre ? (node.textContent ?? "") : collapse(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const tag = element.tagName;
  if (["SCRIPT", "STYLE", "HEAD", "TITLE", "META", "LINK", "INPUT"].includes(tag)) return "";
  if (element.classList.contains("footnote-backref")) return "";
  if (tag === "TABLE") return tableText(element);
  if (tag === "IMG") return (element as HTMLImageElement).alt ?? "";
  if (tag === "BR") return "\n";
  if (tag === "PRE") return `\n${element.textContent ?? ""}\n\n`;
  const children = Array.from(element.childNodes).map((child) => textOf(child, inPre)).join("");
  if (BLOCK_TAGS.has(tag)) return `\n${children}\n\n`;
  if (tag === "LI") return `\n${children}\n`;
  if (tag === "TR") return `\n${children}\n`;
  if (tag === "TD" || tag === "TH") return children;
  return children;
}

function tableText(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  const lines: string[] = [];
  for (const row of rows) {
    const cells = Array.from(row.children)
      .filter((cell) => cell.tagName === "TD" || cell.tagName === "TH")
      .map((cell) => collapse(textOf(cell)).trim());
    lines.push(cells.join("\t"));
  }
  return `\n${lines.join("\n")}\n\n`;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function normalizeText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let blank = 0;
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, "");
    if (line.trim() === "") {
      blank++;
      if (blank > 1 || out.length === 0) continue;
      out.push("");
      continue;
    }
    blank = 0;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n").trim();
}
