// Measures document opens in the development window over the WebView2
// inspector (docs/develop/性能基线.md). Development builds are unminified;
// the report says so. Development-only (decisions.md D-T16).
const port = process.argv[2] ?? "9222";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("no page target");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});
const send = (method, params) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const message = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (message.result?.exceptionDetails) {
    throw new Error(JSON.stringify(message.result.exceptionDetails).slice(0, 400));
  }
  return message.result?.result?.value;
};

// Wait for the folder tree of the docs sample.
await evaluate(`(async () => {
  for (let i = 0; i < 100; i++) {
    if (document.querySelectorAll('.ti').length > 0 && !document.querySelector('.tree-busy')) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
})()`);

const names = Array.from({ length: 20 }, (_, i) => `note-${String(i + 1).padStart(2, "0")}.md`);
const opened = await evaluate(`(async () => {
  const names = ${JSON.stringify(names)};
  const results = [];
  for (const name of names) {
    const row = [...document.querySelectorAll('.ti')].find((x) => x.textContent.includes(name));
    if (!row) { results.push({ name, ok: false, ms: null }); continue; }
    const expected = "Note " + name.slice(5, 7);
    const started = performance.now();
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const ok = await new Promise((resolve) => {
      const poll = () => {
        const heading = document.querySelector('.markdown h1');
        if (heading && heading.textContent === expected) return resolve(true);
        if (performance.now() - started > 5000) return resolve(false);
        requestAnimationFrame(poll);
      };
      poll();
    });
    results.push({ name, ok, ms: Math.round(performance.now() - started) });
    await new Promise((r) => setTimeout(r, 120));
  }
  return results;
})()`);

const media = await evaluate(`(async () => {
  const results = [];
  const waitFor = (test, timeout) => new Promise((resolve) => {
    const started = performance.now();
    const poll = () => {
      if (test()) return resolve(true);
      if (performance.now() - started > timeout) return resolve(false);
      requestAnimationFrame(poll);
    };
    poll();
  });
  const clickRow = (name) => {
    const scroll = document.querySelector('.tree-scroll');
    if (scroll) scroll.scrollTop = 0;
    const row = [...document.querySelectorAll('.ti')].find((x) => x.textContent.includes(name));
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  };
  for (let round = 1; round <= 5; round++) {
    clickRow('note-01.md');
    await waitFor(() => document.querySelector('.markdown h1')?.textContent === 'Note 01', 5000);
    await new Promise((r) => setTimeout(r, 200));
    const started = performance.now();
    const clicked = clickRow('media.md');
    const ok = clicked && (await waitFor(
      () => document.querySelector('.markdown h1')?.textContent === 'Media'
        && document.querySelectorAll('.diagram').length >= 6
        && document.querySelectorAll('.katex').length >= 120,
      8000,
    ));
    results.push({
      round,
      ok,
      ms: Math.round(performance.now() - started),
      diagrams: document.querySelectorAll('.diagram').length,
      formulas: document.querySelectorAll('.katex').length,
    });
  }
  return results;
})()`);

console.log(JSON.stringify({ opened, media }));
ws.close();
