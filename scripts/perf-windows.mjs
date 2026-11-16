// Measures the ten-window stress and twenty open/close rounds in the
// development app (docs/develop/性能基线.md). Development-only (D-T16).
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "9222";

const listTargets = async () =>
  (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl,
  );

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    return message.result?.result?.value;
  };
  const press = async (key, code, vk, modifiers = 0) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  };
  return { ws, evaluate, press };
}

const list = await listTargets();
if (list.length === 0) {
  console.error("no page target");
  process.exit(1);
}
const main = await connect(list[0]);
const seen = new Set(list.map((t) => t.id));

const memory = () => {
  // The window's share is the app process plus the WebView2 processes whose
  // user data belongs to it; the browser runs them separately.
  const out = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf-memory.ps1`,
    { encoding: "utf8" },
  ).trim();
  return Number(out) || 0;
};
const waitToolbar = async (page) => {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate("!!document.querySelector('.toolbar')")) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
const openRecentNote = (page) =>
  page.evaluate(`(async () => {
    for (let i = 0; i < 60; i++) {
      const row = [...document.querySelectorAll('.recent-row')].find((b) => /note-\\d+\\.md/.test(b.textContent));
      if (row) {
        const started = performance.now();
        row.click();
        const ok = await new Promise((resolve) => {
          const poll = () => {
            const heading = document.querySelector('.markdown h1');
            if (heading && /^Note \\d+$/.test(heading.textContent)) return resolve(true);
            if (performance.now() - started > 5000) return resolve(false);
            requestAnimationFrame(poll);
          };
          poll();
        });
        return { ok, ms: Math.round(performance.now() - started) };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, ms: null };
  })()`);

const before = memory();
const stress = [];
for (let i = 0; i < 9; i++) {
  await main.evaluate(`document.querySelector('[aria-label="新建窗口"]').click()`);
  await new Promise((r) => setTimeout(r, 900));
  const fresh = (await listTargets()).find((t) => !seen.has(t.id));
  if (fresh) {
    seen.add(fresh.id);
    const page = await connect(fresh);
    const ready = await waitToolbar(page);
    const opened = ready ? await openRecentNote(page) : { ok: false, ms: null };
    stress.push({ window: i + 2, ready, ...opened });
  } else {
    stress.push({ window: i + 2, ready: false, ok: false, ms: null });
  }
}
const afterStress = memory();

// Close the nine extra windows, keeping the one that started the run.
const mainId = list[0].id;
const targets = await listTargets();
const extra = targets.filter((t) => t.id !== mainId);
let closed = 0;
for (const target of extra) {
  const page = await connect(target);
  await page.press("w", "KeyW", 87, 2);
  closed += 1;
  await new Promise((r) => setTimeout(r, 500));
}

const rounds = [];
for (let round = 1; round <= 20; round++) {
  await main.evaluate(`document.querySelector('[aria-label="新建窗口"]').click()`);
  await new Promise((r) => setTimeout(r, 800));
  const fresh = (await listTargets()).find((t) => !seen.has(t.id));
  let opened = { ok: false, ms: null };
  if (fresh) {
    seen.add(fresh.id);
    const page = await connect(fresh);
    if (await waitToolbar(page)) opened = await openRecentNote(page);
    await page.press("w", "KeyW", 87, 2);
  }
  await new Promise((r) => setTimeout(r, 500));
  rounds.push({ round, ...opened, workingSet: memory() });
}

console.log(
  JSON.stringify({
    before,
    stress,
    afterStress,
    closed,
    rounds,
  }),
);
main.ws.close();
