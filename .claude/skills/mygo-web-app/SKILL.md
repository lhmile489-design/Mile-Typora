---
name: mygo-web-app
description: Mile Typora 用 egoist/mygo v0.9.0（Go + WebView2 + React）开发的工作法：一个进程多个原生窗口、每窗口独立上下文与就绪握手、打开请求有序不丢、按窗口或页面定向事件、文件对话框、本地图片经自定义协议受控加载、外链交系统浏览器、拦截 WebView 默认快捷键与导航、深浅外观防白闪、单实例转交启动参数、前端 transport 封装、构建与真实窗口验证。只要在写或改本项目的 Go 绑定、窗口、事件、原生行为、前端调用 Go、mygo dev/generate/build，或提到 mygo.Bind、mygo.NewWindow、EmitPage、Protocol.Handle、mygo-runtime、src/mygo.ts，都应加载本 skill。
---

# mygo Web 应用开发（Mile Typora 版）

本 skill 以 `docs/PRD.md` 为准，API 已对照 **mygo v0.9.0** 源码核对（2026-11-16）。原版来自一个单窗口、带托盘和 LLM 流的应用，其中托盘、全局快捷键、拖入文件、"只保留最近一次意图"等做法与本项目需求冲突，已删去或改写；原版备份在 `E:\Agent-skills\project\mygo-web-app\`。

## 0. 动手前先做的三件事

1. **以锁定版本源码为准。** `go list -m -f '{{.Dir}}' github.com/egoist/mygo` 定位源码，读 `docs/app.md`、`docs/windows.md`、`docs/bindings.md`、`docs/frontend.md`、`docs/native.md`。本 skill 里的签名对应 v0.9.0；升级版本后先对比源码再用。
2. **看项目已有约定。** `mygo.config.ts`、`vite.config.ts` 端口、`package.json` 的 `mygo-runtime` / `mygo-cli` 版本由 `mygo init` 生成；`src/mygo.ts` 是 `mygo generate` 的生成物，不手改。
3. **确认任务落在哪一层**，只读需要的参考文档：

| 任务 | 读 |
| --- | --- |
| 新增或修改绑定方法、契约类型、错误、扫描结果分批推送 | `references/bindings-and-channels.md` |
| 窗口创建与关闭、打开请求队列、就绪握手、事件路由、对话框、本地资源协议、外链、快捷键拦截、外观、单实例 | `references/desktop-integration.md` |
| 前端调 Go、窗口状态 reducer、迟到结果过滤、mock 隔离、布局 | `references/frontend-transport.md` |
| `mygo dev` / `generate` / `build` 报错，发版，真实窗口验收 | `references/build-and-verify.md` |

## 1. 心智模型

```text
Go 进程（一个）                               窗口 N 个，每个一张 React 页面
  main: 单实例锁 -> Bind -> WhenReady -> Run
  winctx.Registry  id -> WindowCtx              页面挂载 -> 订阅事件 -> Ready()
     |  当前文件 / 目录根 / 授权范围 / 队列          |
     |                                             |
  绑定方法 --(CallerWindow(ctx) 找到窗口)-------- 调用（Promise）
  Channel[T] ---- 扫描结果分批 ----------------> for await
  Event.EmitPage(page, v) -- 文件变更、打开请求 -> events.x.on
  Protocol "mtres" -- 授权后的本地图片 ---------> <img src="http://mtres.localhost/...">
```

三条通道：

- **调用**：打开、读取渲染、设置读写。返回 error 在前端是 `CallError`。
- **Channel**：一次调用内的连续数据，本项目只有"目录扫描分批结果"。
- **Event**：Go 主动推送，本项目有"文件已变更""目录结构变化""打开请求"。**一律用 `EmitPage` 或 `Emit(win, ...)` 定向发送，不用 `Broadcast`**，否则会把 A 窗口的内容发给 B（PRD 9.2 第 2 条）。

## 2. 线程与生命周期规则（v0.9.0 源码）

- 绑定方法每次调用跑在独立 goroutine。服务结构体按值绑定、不放可变状态；窗口状态放 `winctx.Registry`（包级、加锁）。
- 窗口回调（`OnClose`、`OnClosed`、`OnFocus`、菜单点击）跑在主线程，只做短动作，慢活起 goroutine。
- mygo API 可在任意 goroutine 调用，会转到主线程。需要"判断 + 原生调用"不可分割时用 `mygo.RunOnMain`。
- 绑定方法的 ctx 在页面导航或窗口关闭时取消。窗口专属长任务挂在窗口自己的 ctx 上（见 `go-service-engineering` §3）。
- `mygo.CallerWindow(ctx)` / `mygo.CallerPage(ctx)` 拿调用方窗口与页面：对话框父窗口、定位该窗口的上下文都靠它。**不要让前端传窗口 ID 来定位窗口**，前端可以伪造。
- 最后一个窗口关闭时应用自动退出（未注册 `OnWindowAllClosed` 时），正好满足 PRD FR-02.8，不要注册这个回调。

## 3. 多窗口要点（PRD FR-02）

1. 每个窗口一条 `winctx.WindowCtx`，以 `win.ID()` 为键，`OnClosed` 时删除并取消窗口 ctx、释放监听订阅。
2. 新建窗口统一走一个 `openWindow(intent)` 函数：先登记上下文和待处理意图，再 `mygo.NewWindow`。`StateKey` 只给第一个窗口用，避免多个窗口叠在同一位置。
3. 窗口行为矩阵（空白复用、非空白新开、显式新开永不去重）在 `winctx` 里实现成纯函数并单测，`service` 只调用。
4. 同一文件被多个窗口打开时共享一个监听，按引用计数释放；变更事件对每个订阅窗口分别 `EmitPage`。
5. 创建窗口失败（资源不足）在发起窗口提示，已有窗口不受影响。

## 4. 就绪握手与打开请求队列

页面就绪前 Emit 的事件会丢。本项目的打开请求**不能只保留最近一次**（PRD 9.2 第 3 条：多次打开是多个独立意图），做法：

- 每个窗口一个有界 FIFO 队列（建议上限 32），未就绪时入队；满了返回错误并在发起处提示，不静默丢。
- 页面订阅完事件后调用 `Ready()` 绑定方法，Go 置就绪并按序投递队列。
- `OnWillNavigate` / 页面重载时撤销就绪；投递失败的意图放回队首。
- 文件变更事件不入队：页面未就绪时只记"有变更"标志，就绪后发一次"请重新同步"（PRD 9.2 第 7 条）。

代码见 `references/desktop-integration.md` 第 2 节。

## 5. 安全边界要点（PRD FR-06）

1. 页面不允许离开应用：`page.OnWillNavigate` 里只放行应用自身来源，其余 `PreventDefault`；HTTP(S) 外链改由前端调绑定方法，Go 确认后 `mygo.Shell.OpenExternal`。
2. 本地图片走自定义协议 `mtres`：`mygo.Protocol.Handle` 在建窗前注册，处理函数内用 `mygo.CallerWindow(r.Context())` 找到窗口，再用 `pathguard` 校验授权范围；只返回 PNG、JPEG、GIF、WebP。Windows 上该协议的地址是 `http://mtres.localhost/...`。
3. `PageOptions.DevTools` 在生产构建设 `DevToolsDisabled`：它同时关掉 WebView2 自带的 F5、Ctrl+R、Ctrl+P、Ctrl+F、缩放等按键（源码 `internal/windows/webview.go`）。页面自己的 keydown 仍然能收到，应用快捷键由前端实现。开发构建保留 `DevToolsAuto`。
4. `page.OnContextMenu` 移除"重新加载""检查"等项（或整体 `PreventDefault` 后只保留复制）。
5. 渲染管线不执行文档 HTML（见 `mygo-desktop-app-dev`）。

## 6. 前端约定

- 组件和 reducer 不 import `src/mygo.ts`，只经过 `src/lib/transport.ts`。
- 每个请求带 `requestId`（自增），reducer 只接受当前文档的最新 `requestId` 结果，快速切换时丢弃迟到结果（PRD FR-07.10）。
- 方法返回的 Promise 创建后立即挂 `.then/.catch`。
- `isCallError(e)` 区分 Go 业务错误和传输错误，错误码到文案的映射集中在一处。
- 整窗无滚动条：`100dvh` 减固定区，flex 链路每层 `min-height: 0`，三栏各自滚动。

详见 `references/frontend-transport.md`。

## 7. 构建、发版与验证

- `mygo dev`：起 Vite 并开窗。手动关掉最后一个窗口进程就退出。
- `devUrl` 与 `vite.config.ts` 端口同改，`strictPort: true`。
- 版本号只在 `mygo.config.ts` 改。
- `mygo build` 出安装包（NSIS 首次联网下载）；`-skip-installer` 只出 exe 且清空输出目录。
- **构建通过不等于原生验收通过。** 多窗口、对话框、DPI、焦点、深浅外观、分发包都要在真实 Windows 11 窗口里过，汇报时分开写"自动验证"和"原生验收"。

## 8. 交付前自检

- [ ] 用到的 API 在 v0.9.0 源码里核对过签名
- [ ] 事件全部定向发送，没有 `Broadcast` 业务数据
- [ ] 绑定方法用 `CallerWindow(ctx)` 定位窗口，没有信任前端传来的窗口 ID 或路径
- [ ] 打开请求有序、有界、超限有提示；就绪握手覆盖重载与导航
- [ ] 关窗后窗口 ctx 取消、监听引用计数正确释放
- [ ] 生产构建 `DevToolsDisabled`，导航被限制在应用内
- [ ] 本地资源只经 `mtres` 协议并做授权校验
- [ ] `src/mygo.ts` 由 `mygo generate` 生成；生产构建不引用 `src/mocks/`
- [ ] 汇报分清自动验证与原生验收
