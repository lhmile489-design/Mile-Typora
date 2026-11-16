#!/usr/bin/env node
// Evaluates an expression in the page of a running development window and
// prints the result as JSON. This is how a stage's native verification reads
// text and computed styles out of the real WebView2 window.
//
// The window must run with the inspector open, which the development app is
// told through two variables:
//
//   MYGO_DEV=1 MYGO_DEV_URL=http://localhost:5273 \
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
//   ".mygo/dev/windows-amd64/Mile Typora Dev.exe"
//
// Usage: node scripts/native-eval.mjs "document.querySelector('.statusbar').innerText"
//        node scripts/native-eval.mjs --port=9222 "document.documentElement.dataset.theme"

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? portArg.slice("--port=".length) : "9222";
const indexArg = args.find((a) => a.startsWith("--index="));
const index = indexArg ? Number(indexArg.slice("--index=".length)) : 0;
const expression = args.filter((a) => !a.startsWith("--port=") && !a.startsWith("--index=")).join(" ");

if (!expression) {
  console.error("usage: node scripts/native-eval.mjs [--port=9222] <expression>");
  process.exit(2);
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
const page = pages[index] ?? pages[0];
if (!page) {
  console.error(`no page target on port ${port}; is the window running with the debug port?`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const done = (code, text) => {
  if (text !== undefined) console.log(text);
  ws.close();
  process.exit(code);
};

ws.addEventListener("open", () => {
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  );
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== 1) return;
  if (msg.error) done(1, `devtools error: ${JSON.stringify(msg.error)}`);
  const r = msg.result;
  if (r.exceptionDetails) {
    done(1, `evaluation threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  }
  const v = r.result;
  done(0, JSON.stringify(v.value !== undefined ? v.value : v.description));
});

ws.addEventListener("error", () => done(1, "cannot connect to the debug port"));
