// Mermaid pass over the rendered document (PRD FR-04, docs/decisions.md
// D-T02). Go keeps each diagram's source; this module decides whether it may
// run, renders it in strict mode, and always cleans the SVG before it enters
// the page.
import DOMPurify from "dompurify";

/** Diagram types P0 supports (PRD FR-04). */
const ALLOWED_TYPE = /^(flowchart|graph|sequencediagram|classdiagram|statediagram(-v2)?|erdiagram|gantt)\b/i;

/** The directive a document may not use to reconfigure Mermaid. */
const INIT_DIRECTIVE = /%%\{\s*init/i;

/** Timeout for one diagram (PRD §8.3). */
export const RENDER_TIMEOUT_MS = 3000;

/** diagramType is the first meaningful line, lowercased, or null. */
export function diagramType(source: string): string | null {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;
    return line;
  }
  return null;
}

/** isSupportedType reports whether the source is one of the six kinds. */
export function isSupportedType(source: string): boolean {
  const type = diagramType(source);
  return type !== null && ALLOWED_TYPE.test(type);
}

/** hasInitDirective reports whether the source tries to change the config. */
export function hasInitDirective(source: string): boolean {
  return INIT_DIRECTIVE.test(source);
}

type Mermaid = {
  initialize(options: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let loading: Promise<Mermaid> | null = null;

/** load imports Mermaid on first use, so a document without diagrams pays
 * nothing for it. */
async function load(): Promise<Mermaid> {
  if (!loading) {
    loading = import("mermaid").then((mod) => {
      const mermaid = mod.default as Mermaid;
      mermaid.initialize({
        startOnLoad: false,
        // Strict mode: no click handlers, no HTML labels, no scripts.
        securityLevel: "strict",
        theme: "base",
        htmlLabels: false,
        maxTextSize: 65536,
      });
      return mermaid;
    });
  }
  return loading;
}

/** withTimeout rejects when the promise takes longer than ms. It cannot stop
 * work that is already running; it only lets the page move on. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`渲染超过 ${ms / 1000} 秒`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let counter = 0;

/** renderDiagrams replaces every `.mermaid-src` under root with its diagram,
 * or with a note saying why it stayed source. */
export async function renderDiagrams(root: ParentNode, timeoutMs = RENDER_TIMEOUT_MS): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid-src"));
  if (nodes.length === 0) return;

  let mermaid: Mermaid;
  try {
    mermaid = await load();
  } catch (err) {
    for (const node of nodes) degrade(node, err instanceof Error ? err.message : String(err));
    return;
  }

  for (const node of nodes) {
    const source = node.textContent ?? "";
    if (hasInitDirective(source)) {
      // A document may not reconfigure the renderer (PRD FR-04, AC-25).
      degrade(node, "图表中的配置指令已被忽略");
      continue;
    }
    if (!isSupportedType(source)) {
      degrade(node, "暂不支持此图表类型");
      continue;
    }
    try {
      counter += 1;
      const { svg } = await withTimeout(mermaid.render(`mt-diagram-${counter}`, source), timeoutMs);
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        // Mermaid keeps a label's <img> tag (its event handler is stripped),
        // and an image would load from wherever it points; a diagram needs
        // none (PRD §8.4: no request from document content).
        FORBID_TAGS: ["img", "script", "iframe", "object", "embed", "link", "meta"],
      });
      const holder = document.createElement("div");
      holder.className = "diagram";
      // The source stays with the diagram: a theme change renders it again.
      holder.dataset.source = source;
      holder.innerHTML = clean;
      node.replaceWith(holder);
    } catch (err) {
      degrade(node, err instanceof Error ? err.message : String(err));
    }
  }
}

/** rerenderDiagrams draws every diagram again, as a theme change needs: the
 * SVG keeps its own colours (DESIGN.md §8.4). */
export async function rerenderDiagrams(root: ParentNode, timeoutMs = RENDER_TIMEOUT_MS): Promise<void> {
  const holders = Array.from(root.querySelectorAll<HTMLElement>(".diagram[data-source]"));
  if (holders.length === 0) return;
  for (const holder of holders) {
    const pre = document.createElement("pre");
    pre.className = "mermaid-src";
    pre.dataset.lang = "mermaid";
    pre.textContent = holder.dataset.source ?? "";
    holder.replaceWith(pre);
  }
  await renderDiagrams(root, timeoutMs);
}

/** degrade leaves the source visible with the reason (DESIGN.md §8.6). */
function degrade(node: HTMLElement, reason: string): void {
  node.classList.add("diagram-error");
  node.dataset.reason = reason;
}
