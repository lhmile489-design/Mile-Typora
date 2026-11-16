# 前端 transport 与页面约定（Mile Typora）

## 目录

1. transport 层
2. 窗口状态 reducer 与迟到结果
3. 目录扫描的 Channel 消费
4. 事件订阅与就绪
5. 错误码到文案
6. 快捷键模块
7. mock 与单测
8. 桌面整页布局

## 1. transport 层

组件、hook、reducer 不直接 import `src/mygo.ts`，只依赖 `src/lib/transport.ts` 导出的接口：

```ts
export interface Transport {
  ready(): Promise<void>;
  openFileDialog(): Promise<OpenOutcome>;
  openFolderDialog(): Promise<OpenOutcome>;
  newWindow(): Promise<OpenOutcome>;
  load(rel: string, requestId: number): Promise<LoadResult>;
  scan(onFrame: (f: ScanFrame) => void): { abort: () => void; done: Promise<void> };
  resolveLink(href: string): Promise<LinkTarget>;
  openExternal(url: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<SaveOutcome>;
  on<K extends keyof AppEvents>(name: K, cb: (p: AppEvents[K]) => void): () => void;
}
```

- 真实实现包装生成的客户端；单测和设计期注入假实现。
- 只在这一层处理 `isCallError` 与传输错误，上层拿到的都是 `LoadResult` 这类带 `failure` 的结构。

## 2. 窗口状态 reducer 与迟到结果

一个窗口一个 store（React 19 用 `useReducer` + Context，不引入额外状态库）。状态按 PRD 7.1 建模：

```ts
type WindowState = {
  mode: "blank" | "file" | "workspace";
  tree: TreeState;        // idle | scanning | ready | empty | partial | truncated | unavailable
  doc: DocState;          // none | loading | ready | empty | failed | stale
  requestId: number;      // 当前文档的最新请求号
  find: FindState;
  sidebars: { left: boolean; right: boolean; rightAuto: boolean };
  positions: Record<string, ReadingPos>; // 本窗口内各文件的阅读位置（PRD FR-03.9）
};
```

- 切换文档：`requestId += 1` 后发起 `load`；收到结果时 `if (res.requestId !== state.requestId) return state`。
- 刷新失败且已有内容：`doc` 变 `stale`，保留旧内容，记录失败原因（PRD FR-07.11）。只有首次失败才是 `failed`。
- 状态可以组合：`tree: "partial"` 与 `doc: "ready"` 同时成立。不要用一个全局 error 覆盖整页。
- 切换文件时清空查找词（PRD FR-05.4）。

## 3. 目录扫描的 Channel 消费

```ts
import { Channel, isCallError } from "mygo-runtime";
import { DocService } from "../mygo";

export function scan(onFrame: (f: ScanFrame) => void) {
  const ch = new Channel<ScanFrame>();
  const call = DocService.scan(ch);
  const settled = call.then(() => null, (e) => e); // 立即挂上，避免 unhandled rejection
  const done = (async () => {
    for await (const f of ch) {
      onFrame(f);
      if (f.kind === "done") { ch.close(); break; }
    }
    const err = await settled;
    if (err) throw isCallError(err) ? new TransportError("api", err.message) : new TransportError("network", String(err));
  })();
  return { abort: () => ch.close(), done };
}
```

- 刷新目录时先 `abort()` 上一次扫描，再发起新的。
- 批次合并进树状态时按父节点追加，不整树替换，保证首批 1 秒内可操作。

## 4. 事件订阅与就绪

```ts
useEffect(() => {
  const offs = [
    transport.on("openRequest", (it) => dispatch({ type: "open", it })),
    transport.on("docChanged", (p) => dispatch({ type: "docChanged", p })),
    transport.on("treeChanged", (p) => dispatch({ type: "treeChanged", p })),
    transport.on("resync", () => dispatch({ type: "resync" })),
  ];
  transport.ready(); // 订阅完成后再告诉 Go 可以投递
  return () => offs.forEach((off) => off());
}, []);
```

- 严格模式会挂载两次，Go 侧 `Ready` 可重复调用。
- `docChanged` 只是提示：页面收到后重新 `load` 当前文档，并带上新 `requestId`。

## 5. 错误码到文案

集中在 `src/lib/errors.ts`，一张表，文案与 DESIGN.md §8 的状态对应：

| code | 文案 |
| --- | --- |
| `not_found` | 文件不存在 |
| `permission` | 没有访问权限 |
| `too_large` | 文件过大（实际 {size}，上限 {limit}） |
| `encoding` | 暂不支持此文件编码，请转换为 UTF-8 |
| `out_of_scope` | 目标不在当前授权范围内 |
| `unsupported_type` | 不支持的文件类型 |
| `render_timeout` | 渲染超时，请重试 |
| `queue_full` | 打开请求过多，请稍后重试 |
| 未知码 / `CallError` | 发生未知错误，请重试 |

文案不出现堆栈、完整路径或文件内容。

## 6. 快捷键模块

- 一个 `useShortcuts` 在根组件注册 `keydown`（捕获阶段），表驱动：`{ key, ctrl, shift, alt, command }`。
- P0 表见 PRD FR-09。命中后 `preventDefault()` 再执行命令；`Ctrl+S` 只提示"当前版本仅支持阅读"。
- 输入框（查找条）获得焦点时，只放行 `Esc`、`Enter`、`Shift+Enter`、`Ctrl+F`。
- 不注册全局快捷键；P1 菜单与快捷键调用同一个 `command` 函数（PRD 9.2 第 11 条）。

## 7. mock 与单测

- 设计期假数据放 `src/mocks/`，生产构建不引用（构建后 grep `dist/` 确认）。
- 假数据不能顶替调不通的真实接口：真实接口失败时界面显示错误。
- 单测（Vitest + Testing Library + jsdom）注入假 `Transport`，覆盖：迟到结果被丢弃、刷新失败进入 `stale`、扫描部分失败与截断、切换文件清空查找。
- 本机用 `bunx vitest run`，不用 `bun run test`（会命中系统 `test` 命令）。

## 8. 桌面整页布局

1. 根节点 `height: 100dvh; overflow: hidden`；中间行 `calc(100dvh - var(--toolbar-h) - var(--statusbar-h))`。
2. flex 链路每一层 `min-height: 0`。
3. 左栏、正文、右栏各自 `overflow-y: auto`；代码块、表格、图表、宽公式各自横向滚动。
4. 窗口宽度 < 1200 自动收起右栏，用户手动隐藏后不自动恢复：状态里分开记 `right`（用户意图）和 `rightAuto`（宽度结果）。
5. 所有尺寸、颜色取 `tokens.css` 变量，不写魔法数字（DESIGN.md §10）。
6. 在 960 × 640 和 DPI 100% / 125% / 150% / 200% 下验算面板不溢出。
