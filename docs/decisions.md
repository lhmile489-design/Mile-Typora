# 技术与产品决策记录

> 格式：日期 · 决策 · 理由。改动已有决策时新增一条，不删旧条目。
> 版本号是 2026-11-16 用 `npm view` / `go list -m -versions` 查到的最新稳定版，M1 建项目时写进 `go.mod` / `bun.lock` 锁定；锁定前如有新版本，以 M1 当天为准并更新本表。

## 2026-11-16

### D-T01 · mygo 使用 v0.9.0

- 用户指定 v0.9.0。已对照 v0.8.3 与 v0.9.0 源码：多窗口、Bind、Channel、Event、Dialog、Shell、单实例、Theme、Protocol、菜单、Path、缩放与 DevTools 的 API 没有破坏性变化，只有新增（`ClearWindowStates`、`SetInputRegion`、`OnQuitCanceled`、`QuitEvent.SessionEnding`、`Shell.PreviewItem/DefaultApp`、`mygo dev -background`）。`mygo-runtime` 的 TS API 两版逐字节相同。
- 对本项目要紧的源码事实：
  - 最后一个窗口关闭时应用自动退出（未注册 `OnWindowAllClosed`），符合 PRD FR-02.8。
  - `PageOptions.DevTools = DevToolsDisabled` 同时关闭 WebView2 的浏览器默认按键（F5、Ctrl+R、Ctrl+P、Ctrl+F、缩放键），只能整体开关，不能逐个键配置。
  - `Event` 有 `Emit(win)`、`EmitPage(page)`、`Broadcast`，按窗口定向投递可行。
  - `Protocol.Handle` 可注册自定义协议，处理函数里 `CallerWindow(r.Context())` 能识别请求来自哪个窗口；Windows 上地址为 `http://<scheme>.localhost`。
  - `mygo.WatchFiles` 自带递归监听、去抖、原子替换识别；Windows 默认 `MaxEntries` 8192。
  - 前端 `CallError` 只有 `message` 与 `method`，不能携带结构化错误码。
- 仍未验证：原生多窗口在真实 Windows 11 下的焦点、DPI、资源释放（PRD 13.2 首要风险），M1 第一项。

### D-T02 · Markdown 在 Go 侧解析和清理，公式与图表在前端渲染

- Go：goldmark 解析，自定义渲染器转义原始 HTML、保留公式与 Mermaid 源码，bluemonday 白名单清理后返回 HTML。
- 前端：只负责 KaTeX、Mermaid 和交互，不再解析 Markdown。
- 理由：安全边界放在 Go 一侧，前端拿到的永远是白名单内的标签；公式和图表需要浏览器排版。代价是前端无法独立预览 Markdown，P1 编辑预览要经 Go 往返，M4 时评估延迟。

### D-T03 · Go 依赖

| 用途 | 选型 | 版本 | 理由 |
| --- | --- | --- | --- |
| Markdown 解析 | `github.com/yuin/goldmark` | v1.8.7 | CommonMark 兼容，自带 GFM 扩展，可插自定义渲染器；默认不输出原始 HTML |
| 公式定界 | `github.com/gohugoio/hugo-goldmark-extensions/passthrough` | v0.6.0 | 支持 `$`、`$$`、`\(\)`、`\[\]` 自定义定界，内容不被 Markdown 解析 |
| front matter | `go.abhg.dev/goldmark/frontmatter` | v0.3.0 | 只解析文档开头的 YAML，不执行 |
| 代码高亮 | `github.com/alecthomas/chroma/v2` | v2.27.0 | 纯 Go，输出 class 便于映射到设计令牌；直接调用，不用 goldmark-highlighting（只有 2023 年伪版本） |
| HTML 清理 | `github.com/microcosm-cc/bluemonday` | v1.0.27 | 白名单清理，作为最后一道防线 |
| 文件监听 | mygo 自带 `WatchFiles` | 随 mygo v0.9.0 | 已处理去抖、原子替换、递归；fsnotify v1.10.1 的递归监听未在公开 API 开放 |
| 自然排序 | 自行实现 | — | 规则简单，避免引入依赖 |

注意：goldmark 默认的标题 ID 生成器丢弃非 ASCII 字符，中文标题全部变成 `heading`，必须自定义（见 `markdown-render-pipeline` §3.4）。

### D-T04 · 前端依赖

| 用途 | 选型 | 版本 | 理由 |
| --- | --- | --- | --- |
| 界面 | `react` / `react-dom` | 19.3.1 | PRD C-03 |
| 构建 | `vite` | 8.3.8 | mygo v0.9.0 模板为 `^8` |
| 语言 | `typescript` | 7.0.2 | 模板为 `^7` |
| React 插件 | `@vitejs/plugin-react` | 6.3.0 | 与 Vite 8 配套 |
| 公式 | `katex` | 0.19.1 | 快、可离线、字体随包；`trust: false` 与 `maxExpand` 可控 |
| 图表 | `mermaid` | 12.3.0 | PRD 指定 Mermaid；`securityLevel: "strict"`；按需动态加载以控制首屏体积 |
| SVG 清理 | `dompurify` | 3.4.18 | 清理 Mermaid 输出的 SVG（PRD FR-04 第 5 条） |
| 图标 | `lucide-react` | 1.73.0 | 线性图标，按需引入 |
| 虚拟列表 | `@tanstack/react-virtual` | 3.14.26 | 1 万份文件的文件树 |
| 状态 | React 内置 `useReducer` + Context | — | 每窗口一个 store，状态规模小，不引入额外库 |
| 测试 | `vitest` 5.1.0、`@testing-library/react` 16.3.3、`jsdom` 31.0.1 | — | 与 Vite 配套 |

M1 需验证：mermaid 12 的 `securityLevel: "strict"` 与 `%%{init}%%` 指令处理；mermaid 渲染能否被 3 秒超时真正中断（同步计算部分不能中断，可能要放 Worker 预检）；KaTeX 与 mermaid 产物体积。

### D-T05 · 查找用 CSS Custom Highlight API

- 不修改正文 DOM，切换文件时一次清空；WebView2 基于 Chromium，支持该 API。

### D-T06 · 字体只用 Windows 11 系统字体

- 界面与正文：Segoe UI Variable + 微软雅黑 UI；代码：Cascadia Mono，回退 Consolas。
- 理由：零体积、离线、与原生窗口一致；没有可随包分发的轻量中文正文字体。

### D-T07 · 设计令牌与深色主题

- DESIGN.md 同时定义浅色与深色两套令牌，对比度已按 WCAG 2.1 计算。
- PRD D-07 建议 P0 只上线浅色，主题选择属 P2（VIEW 与 15.7 节）。用户本轮要求设计涵盖深浅两种模式，因此机制（`data-theme`、令牌、窗口底色、Mermaid 重渲染）在 P0 一并实现；**P0 是否在设置里开放深色，待 PRD 评审确认**，确认后同步 PRD D-07 与 FR-10。（已由 D-T10 结论取代）

### D-T08 · 项目内 skills 按 PRD 改写

- 五个项目内 skill 原本来自另一个项目，部分做法与本 PRD 冲突（如就绪握手"只保留最近一次意图"、Bento 卡片风格、托盘与全局快捷键）。已按 PRD 改写，其中 `mygo-desktop-app-dev` 改名为 `markdown-render-pipeline`，`mygo-bento-design-tokens` 改名为 `design-tokens`。
- 原件归档：`E:\Agent-skills\_archives\mile-typora-original-skills-20261116\`。

### D-T09 · 仓库

- 远程：`https://github.com/lhmile489-design/Mile-Typora.git`，默认分支 `main`。

### D-T10 · P0 开放深色主题（用户确认）

- 用户在评审中确认 P0 开放深色。PRD 升到 v0.3：新增已确认项 C-12，D-07 标为被取代，FR-10 增加第 12 条外观设置（跟随系统 / 浅色 / 深色，首次默认跟随系统），新增验收 AC-29。
- P2 的“主题”菜单复用同一设置，并可增加更多内置主题；自定义主题仍在 P3 评估。
- 首次默认“跟随系统”是建议值，不是用户确认项。

### D-T11 · Mermaid 与产物体积留到 M1 实测

- 用户同意先记录、后实测。M1 需要给出以下三项的实测结论，结论写回本文件：
  1. mermaid 12.3.0 在 `securityLevel: "strict"` 下对 `%%{init}%%` 指令的处理；渲染前剥离或拒绝该指令能否可靠生效（AC-25）。
  2. 3 秒超时能否真正中断渲染。若病态图会卡住主线程，改为 Worker 预检或更严的输入上限。
  3. KaTeX 与 mermaid 的打包体积，以及按需加载后的首屏体积。
- 实测前，`markdown-render-pipeline` §4.3 里的做法只是方案，不能写成已验证。

### D-T12 · M1 脚手架参数

- 用户 2026-11-16 授权开始写代码，项目进入 M1。开发顺序见 `docs/开发计划.md`。
- 用 `go run github.com/egoist/mygo/cmd/mygo@v0.9.0 init` 在临时目录生成模板再复制进仓库（`mygo init` 拒绝非空目录），没有升级本机全局的 mygo CLI（仍是 0.8.3）。
- `mygo init` 写入的是最新版：`go.mod` 为 mygo v0.9.1，npm 包为 `^0.9.0`（实际装上 0.9.1）。已钉回锁定版本：`go get github.com/egoist/mygo@v0.9.0`，`mygo-runtime`、`mygo-cli` 改为精确版本 `0.9.0`。v0.9.1 改动了 app.go、clipboard、cmd/mygo 等，未核对，不使用。
- Go 模块路径：`github.com/lhmile489-design/mile-typora`。identifier：`dev.mile.typora`，决定应用数据目录与单实例锁，定稿不改。
- 开发端口 5273（不用模板的 5173，避开本机另一个 mygo 项目 `E:\mygo\my-app`）。
- 前端依赖按 D-T04 的精确版本安装；`@types/react`、`@types/react-dom` 为 19.3.0。Go 侧第三方库（goldmark 等）等到用到的阶段再 `go get`，避免 `go mod tidy` 把未使用的依赖删掉。
- `mygo init` 附带的 `.agents/skills/`（mygo-maintenance、mygo-native-modules）原样保留，属上游文件，不在 CLAUDE.md 的项目 skill 表里。
- `resources/icon.png` 是模板默认图标，M3-8 发版前替换。

### D-T13 · 应用图标

- 设计原图 `docs/images/深色背景上的橙角MT文档图标.png`（1254×1254，深色底、无透明通道）。用户确认它就是应用图标。
- 原图字母是黑色，与深色底接近，按颜色差抠图会在字母里留下透明噪点。改用「从边框洪水填充背景 + 反预乘」的方式取轮廓，脚本为 `scripts/make-icons.py`（需要 Pillow 与 NumPy），产物：
  - `resources/icon.png`（1024 透明）：构建产物图标
  - `resources/icon-dev.png`（带 DEV 徽标）：`mygo dev` 的图标，mygo 会自动优先取它
  - `public/icon.png`（256）：页面 favicon
- 依据 mygo v0.9.0 `cmd/mygo/config.go`：`icon` 默认取 `resources/icon.png`，同名的 `icon-dev.png` 给开发版。没有在 `mygo.config.ts` 里写 `icon` 字段，用默认值。
- 托盘：P0 没有托盘功能（PRD 未列），暂不需要托盘图标；以后加入托盘时复用 `resources/icon.png`。

### D-T14 · M1-1 的验证方式与本机限制

- 本机没有 C 编译器（`gcc` 不存在，`CGO_ENABLED=1` 也编不了 `runtime/cgo`），所以 `go test -race` 跑不了。M1-1 起用并发测试（`internal/winctx` 里有 32 个 goroutine 同时增删查）加人工审查替代；装好 MinGW-w64 后补跑 `go test -race ./internal/...` 并把结果记进本文件。
- 原生多窗口用 PowerShell 调 `EnumWindows` 按进程统计可见顶层窗口来验证，不依赖人工数窗口：
  - 启动第二个实例 → 第一个实例收到参数并新开窗口，进程数仍为 1，窗口数 2
  - `PostMessage WM_CLOSE` 关一个窗口 → 另一个存活，进程仍在
  - 关最后一个窗口 → 进程退出，`mygo dev` 以 0 退出
- 新增 `@types/node@22.20.5`（开发依赖）与 `tsconfig.json` 的 `types` 加 `"node"`，因为 `src/styles/tokens.test.ts` 用 `node:fs` 读取设计稿做令牌比对。

### D-T15 · 打开请求：队列是真相，事件只是提示（M1-2）

- 原计划让 `Ready()` 一次性返回排队的打开请求。原生实测发现会丢：React StrictMode 在开发模式下会挂载、卸载、再挂载，第一次挂载拿到的响应被丢弃，而队列已经被取空，请求就消失了。
- 改为：请求留在 Go 侧有界队列（每窗口 32 条）直到页面 `Ack(seq)`；`Pending(after)` 可重复取；就绪后新请求入队并发一次 `open-request` 事件，仅作提示。页面按 `seq` 去重。握手响应被丢弃、事件丢失、页面重载都不会丢请求（PRD §9.2.3）。
- 队列满返回 `queue_full`，不挤掉未确认的请求；`Ack` 之后容量释放。

### D-T16 · 原生窗口的自动验证手段

- 工具截不到原生窗口，于是用两个小脚本让每个阶段的原生验收都能拿到证据：
  - `scripts/native-windows.ps1`：`EnumWindows` 按进程列出可见顶层窗口，`WM_CLOSE` 关窗（与用户点关闭等价）。用来验多窗口、关一窗、最后一窗退出。
  - `scripts/native-eval.mjs`：通过 WebView2 的调试端口在真实窗口里执行表达式并打印结果，用来读状态栏文字、主题、计算样式。
- 调试端口只在手动启动时开，需要三个环境变量（`MYGO_DEV=1`、`MYGO_DEV_URL=http://localhost:5273`、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`）。`mygo dev` 启动的应用不带调试端口，生产构建更不会。
- 两者只用于开发期验收，不进入构建产物。
