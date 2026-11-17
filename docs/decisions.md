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
- P2 的“主题”菜单复用同一设置；M5-0 已冻结为仅浅色/深色/跟随系统，不新增内置主题（见 D-T47）；自定义主题仍在 P3 评估。
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

### D-T17 · 原生对话框不能可靠地脚本化

- 试过三种方式让脚本在系统文件对话框里选文件：`SendKeys` 打字、`SetWindowText` 写文件名输入框、`PostMessage IDOK`。Windows 11 的通用文件对话框是 DirectUI（`DirectUIHWND`），没有经典 `Edit` 控件，`SendKeys` 又依赖前台焦点，Windows 会拒绝跨进程抢焦点，结果时好时坏。
- 结论：**打开文件的对话框交互由用户点一次**，脚本只负责准备环境（`scripts/native-windows.ps1` 计数/关窗）和读取结果（`scripts/native-eval.mjs`）。曾写的 `native-open-file.ps1` 已删除，避免留下不可靠的工具。
- 走通的自动化原生验收仍是：多窗口计数、关窗、最后一窗退出、页面文本与样式读取、第二个实例传参。

### D-T18 · 渲染管线：先转义再白名单

- 原始 HTML 用自定义 `rawHTMLRenderer` 转义成文本（`pre.raw-html` / `code.raw-html`），而不是 goldmark 默认的 `<!-- raw HTML omitted -->`：PRD FR-04 要求"以转义后的文本展示"，丢弃会让人以为文档缺了内容。
- 无论渲染器产出什么，最后都过一遍只为本项目设计的 bluemonday 白名单（不设 `style`、`on*`、`iframe`、`object`、`embed`、`svg`；URL 只放行 `http`、`https`、`mtres` 与相对地址）。
- 渲染放在 goroutine 里，`select` 等 8 秒；goldmark 不接受 ctx，超时只是放弃结果，不会真正中断计算（与 Mermaid 的 `Promise.race` 同性质）。病态输入是否需要预检，留到 M1-5 与 Mermaid 一起实测。
- 安全断言不用子串匹配：转义后的文本本身就会出现 `<script>`、`onerror=` 这些字样。测试用 `x/net/html` 的 token 流遍历输出，断言没有危险元素、事件属性、`style` 和危险协议；token 流没有 512 层嵌套限制，模糊测试发现的深层嵌套输入不会让断言本身崩掉。
- 模糊测试 60 秒、约 240 万次执行，无 panic、无危险输出。时间上限与深层嵌套的界面观感仍待 M3-7 性能阶段评估。

### D-T19 · 公式与图表：D-T11 三项实测结论

在真实 Chromium（WebView2 同源）里用临时探针页测得，mermaid 12.3.0：

1. **`%%{init}%%` 指令**：文档里的 init 改不动安全相关的配置。渲染后 `securityLevel` 仍是 `strict`，init 里的 `themeVariables`（试过 `primaryColor: #ff0000`）不生效；`maxEdges` 这类安全项在报错里也明确说只能通过 `mermaid.initialize` 设置。产品侧仍然在渲染前拒绝带 init 的图表：多一道防线，也避免让用户以为指令生效了。
2. **超时能否真正中断**：不能，和 KaTeX 一样是"放弃等待"。好在 mermaid 自己有上限：600 条边的流程图被 `maxEdges`（500）直接拒绝，用时 466 ms，主线程最大延迟 0 ms。因此 3 秒 `Promise.race` 只是兜底，真正拦住病态输入的是 mermaid 的安全配置和我们的 64 KiB / 20 块上限。M3-7 压测时若发现长时间阻塞，再考虑 Worker 预检。
3. **产物体积**（`bun run build:web`，未压缩）：主包 516 KB；katex 单独 chunk 256 KB，KaTeX 字体 woff2 合计约 292 KB；mermaid 走动态导入，首次渲染图表时另拉 elk 1.5 MB、cytoscape 432 KB 等分块。没有图表的文档不加载 mermaid。dist 总计 6.9 MB，符合离线随包的预期，M3-7 再记录安装包体积。

另外两点实现决定：

- **图表 SVG 里的 `<img>` 一律去掉**：实测 mermaid 在 strict 模式下会保留标签里的 `<img src=x>`（只剥掉 `onerror`），那会让文档指向的地址被请求。DOMPurify 清理时 `FORBID_TAGS: ["img"]`，图表不需要图片。
- **块级公式改用预处理**：goldmark 的块解析器把 `$$…$$` 之间的行吞成了节点子节点，拿不到原文；passthrough v0.6.0 的块级形式也从未产出块节点。现在在解析前把 `$$`/`\[` 块改写成 `mtmath` 围栏（围栏长度按内容里的反引号数量计算），由我们自己的围栏渲染器处理，代码围栏内的 `$$` 不受影响。

### D-T20 · 本地图片只经 mtres 协议，按 token 取

- 渲染时把相对图片路径解析成真实路径（词法先判范围，再 `EvalSymlinks` + 逐级查重解析点），登记到 `internal/resource` 的 token 表，页面只看到 `http://mtres.localhost/<128 位随机 token>`。文档无法凭路径直接取文件：没有 token 就没有访问。
- 协议处理器不认识扩展名，只认文件头（PNG、JPEG、GIF、WebP 的魔数）；伪造成 `.png` 的 SVG 返回 415。大小 20 MiB、像素 2500 万，先 `Stat` 再读头、用 `image.DecodeConfig` 读尺寸而不解像素。
- 不能显示的图片一律换成 `div.limited[data-kind=image][data-reason]`，保留 alt 文本，原因写明（远程、越界、不存在、格式、超限），不静默留空。
- 远程图片在渲染阶段就不产出 `<img>`，页面根本不会发请求；CSP 的 `img-src` 也只放行 `'self'` 与 `http://mtres.localhost`。
- 范围判定把词法检查放在文件系统之前：`../` 越界直接拒绝，不泄露外面文件是否存在。
- 页面侧：`PageOptions.DevTools = DevToolsAuto`（`mygo build` 的产物里自动关闭，连同 WebView2 的 F5/Ctrl+F 等默认键）、`OnWillNavigate` 只放行应用自身来源（开发期另放行 `localhost:5273`）、`OnContextMenu` 置 `Menu = nil` 关掉右键菜单（否则会露出 Reload/Back）。
- CSP 在生产构建注入（`vite-plugins/csp.ts`，`apply: "build"`）：`script-src 'self'`、`style-src 'self' 'unsafe-inline'`（KaTeX 与 Mermaid 需要内联样式）、`img-src 'self' http://mtres.localhost`，其余按 PRD 收紧。开发期不注入，Vite 自己要写内联脚本。

### D-T21 · 文件监听与扫描的实测事实（M1-7）

- `mygo.WatchFiles` 在 Windows 上满足 FR-07：普通覆盖保存与"临时文件 + 改名"的原子保存都报一次 `write`，删除报 `remove`，去抖 80 ms 后只报一次。验证用一个临时命令 `cmd/watchprobe` 在真实窗口进程里跑，输出记在 `docs/develop/M1-技术验证报告.md` §8，命令已删除。
- `WatchFiles` 必须由运行中的应用提供事件循环（`needsApp`），不能在纯 `go test` 里跑；`internal/watch` 只把 `FileOp` 映射成页面需要的事件，映射函数单测。
- 监听按文件所在目录登记（mygo 的做法），所以编辑器替换文件也能看到；每个窗口只监听当前文档，换文档时先停旧监听（`winctx.Window` 上带 `SetStopWatch`）。
- 扫描的联接判定：Go 1.23 起 `EvalSymlinks` 不解析目录联接，`Lstat` 报 `ModeIrregular`；扫描与 `pathguard.CheckComponents` 都用这条判断，实测 `mklink /J` 被正确跳过。
- 打包：`bun run build` 产物 `Mile Typora.exe` 18.4 MB、安装包 6.2 MB；停掉 Vite 后独立运行正常，说明前端已嵌入。

### D-T22 · 文件树的分批推送与测试环境

- 目录扫描一次算完，再按 500 条一帧经 `Channel` 推给页面：只有一份条目内存、顺序天然正确，页面边收边画。若 M3-7 测出 1 万条目首批超过 1 秒，再把扫描本身改成边扫边发。
- 页面关闭 Channel（离开或换文件夹）时 Go 的 `Send` 返回错误，扫描就此结束，不残留后台遍历。
- jsdom 不做布局，`@tanstack/react-virtual` 拿不到滚动容器高度就一行不渲染。`src/test/setup.ts` 给了 `ResizeObserver` 桩和固定的 `clientHeight` / `getBoundingClientRect`，让组件测试能看到行；node 环境的测试（令牌比对）在 setup 里直接返回。
- 文件树的选中与键盘焦点分开表达（DESIGN §8.2）：选中是 `--bg-selected` + `--accent`，焦点是 2px 内描边；方向键移动焦点，Enter 选中。

### D-T23 · 右侧预留栏默认收起

- 用户 2026-11-16 要求默认不打开右侧栏。PRD D-06 由"默认显示"改为"默认收起、可随时展开"，设计和实现同步。
- 理由：P0 的右侧栏按 PRD 只放一行标题，默认展开等于白占 260px 阅读空间；接入 Agents 是未来阶段的事。
- 实现：`App` 的 `showRight` 初值 `false`；工具栏开关与 `aria-pressed` 仍然表达真实状态。窗口宽度规则（窄窗口收起）留给 M3-5。

### D-T24 · 打开请求由页面触发，Go 负责确认

- 请求（文件关联、命令行、第二个实例）到达窗口后，页面调用 `OpenRequested(seq)`，Go 完成读取与渲染，处理完即 `Ack`。
- 同一个 seq 再问时（React StrictMode 在开发模式下会重挂载一次，页面刷新也会），Go 返回窗口当前文档（`winctx.Window.OpenFile`）重新读取渲染，而不是回 `request_expired`：否则第一次挂载的渲染被丢弃后，开发模式下每次带参数启动都会空白。
- 页面不再自己 `Ack`：确认发生在真正尝试打开之后，避免"先确认后丢结果"。
- 生产构建不跑 StrictMode 的双挂载，但这条路径让开发与生产行为一致。

### D-T25 · 窗口行为矩阵与文件树的"在新窗口打开"

- 矩阵（PRD FR-02、D-03）：空白窗口就地打开；**非空白**窗口通过对话框打开文件或文件夹时，新开一个窗口，把路径作为请求交给它（复用 M1-2 的队列与 M2-0 的 `OpenRequested`），原窗口内容不动。
- 文件关联/命令行发来的请求始终在当前有焦点的窗口打开，这是"打开这个文件"的明确意图，不另开窗口（PRD FR-02.8）。
- 文件树点击 → 当前窗口打开（FR-02.6，目录上下文保留在窗口上）；行内"在新窗口打开"→ 新窗口，原窗口目录不变（AC-06）。
- 树内相对路径走 `pathguard.Within`，越界返回 `out_of_scope`。请求的 `Kind` 区分文件与文件夹：文件夹请求由 Go 设好窗口根，页面接着 `Scan`。
- **设计补充**：文件行悬停出现"在新窗口打开"按钮，设计稿画板里没有这个元素。这是 PRD FR-02.4 在 P0 唯一可行的入口（P1 才有菜单），按 G6 记在这里，用户不认可可以改成右键菜单或去掉。

### D-T26 · 代码高亮、锚点与 front matter

- 高亮用 chroma v2.27.0 的 HTML formatter（`WithClasses(true)`），输出 `div.code[data-lang]` 包住 `pre.chroma`；颜色全部由 `markdown.css` 把 Pygments 短类名映射到 `--syn-*` 令牌，不用 chroma 自带样式表（否则深浅模式各要一套内联颜色）。
- 白名单要放行 chroma 的短类名：`span[class]` 与 `pre[class]` 额外允许 `^[a-z][a-z0-9]{0,7}$`。这些类名只决定颜色，没有行为，仍不允许 `style`。
- 标题锚点自己生成：goldmark 默认生成器丢掉非 ASCII，中文标题全变 `heading`。规则保留任意文字的字母与数字、ASCII 转小写、空白与连字符合并成 `-`；重复标题追加 `-1`、`-2`；IDs 每篇文档一份（通过 `parser.WithContext` 传），同一标题在不同文件里互不影响。
- front matter 不引入 YAML 解析：只把首个 `---` 到下一个 `---`/`...` 的内容作为文本放进 `details.fm`，统计顶层键数显示"元信息 · N 项"。未闭合的 `---` 按正文处理（可能只是分隔线）。
- 任务列表复选框由 Go 输出 `disabled`，页面再补 `aria-readonly`；CSS 关掉 `pointer-events`，只读在视觉与行为上都成立。

### D-T27 · 链接的分类与"不替文档做决定"

- 页面不做任何导航：文档里所有 `<a>` 的点击都 `preventDefault`，交给 `OpenLink` 判断。渲染时 `javascript:`、`data:`、`file:` 等链接的 `href` 已被白名单去掉，点击也不会有行为。
- 外链：先弹原生确认（"即将访问外部站点"，按钮"取消 / 打开"，默认按钮是取消），确认后才 `Shell.OpenExternal`。远程资源不在渲染期请求，符合 PRD §8.4。
- 文档链接：在窗口根目录内直接返回相对路径，由页面按文件树方式打开；**根目录外或 `../` 越界的一律拒绝**（`blocked`），不做"是否打开"确认。比 PRD FR-06.3 的"确认后打开"更严：不让文档用相对路径探到工作区外，需要读别的目录时走"打开目录/打开文件"对话框，授权口径更清楚。PRD 评审时可以改成确认后打开。
- 附件（非 `.md` 相对路径）只提示"暂不支持打开此类附件"，不尝试交给系统（P0 不做附件打开）。
- 单文件模式没有目录根：以当前文件所在目录作为范围，与目录模式一致。

### D-T28 · 查找与阅读位置

- 查找用 CSS Custom Highlight API：`::highlight(find)` 与 `::highlight(find-current)`，命中不写进 DOM，切换文件时 `CSS.highlights.clear()`。WebView2 支持该 API，已原生验证两个高亮组都存在。
- 匹配是字面量、大小写不敏感（`toLocaleLowerCase` 后比较；若长度变化则跳过该文本节点，避免偏移错位）。公式、图表、`.katex`、`svg`、脚本与隐藏源码不参与——它们不是读者看到的文字（PRD FR-05.7 的提示据此写）。
- 查找条按 DESIGN §8.5：浮在正文区右上（top 12 / right 16）、360×40、`--bg-raised` + `--shadow-1`；无结果显示"未找到匹配内容"（`--danger`）；Enter 下一个、Shift+Enter 上一个、Esc 关闭并清空。
- 阅读位置：记"视口上方最近的标题 id + 相对该标题的偏移 + 整体滚动比例"。恢复优先按标题；标题不存在（文档改了）才用比例；结果夹在可滚动范围内（PRD FR-07.3）。位置只存在窗口内存里，跨重启的近似位置留给 M3-2。

### D-T29 · 只读证明与恶意样本回归（M2-6）

- 只读证明放在 `internal/service/readonly_test.go`：在临时工作区里走 扫描 → 打开带图片/公式/图表/链接的文档 → 按 token 取图并与磁盘字节比较 → 换到另一个文件再换回，前后对每个文件做 sha256 并比对文件清单。放在 service 包内是因为整条管线（pathguard、docread、markdown、resource）都由它串起来，测试要用包内注入点；对外行为与放在 `internal/e2e` 等价，卡片的目录名不作为硬性要求。
- 恶意样本固定为五份：`html.md`（脚本、事件属性、iframe、内联样式）、`protocol.md`（javascript/data/file/vbscript/自定义协议、data 图片）、`svg.md` + `icon.svg`（内联 SVG 与 SVG 图片）、`mermaid-init.md`（init 指令与 click 回调）、`math-escape.md`（`\href`、`\includegraphics`、宏递归）。测试逐份渲染并断言：无危险元素、无事件属性、无 `style`、无危险协议、图片一律被解析器拦下。
- 样本目录每次改渲染或白名单都要重跑，已写进测试名与计划，不依赖人工点一遍。
- 原生抽查（2026-11-16）：`protocol.md` 渲染后 `a[href]` 只剩明文 https，`script` 与 `img` 元素为 0，点击 https 链接弹出"即将访问外部站点"确认框，取消后页面不动。

### D-T30 · 应用状态：一个文件、原子写、损坏留档（M3-1）

- 位置：`mygo.App.Path(PathUserData)`，Windows 上是 `%APPDATA%\<应用名>\settings.json`（开发版是 `Mile Typora Dev`）。永远不写用户文档目录。
- 写入：同目录临时文件 → `Sync` → `os.Rename` 覆盖；任何一步失败都保留旧值与旧文件，界面得到 `settings_write_failed`，阅读不中断。
- 损坏：读取时 JSON 解析失败就把原文件改名为 `settings.corrupt-<时间戳>.json` 保留，按默认值继续；下次成功保存才写出新的 `settings.json`，损坏文件不删。
- 最近列表：最多 20 条、新的在前、按路径去重（Windows 大小写不敏感）、只接受绝对路径；打开文件或目录成功后由 Go 记录，页面不能改这个列表。
- `OpenRecent` 只接受列表里已有的路径，避免页面借"最近记录"读任意文件。
- 设置枚举在读写两侧都规范化（未知值回落到 `blank` / `system`），所以旧版本写的文件不会让新版本进入奇怪状态。

### D-T31 · 启动恢复：目标怎么记、请求怎么排、设置怎么开（M3-2）

- 恢复目标 = 窗口内容：目录模式记 `{根目录, isDir:true, selected:"相对路径"}`，单文件模式记 `{文件, isDir:false}`。每次成功展示文档、设置目录根、以及窗口获得焦点（`Window.OnFocus`）时更新；只覆盖有效内容，空白窗口不覆盖。
- 启动：`startup == resume` 且目标存在时，先给第一个窗口入队目录请求（设根并扫描），再入队文档请求；文档在根内，页面保留文件树并选中它（`OpenRequestResult.rel` 由 Go 计算，页面不做路径拼接）。目标不存在时不开任何请求，通过 `ReadyInfo.startupNotice` 在状态栏说明原因；设置了恢复但没有历史目标时安静打开空白页（PRD FR-10.6）。
- 显式命令行（文件关联）优先于恢复（PRD FR-10.8），恢复目标因此从不与启动参数打架。
- 启动说明对整个进程有效，每次 `Ready` 都返回：React StrictMode 的首次挂载会被丢弃，说明不能只发一次。
- 页面按序打开请求（promise 链）：目录请求先于其中的文档请求，否则文件先到、目录后到会把树清掉。`applyOutcome` 通过 `folderRef` 读当前目录，避免排队的回调拿到旧闭包。
- 设置文件容忍 UTF-8 BOM：别的编辑器（含 PowerShell 5.1 的 `-Encoding utf8`）写出来会带 BOM，把它当"损坏"对用户不友好。BOM 在解析前剥掉，解析失败才按损坏处理。

### D-T32 · 外观：一处保存、全窗口生效、首帧就正确（M3-3）

- 偏好在设置对话框里改，选中即应用（当前窗口立刻变），保存成功后 Go 向**所有**窗口逐个 `Emit` `theme-change`，并 `Theme.SetSource` 让原生控件与窗口底色跟上。失败时对话框不关，当前窗口保持用户所选（他只会在本窗口看到，重开即回旧值），不误报成功。
- 防白闪：显式偏好（浅色/深色）在 `PageOptions.PreloadScript` 里于页面脚本之前写入 `data-theme`；`theme-init.js` 发现已有主题就直接返回，只在"跟随系统"时用媒体查询决定首帧。`data-theme-pinned` 标记显式选择，系统媒体变化时不覆盖。
- Mermaid 的 SVG 自带颜色，切换外观后按 `data-source` 重新渲染（`rerenderDiagrams`）；KaTeX 继承 `currentColor`，无需处理。
- 新建窗口读的是已保存的偏好（preload），所以未保存的选择不会"传染"给新窗口；保存之后才全窗口同步——这是有意的，避免未确认的改动扩散。
- 原生验证：切深色立即生效（背景 #1C1D20，6 个图表仍在）；两个窗口保存后同时变深；重启首帧即深色（`data-theme=pinned`）。

### D-T33 · 外部修改：共享监听、代次丢弃、过期不走红（M3-4）

- 监听放在 `internal/watch.Pool`：路径小写作键，一份底层 `WatchFiles` 扇出给所有订阅窗口，最后一个 `release` 才停止。窗口关闭时 `winctx.Remove` 调 `StopWatch` 释放；引用计数就是池里的订阅数（测试可断言），日志只记事件种类，不记用户文件名。
- 池的 Starter 由 main 注入（`context.Background()`）。池不持有某个窗口的 ctx：否则先关的窗口会把别的窗口的监听一起停掉。
- 打开与刷新共用 `readAndRender`。自动重载在独立 goroutine 里跑，`w.NextRefresh()` 的 seq 加 `IsLatestRefresh` 保证迟到的结果不覆盖新结果；页面还有第二道 `seq` 检查，重挂载或事件乱序时同样安全。
- 自动刷新失败（文件删除、读取或渲染失败）不弹首次加载的整页错误：页面保留最后成功内容，正文顶部显示 `--warn-bg` 整篇提示条和"重试 / 关闭当前文档"（PRD FR-07.5、DESIGN §8.7）。首次就失败仍显示完整错误页。
- 手动刷新只回答调用窗口，不向其他窗口推送；它同样递增 seq，使随后到达的自动结果序号更高，不会被页面误丢。
- 文件夹窗口的 F5 先清理旧扫描再重扫，同时保留当前文档；重扫后选中的文件若已不存在就取消选中，正文留在原地并靠过期条说明（PRD FR-07.6、FR-07.8）。
- 状态栏 `已更新 HH:MM` 只在成功展示后写入；刷新期间显示"刷新中"。关闭文档回到开始页，状态栏回到"未打开文档"，不残留"待打开"。
- 本阶段只监听**当前文档文件**；目录结构变化（新建、删除、改名、根目录消失）的自动重扫与提示留在 M3-6 的异常矩阵一起做（PRD FR-07.1、FR-07.9、FR-03.12），避免在这里引入递归目录监听的容量风险。命令行的目录参数仍按文件处理（P0 没有这个入口要求），已记入踩坑记录。

### D-T34 · 布局与快捷键：一张表、两种宽度状态、焦点可回（M3-5）

- 快捷键集中到 `src/lib/shortcuts.ts`：`commandFor` 把按键映射为命令，`App` 只有一个 `keydown` 监听和一个 `switch`，工具栏按钮用 `aria-keyshortcuts`（规范名 `Control+O`）与 `title`（界面写法 `Ctrl+O`）暴露同一份 `SHORTCUT_HINT`。输入法组合期间（`isComposing` 或 `keyCode 229`）与长按产生的重复按键一律不触发；`Ctrl+C` 不拦截，交给 WebView 复制选区；`Ctrl+S` 拦截并提示"当前版本仅支持阅读"；`Ctrl+W` 走新绑定 `CloseWindow`，与标题栏关闭同一条路径。`Ctrl+F` 在查找条已打开时把焦点送回输入框；查找条自身的 Enter/Esc 也做了输入法防护。
- 设置对话框打开时全局命令全部让路（Esc 由对话框自己处理）；`FindBar` 与对话框先处理并 `preventDefault`，全局监听遇到 `defaultPrevented` 直接返回，避免一次按键执行两次。
- 右栏是"用户意愿 + 窗口宽度"两个状态：`rightWanted` 记录用户选择，`wideEnough` 由 `innerWidth >= 1200` 计算，同时监听 `resize` 与 `matchMedia("(min-width: 1200px)")` 两种信号（浏览器预览只派发其中一种）；显示条件为两者同时成立。窄窗口下按开关只记录意愿并在状态栏说明"加宽到 1200 像素后显示"；加宽后恢复的只有用户没有主动隐藏过的侧栏（PRD §5.2、D-06）。
- 正文左右留白用容器查询：`.reader` 设 `container-type: inline-size`，中间区小于 720 时 `--content-pad-x` 由 48 降为 24（DESIGN §4.2）。用容器查询而不是媒体查询，是因为中间区宽 = 窗口减两侧栏，取决于侧栏状态。
- 焦点：对话框打开时记录触发元素并在卸载时聚焦回去（DESIGN §8.12）；工具栏、树、按钮沿用全局 `:focus-visible` 2px 焦点环，树节点用内描边。
- 浏览器预览（web-shell）没有 mygo 运行时：`transport` 的事件订阅在缺少运行时时返回空退订，页面仍渲染外壳并显示"连接失败"，用于布局走查。
- 排查中发现 M3-4 引入的死锁：`watch.Pool` 在持有池锁时调用 `stop()`，而 `stop()` 等监听 goroutine 返回，该 goroutine 的扇出又要拿同一把锁；关闭最后一个窗口时正好撞上文件事件，主线程就卡死、进程不退出。修复为**解锁后再 stop**，并加了"stop 里再取锁"的回归测试。详见踩坑记录。

### D-T35 · 异常矩阵：目录监听、失败留现场、容量数字要说清（M3-6）

- 目录结构变化用 `internal/watch.StartTree`：`mygo.WatchFiles` 递归监听根目录，只把新建、删除、改名当作结构变化上报（普通写入由文件监听负责）。`TreeWatcher` 池按根路径共享一份监听，最后一个窗口释放才停止；`TreeMaxEntries` 为 32768，超出时启动失败只记日志，页面仍可用 F5 手动刷新（PRD §8.3 的容量取舍）。
- 页面收到 `tree-changed` 后防抖 250ms 重扫，保留当前文档、阅读位置与能匹配上的选中项；重扫失败时保留上一次的树行并提示"显示上次结果"，而不是把可用树清空（PRD §7.1 组合状态）。
- 根目录消失或改名：目录监听以 `Gone` 结束，Go 同时触发一次文档重读；页面得到 `not_found` 过期条，树保留上下文并提示不可用，另一个窗口不受影响（PRD FR-07.9、AC-12）。文件监听自己以 `Gone` 结束（父目录先消失）也走同一条重读路径。
- 打开目录的所有入口（对话框、命令行/请求、最近记录）统一走 `finishFolder`，不再出现"对话框打开的目录没有监听、也不进最近记录"的分叉；命令行参数按 `os.Stat` 区分文件与目录，目录直接进入目录工作区（原踩坑记录已关闭）。
- 失败时的界面原则：已有文档或目录时，打开失败只进状态栏提示，不遮盖正在阅读的内容（PRD FR-07.7 只把整页错误留给首载）；错误页按失败来源决定"重新选择"打开文件还是文件夹对话框。
- 容量与局部失败：`too_large` 的提示统一带实际大小与上限（`failureText`，首载与刷新共用）；扫描结果分开统计 `unreadable`（权限/读取失败，树仍可用）与 `skipped`（链接、联接、过深目录），树顶分别提示；空目录显示独立空状态；失效最近记录只在目标确实不存在/无权限/越界时自动移除，超限与编码错误保留记录。
- 图片在渲染登记前由 `resource.Check` 校验文件头、20 MiB 与 2500 万像素，损坏或超限直接变成带原因的局部占位；`<img>` 输出 `loading="lazy"`，页面还监听捕获阶段的 `error`，把加载失败的图片替换为 `.limited[data-kind=image]` 占位。单窗口 256 MiB 解码预算尚未实现，已记入 M3-7 的资源基线。
- 请求队列满、隐式设置写入失败这类"不阻断阅读"的问题通过 `app-notice` 事件或下一次 `GetSettings` 的失败字段到达状态栏，不再只写日志（PRD §9.2.4、FR-08.8）。
- 偏差记录：开发期 `mygo dev` 的健康检查曾因 Vite 绑定 IPv6/代理变量持续失败，已在踩坑记录中写明 127.0.0.1 绑定与 `HTTPS_PROXY` 的处置；这属于工具链问题，不影响生产包。

### D-T36 · 性能基线怎么量：分开构建、opt-in 日志、内存算全套（M3-7）

- 冷启动用正式包（22.4 MB exe，安装包 7.0 MB），因为正式包关闭 DevTools，无法用 CDP 读取 DOM；打开、窗口与内存用开发包（Vite、未压缩 React），报告里明确标注构建，避免把开发包数字当正式包数字。
- 应用新增 `MILE_PERF` 环境变量：设置后 `log` 同时写入该文件，输出 `perf: ready/open/scan first/scan done`，只含毫秒与数量，不含路径或正文；不设置时行为不变（正式用户不会得到额外文件）。
- 样本由 `scripts/make-perf-samples.py` 生成到 `%TEMP%`（默认），不进入仓库，也避开 Vite 的项目监听；`make-samples.py`（异常矩阵样本）另有 `--out` 可输出到项目外。
- 内存按"应用进程 + 该应用 user-data 的 WebView2 子进程 WorkingSet 之和"统计，否则只看主进程会严重低估多窗口成本。结果：10 窗总量约 2.6 GB，回到 1 窗约 0.6–0.7 GB；20 轮开关窗无上升趋势。
- Go 基准只覆盖 scan 与 render，规模写进基准（1,000 文件 / 96.7 KB 文档）；不用基准数字冒充用户可见打开耗时，页面渲染单独用 CDP 计。
- 未测项不写"达标"：目录切换 20 次、1 万条目录、1 MiB 公式/图表、系统 DPI、真实权限、256 MiB 图片预算都在报告的 §9–§10 列明。报告 `docs/develop/性能基线.md` 是评审依据，不是营销材料。

### D-T37 · 发布与总验收：先证明，再放行（M3-8）

- WebView2 是硬依赖。启动时先查 EdgeUpdate 的三处客户端键（HKLM 32 位视图、HKLM 64 位视图、HKCU），缺运行库就用 `user32!MessageBoxW` 显示安装说明并退出，不创建可能白屏的窗口（PRD §8.1）。提示里的下载地址用 Microsoft 的 WebView2 页面，不用直链安装器，避免版本与语言假设。
- 分发包由 `bun run build` 生成正式 exe 与 NSIS 安装包；便携 exe 已在没有 Vite 的环境启动并打开文档，说明不依赖开发服务器。安装包本身没有在本机覆盖安装（会改动用户已装版本），列为门禁 G4 的用户确认项。
- 验收记录 `docs/develop/P0-验收记录.md` 按 AC-01 至 AC-29 逐项写操作、结果、证据，明确区分“通过”“部分通过”“待用户确认”。本阶段不把 6 项需要真实桌面/系统设置/安装环境的条目写成通过，也不提前宣称 G4 放行。
- 另补的原生验收：大写 `.MD`、中文与空格路径、带空格的相对图片（Markdown 用 `<图 片.png>` 形式）均通过；这类路径用 Node 以 Unicode 参数启动，避免终端编码影响结论。
- README 记录运行要求、安装方式、快捷键、数据位置、构建命令与 P0 边界；其中快捷键字符串在部分工具输出里可能被占位符遮蔽，文件本身是 `Ctrl+Shift+N`。
- 门禁补充实测：ACL 拒绝文件的首次错误页与已打开后的刷新过期条、渲染超时单测、CDP 抓取 39 个请求全为本地、安装包静默安装到用户目录并运行、跟随系统时切换 Windows 主题两次；29 项变为 27 项通过，余下 AC-02（对话框矩阵）与 AC-19（150%/200% DPI）等用户操作。

### D-T38 · P1 编辑需求：源码加预览、保留原格式、冲突不覆盖（M4-0，G5 通过）

- 用户 2026-11-16 选择：源码编辑 + `Ctrl+/` 预览切换（不做所见即所得、不做分栏）；已有文件保存时保留原 BOM 与 LF/CRLF，新文件 UTF-8 无 BOM + LF；编辑中遇外部变更保留本地缓冲并提示（重新载入 / 另存为 / 保留），不自动覆盖；查找替换支持单次与全部，各为一步撤销，不支持正则。
- 完整需求与 21 条 P1-AC 在 `docs/P1-编辑需求.md`。保存采用同目录临时文件 + 替换语义并保留 ACL；保存前用内容哈希与基线比较，后保存窗口必须进入冲突流程；保存全部部分失败不清空其他脏状态。
- P1 的只读边界调整为“除显式保存 / 另存为 / 保存全部外不写用户文件”；`Ctrl+S` 改为真实保存，`Ctrl+W` 在脏缓冲时先三选一。
- 用户 2026-11-16 确认冻结该文档与 21 条 P1-AC，门禁 G5 通过；编辑器内核（CodeMirror 6 或原生 textarea + 自管撤销）在 M4-1 前单独定稿并记入 decisions。
- 本次审查工作流确认的缺口（EDIT-04 菜单、焦点作用域、视图菜单不提前含 P2、外部删除衔接、根目录不可用另存为、干净缓冲外部重载、保存全部同文件冲突）已在文档中补齐。

### D-T39 · M4-1 编辑器内核：CodeMirror 6、按需加载、预览 token 隔离

- 用户选择 CodeMirror 6。钉住版本：`@codemirror/state` 6.7.6、`@codemirror/view` 6.43.15、`@codemirror/commands` 6.11.1、`@codemirror/language` 6.13.1、`@codemirror/lang-markdown` 6.5.2；`bun.lock` 同步。理由：撤销分组、选区、行操作成熟，原生 textarea 需要自写这些且难达 P1 验收。
- 编辑器在进入编辑模式时动态导入，阅读首包不增加 CodeMirror；组件卸载销毁 EditorView。`defaultKeymap` 中的 `Mod-/` 被过滤，否则 Ctrl+/ 会被编辑器当作注释切换，无法触发预览；主题颜色全部走 CSS 变量。
- 同一窗口一份缓冲；`Ctrl+/` 在 reading → editing → preview → editing 间切换。M4-1 还没有保存，因此编辑中暂时阻止打开文件/目录、最近记录、树内文件、外部打开请求、刷新与关窗，只给状态栏说明；M4-2 用保存 / 放弃 / 取消替换这些临时拦截。OS 标题栏关闭仍可能丢失缓冲，这是 M4-1 的已知边界，M4-2 修。
- 预览由新的 `RenderSource` 绑定用 P0 的 goldmark + bluemonday 管线渲染内存文本，不读盘不写盘；超过 10 MiB 或非法 UTF-8 直接失败。图片 token 分 `read` 与 `preview` 两种，预览只清理自己的，因此渲染编辑缓冲不会让阅读视图图片失效。
- 原生验证：进入编辑后 CodeMirror 显示原文，插入文本后预览显示新内容，切回源码缓冲仍在；Ctrl+O 被拦截且无对话框；gfm.md 字节未变（git 无差异）。

### D-T40 · M4-2 保存：哈希基线、原子替换、原生关闭交页面确认

- 冲突判断不依赖内存时间戳：`docread` 计算磁盘字节（含 BOM）的 SHA-256，随 `Doc.hash` 到页面；页面在打开、应用外部刷新、保存成功后同步 `SetEditState(dirty, hash, hasBOM, lineEnding)`。保存前比较磁盘哈希与此基线，后保存窗口必然拿到 `conflict`，不会静默覆盖。
- 写入用 `internal/docwrite`：同目录临时文件写入并 Sync，`ReplaceFileW(REPLACEFILE_WRITE_THROUGH)` 替换，保留原文件 ACL、属性与创建时间；目标不存在时 `os.Rename` 创建。保存失败保留原文件与编辑缓冲，返回 `save_failed`。
- 格式：编辑缓冲始终 LF；保存按基线恢复 BOM 与 CRLF（P1 决策）。另存为尚无路径时使用 UTF-8 无 BOM + LF；未写扩展名补 `.md`，非 Markdown 拒绝。另存为成功后窗口切到新路径、重新挂文件监听、记入最近与恢复目标。
- 原生关闭：`Window.OnClose` 读窗口脏标记，脏则 `PreventDefault` 并发出 `close-requested`；页面完成保存 / 放弃后调用 `closeWindow(true)`，Go 标记 `Closing` 放行。Ctrl+W 与切换文件 / 目录走同一三选一；取消则保留原状态。OS 关窗因此不再能绕过未保存保护。
- 新建：`NewDocument` 对空窗口复用、非空窗口新建；目标窗口 `ReadyInfo.startUntitled` 通过握手交给页面，页面创建未命名缓冲并 `clearStartUntitled`。新建不写盘，首次保存走另存为。
- 自己保存产生的写事件会触发监听；`onFileEvent` 读当前文件哈希，与 `SetSavedHash` 相同就忽略，避免保存后误报外部修改。
- **未完成**：保存全部的跨窗口编排与菜单入口没有做。它需要事件广播、各窗口回报与汇总，且没有菜单就无用户入口；按计划随 M4-7 菜单一起实现，M4-2 进度里明确标为部分完成，不写成已交付。

### D-T41 · M4-3 剪贴板：走原生绑定，普通快捷键留给 WebView

- 原生实现"粘贴为纯文本"时，页面调用 `navigator.clipboard.readText()` 会让 WebView2 打开一个 `edge://permission-request-dialog/` 权限页：编辑器失去焦点，页面内没有可点的允许按钮，后续按键全部失效。这不是可自动化的验收路径，也不能要求用户去处理一个内部页面。
- 方案：Go 侧新增 `WindowService.ClipboardReadText` / `ClipboardWriteText`，内部用 mygo `Clipboard`；前端只经 `transport` 调用，`SourceEditor` 通过 `readClipboard` / `writeClipboard` props 注入，组件不直接依赖 transport，测试可替换。
- 只在"复制为 Markdown"（`Ctrl+Shift+C`）与"粘贴为纯文本"（`Ctrl+Shift+V`）使用绑定。普通 `Ctrl+C` / `Ctrl+X` / `Ctrl+V` 保留 WebView 默认处理：键盘是用户手势，系统剪贴板可直接读写，也符合"粘贴按纯文本插入"；这样不改变用户已经熟悉的键位语义。
- 页面用捕获阶段的 window 监听接管这两个组合键，避免 CodeMirror 的默认键位先处理；非编辑模式只提示"请在源码编辑模式复制 Markdown"，不静默吞键。粘贴写入用 `view.dispatch(replaceSelection)`，进入 CodeMirror 历史，一次粘贴一步撤销；撤回到保存基线后页面重新计算 `dirty=false` 并同步 `SetEditState`。
- 原生验证：中文剪贴板往返、`Ctrl+X` + `Ctrl+Z`、`Ctrl+Y`、普通与纯文本粘贴各一次撤销均通过；复制出的内容与源文件逐字节一致。

### D-T42 · M4-4 段落命令：行级块模型、一次撤销、菜单命令先留 API

- 块模型统一为“缩进 + 引用前缀 + 行内块标记 + 正文”。标题与列表转换替换行内块标记（`- x` 按 Ctrl+1 得到 `# x`，`> ### x` 按 Ctrl+Shift+] 得到 `> - x`），保留引用与缩进；段落命令是唯一同时去掉引用、列表/任务与标题标记的命令，列表项转为段落时同时去掉列表缩进，避免 4 空格缩进被当成代码块。
- 作用范围是光标所在行或选区覆盖的行；选区结束在下一行行首时不计入该行。多行范围跳过空行；整个选区只有一行空行时仍写入标记（`# `、`- `、`- [ ] ` 等），空文档按 Ctrl+1 也能直接开始输入。
- Setext 标题（`标题` + `===` / `---`）在标题命令中规范化为 ATX 并删除下划线；支持未加引用的单行 setext，引用内的 setext 暂不自动改写。带闭合 `#` 的 ATX 标题在重写级别时去掉闭合标记。
- 围栏代码块、`$$` 公式块与 4 空格缩进代码行视为字面内容，任何段落命令都不改写其内部；解析块前缀后再判断围栏，因此引用内的围栏也能识别。代码块包裹保留原始正文（代码是字面内容），公式块包裹同样保留原始正文，不主动剥离块标记。
- 每个命令只调用一次 `view.dispatch`，并带 `isolateHistory.of("full")`，保证一次命令一步撤销且不与相邻输入合并；纯函数返回 `null` 时完全不派发，避免空撤销记录与误标脏。粘贴与段落命令都走同一编辑器命令接口，M4-7 的菜单可直接复用。
- 结构化保护：YAML front matter、围栏代码、`$$` 公式块、4 空格或 tab 缩进的代码行、主题分隔线、setext 下划线都不被段落命令改写；4 空格且看起来像列表的行，只有在向上能找到更低缩进的列表项时才按嵌套列表处理，否则按代码保护。行内代码信息串含反引号时不当作围栏开头（CommonMark 规则）。
- setext 标题在标题命令中整体转换为 ATX；插入段落、分割线、公式/代码块时也把标题与下划线当作一个块处理，不把下划线拆成孤立文本。引用内的列表缩进改的是最后一个 `>` 之后的内层缩进，不会把空格加在引号外。
- 换文档、重新载入或放弃修改时，`SourceEditor` 重建 `EditorState`（保留扩展）而不是把整段替换当成可撤销编辑；撤销历史随旧文档一起清空，`Ctrl+Z` 不会把上一份文档或用户已放弃的内容带回来。
- 快捷键按 PRD 15.4：`Ctrl+1..6`、`Ctrl+0`、`Ctrl+=` / `Ctrl+-`、`Ctrl+Shift+Q/M/K/[ / ]/X`；`Ctrl+Shift+=` / `Ctrl+Shift+-` 留给 P2 缩放，不绑定。`Ctrl+Shift+[` / `]` 同时接受 `{` / `}`，覆盖美式键盘加 Shift 后 `e.key` 变化。命令只在编辑模式且焦点位于源码编辑器时执行。
- 任务状态、列表增减缩进、上/下插入段落、分割线是菜单命令：`SourceCommands` 已提供实现，单测覆盖，但不绑定快捷键、不出现在界面，等 M4-7 菜单一起接入。
- 原生验证：`Ctrl+1` 后一次 `Ctrl+Z` 回到基线且“未保存”消失；`Ctrl+2` → `Ctrl+-` → `Ctrl+=` → `Ctrl+0` 依次得到 H2/H3/H2/段落；`Ctrl+=` / `Ctrl+-` 不改变 `devicePixelRatio`（未触发 WebView 缩放）；引用、三种列表、任务列表与再切换均正确；公式块与代码块包裹后撤销回到原文；围栏内按 `Ctrl+1` 无效；焦点在工具栏按钮时 `Ctrl+1` 无效；预览模式按键不改变缓冲。复查后在含 front matter 与 setext 的文档上复验：front matter 行 `Ctrl+1` 无变化；setext 标题 `Ctrl+1` 得到 `# 标题` 并删除下划线，一次撤销恢复；setext 标题上 `Ctrl+Shift+Q` 无变化；`Ctrl+Shift+K` 把标题与下划线整体包进代码块，一次撤销恢复；正文标题命令正常。

### D-T43 · M4-5 行内格式：包裹/去包裹、链接占位、清除样式

- 新增 `src/editor/inline.ts` 纯函数：加粗 `**`、斜体 `*`、删除线 `~~`、行内代码按选区内容里的最长反引号串选择围栏长度；有选区时包裹或去包裹，无选区时插入成对标记并把光标放中间。选区本身带标记、或标记紧贴选区两侧时都能去包裹，组合标记（如 `***x***`）按目标格式只移除对应的一层。
- 斜体不会把纯加粗 `**x**` 误判为斜体标记：全选它再按 `Ctrl+I` 得到 `***x***`；对 `***x***` 按 `Ctrl+I` 去掉一层，按 `Ctrl+B` 去掉两层。清除样式按“已知标记”迭代剥离，行内代码内容用占位符保护，代码里的 `**literal**` 不会被当成加粗。
- 链接：无选区插入 `[链接文字](https://)` 并选中“链接文字”；有选区把选区作为链接文字并选中 `https://`；选区本身就是完整链接时只选中现有地址，不改正文。
- 清除样式只作用于选区（无选区 no-op）；会扩展选区以包含紧贴两侧的已知标记，链接保留文字、去掉地址，图片语法不当作 P1 格式处理。
- 快捷键：`Ctrl+B`、`Ctrl+I`、`Ctrl+Shift+反引号`（同时接受 `~`，覆盖美式键盘 Shift 后的键值）、`Alt+Shift+5`、`Ctrl+K`、`Ctrl+\`；全部只在编辑模式且源码编辑器有焦点时执行。命令、快捷键和未来的 M4-7 菜单共用同一 `SourceCommands` 接口。
- 复查后补充：部分选中已格式化的文字时按整个标记对去格式，不在中间生成孤立标记；行内代码内容以反引号开头或结尾时在围栏内加空格，避免与闭合围栏粘连；选区跨空行时三个包裹命令都拒绝执行；已有链接内选中文字或地址时改为选中地址，部分跨越链接边界时拒绝；清除样式保护图片与反斜杠转义文本，移除行内代码围栏后继续清理其内部已知标记；空成对标记再次切换会删除。
- 第二轮复查：行内代码只在内部反引号串短于围栏时去包裹，避免把 `` `x`y`z` `` 误拆；删掉相邻两个代码 span 边界反引号被合并的逻辑；清除样式支持 `_x_` / `__x__`，但保留 `snake_case` 这类词内下划线；选区与标记对边缘重叠时扩展到完整标记对，不再只删内部一层。
- 测试：行内变换 32 项（加粗/斜体/删除线/代码围栏与边界反引号/相邻围栏/链接重定位/清除样式/下划线与组合标记/图片与转义保护/跨空行拒绝）；App 键盘测试新增加粗与撤销。原生验证：全选后 `Ctrl+B/I`、`Alt+Shift+5` 分别得到对应标记且一次撤销恢复；`Ctrl+Shift+反引号` 的 `~` 键值也能插入代码标记；`Ctrl+K` 有选区时选中 `https://`、无选区时选中“链接文字”；`Ctrl+\` 清除 `**正文**` 后正文保留；无选区 `Ctrl+B` 插入 `****` 且光标在中间。复查后原生复验：空 `****` 再按 `Ctrl+B` 删除；选中第一行“a 加一个行尾反引号”后按 `Ctrl+Shift+反引号`，得到开闭各两个反引号、两端各留一个空格的代码围栏，避免内容末尾反引号与闭合围栏粘连；链接插入后一次撤销恢复。

### D-T44 · M4-6 选择、行移动、删除与源码查找替换

- 新增 `src/editor/lineops.ts`：选择当前行、选择当前段落（空行分隔的块）、上下移动当前行或选中行块、向前删除（选区 / 下一个字符 / 行尾合并下一行）。`Alt+↑/↓` 走该命令并保持选区跟随；文件首尾不越界；菜单专用的当前行、当前段落、删除先暴露 `SourceCommands` API，随 M4-7 菜单接入，不提前绑定快捷键。
- 新增 `src/editor/search.ts`：字面匹配、只对 ASCII 字母忽略大小写，中文和其他字符原样比较；空查询、零长度不产生匹配。源码查找条只移动编辑器选区到当前命中并显示计数，不修改正文；替换一个后自动选中下一个命中，全部替换一次事务完成，两者各为一步撤销。
- 编辑模式 `Ctrl+F` 复用 P0 查找条，增加“替换为 / 替换 / 全部替换”一行；阅读和预览模式不渲染替换控件，替换只作用于源码缓冲。查找输入保持焦点，编辑器只移动选区，不抢回焦点。
- 切换模式时关闭查找条，避免 DOM 查找与源码查找的状态混用；`Alt+↑/↓` 与 CodeMirror 默认键位冲突时由 App 捕获阶段统一处理。
- 测试：源码查找 4 项、行操作 9 项、App 行移动与替换/全部替换及撤销 2 项、快捷键 Alt 方向键 2 项；页面共 248 项，Go 178 项。原生：`Alt+↓` 将首行下移且一次 `Ctrl+Z` 恢复；编辑模式 `Ctrl+F` 出现替换行，查询 `bar` 显示 `1 / 1`，单次替换与全部替换正确，两个操作各自一次撤销恢复。当前行、当前段落与删除命令只有单测，用户入口等 M4-7。

### D-T45 · M4-7 菜单栏与保存全部：同一个命令，逐窗口编排

- 菜单栏是页面内的 HTML 菜单（不用原生菜单），文件 / 编辑 / 段落 / 格式 / 视图 / 帮助六个顶层菜单；菜单项、工具栏与快捷键都落到 App 的同一组 `SourceCommands` 或文件命令，禁用项在 `title` 中写明原因。文件菜单补最近打开、设置与关闭；帮助菜单提供快捷键说明与版本，避免未交付的 P2/P3 入口提前出现。
- 编辑类菜单只在源码编辑模式启用；保存/另存为在编辑与预览模式启用（同一缓冲），阅读模式禁用；复制在阅读/预览模式改为复制当前 DOM 选区到系统剪贴板。菜单支持点击外部关闭、Escape、上下键、左右键切换与 Home/End。
- 保存全部新增 Go 绑定 `SaveAll` / `ReportSaveAll` 与事件 `save-all-request` / `save-all-done`。Go 按窗口快照逐窗请求，页面复用现有保存、另存为与冲突对话框，完成后回报 `clean/saved/failed/unhandled`；一次只处理一个窗口，避免多个系统对话框同时抢焦点。汇总在发起窗口用对话框列出每个窗口的结果；5 分钟无响应的窗口记为未处理，关闭中的窗口也记为未处理。
- 保存互斥：前端 `savingRef` 阻止重复 Ctrl+S、菜单保存和保存全部重叠；保存/另存为菜单在保存进行中或已有保存提示时禁用并写明原因，其它快捷键在对话框打开时让路。Go 侧 `winctx.Window` 的保存锁把磁盘基线检查、写入和 `SetEditState` 串成同一临界区，避免两个保存调用交错产生假冲突。
- Go 发送失败或窗口关闭会立即记未处理并继续；页面若有未处理保存提示或保存正在进行，会直接回报未处理而不是覆盖提示。未命名窗口由该窗口自己的另存为对话框处理；取消或保存失败保持脏状态。同一文件多窗口的保存冲突继续走磁盘哈希基线与“另存为 / 覆盖 / 取消”，不在保存全部里静默覆盖；跨窗口冲突的完整验收仍属 M4-8。
- 测试：Go 保存全部路由 4 项（逐窗、乱序拒绝、关窗未处理、无法送达跳过）；页面菜单命令与保存全部流程 2 项；页面共 250 项、Go 182 项。原生：菜单栏六个顶层菜单和文件项可见；单窗口干净保存全部显示“已保存 0…无修改”；编辑后保存全部显示“已保存 1”，磁盘文件写入 `# alpha`；帮助快捷键说明列出 28 项。多窗口保存全部的系统对话框组合未做原生脚本化，Go 逐窗路由由单测覆盖，留 M4-8 总验收。

### D-T46 · M4-8 外部冲突与 M4 总验收：保留本地编辑，冲突不静默覆盖

- 编辑/预览中收到外部变更时不再只写状态栏：脏缓冲出现正文顶部提示条，提供“重新载入磁盘版本… / 另存为 / 保留当前编辑”。重新载入先弹确认，明确本地修改会丢失且不能靠 Ctrl+Z 恢复；保留只关闭提示，下次保存仍按磁盘哈希进入另存为 / 覆盖 / 取消。外部删除显示“文件不存在或已被移动”，不提供重新载入，保留后保存会进入“重新创建 / 另存为 / 取消”。
- 干净缓冲在编辑/预览中直接载入外部新内容；`SourceEditor` 重建状态时记录并恢复光标偏移与滚动位置，历史仍清空，避免跨版本撤销。预览模式重新调用 Go 渲染管线。
- 两个窗口编辑同一文件已用真实窗口验证：先保存窗口更新磁盘，后保存窗口弹“文件已被修改”，默认另存为，覆盖需要再次选择；Go 的按窗口保存锁阻止同窗并发保存交错。
- 保存发出时对缓冲做快照，返回后只把快照记为已保存；保存往返期间继续输入会让缓冲保持“未保存”，不会被误标为已保存。外部删除/不可读会把窗口视为有未保存内容（即使文本仍与上次保存一致），关窗仍走保护；保存全部遇到外部提示或重新载入确认框时，该窗口回报未处理而不是继续保存。原生复验：编辑保存成功；删除磁盘文件后提示条与未保存同时出现，保留后 Ctrl+W 仍弹关闭保护，Ctrl+S 进入“文件已不存在 / 重新创建 / 另存为”。
- M4 总验收记录 `docs/develop/M4-验收记录.md`：P1-AC-01 至 P1-AC-19 逐项列出证据与边界。自动测试页面 255 项、Go 182 项；真实桌面完成了外部修改/删除、两窗口冲突与单窗口保存全部。P1-AC-05 的真实 ACL 拒绝和 P1-AC-16 的多窗口保存全部 + 未命名 + 冲突组合仍需用户做桌面验收，记录中明确标注为自动通过 / 部分通过，不写成全部通过；P1-AC-19 的编辑路径不写盘保证标注为未做哈希验证。

### D-T47 · M5-0 P2 需求冻结：源码编辑不变，HTML/PDF 直出，扩展语法窄口放行

- 2026-11-17 用户确认冻结 `docs/P2-效率与排版需求.md`（门禁 G5）。P2 继续源码编辑 + 预览，不做所见即所得、表格网格或富文本编辑器；命令、菜单和验收都按该文档执行。
- 导出：HTML 与 PDF 都由应用直接写文件；已核实 mygo v0.9.0 提供 `Page.PrintToPDF`，PDF 不再依赖“打印为 PDF”对话框。打印保留 WebView2 打印预览；PDF/打印使用独立打印视图与新增打印样式，应用界面不得进入打印产物。
- 主题菜单只列浅色、深色、跟随系统，复用现有设置；PRD 16.2 的“更多内置主题”建议本期不实现，已在需求非目标注明。
- 扩展语法：表格用 GFM 管道表格；脚注用 `[^标签]`；警告框用 `> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]`；正文目录用独占一段的 `[TOC]`；下划线用 `<u>文字</u>`，只放行无属性的 `<u>`/`</u>`；注释用 `<!-- -->`，预览隐藏、源码可见；front matter 仍只读折叠，不解析 YAML。
- 安全边界：警告框、TOC、脚注结构由 Go 渲染器生成，白名单只增加闭合元素/类名/枚举；文档提供的其他 HTML 继续转义。导出 HTML 使用独立导出清理器，`data:image` 只允许 `img.src`。新增恶意样本进入 `testdata/malicious/`。
- 文件与剪贴板：图片插入/粘贴复制到文档同目录 `assets/`，重名加序号；COPY 图片统一转 PNG 写入剪贴板；富文本粘贴按清理后的纯文本，不做 HTML→Markdown 转换。文件移动/回收站删除/属性/定位使用 mygo `Shell.TrashItem`、`Shell.ShowItemInFolder` 与项目 Go；移动目标由用户显式选择，跨窗口脏状态读取自既有 `setEditState`。
- 阶段登记：M5-5 补 EDIT-06（粘贴图片），M5-8 的主题菜单改为浅色/深色/跟随系统，删除“更多内置主题”。P2 命令共 42 项在需求文档中逐项有落点；文档编码与无 emoji 检查通过。M5-0 只交付需求，无代码改动。

### D-T48 · M5-1 文件操作：先处理脏状态，移动不覆盖，删除只进回收站

- 新增绑定 `MoveDocument`、`TrashDocument`、`DocumentProperties`、`RevealDocument`、`AttachParentFolder`；新增事件 `file-trashed`。文件目标可用空 rel 表示当前文档，或使用相对工作区根的路径；Go 侧仍经 `pathguard.Canon`、`Within`、`CheckComponents` 校验。
- 移动：同盘重命名；跨盘复制到目标临时文件、SHA-256 校验、替换目标、删除源文件，失败保留源文件并清理临时文件。目标重名直接中止，不覆盖。移动前锁定所有展示该文件的窗口的保存锁并重新检查脏状态；成功后更新所有窗口路径、监听、最近记录与恢复目标，并发送 `doc-updated`。
- 删除：只调用 `Shell.TrashItem`；回收站不可用时文件保持原位，绝不永久删除。成功后停止监听、移除最近记录，向所有展示该文件的窗口发送 `file-trashed`；窗口保留内存内容与路径，仍可另存为或重新创建。
- 脏状态：页面先给出保存/放弃/取消；放弃时先等待 `setEditState(false)` 到达 Go，再执行移动/删除，避免“刚放弃却被 Go 判为其他窗口脏”的竞态。Go 侧保存锁把保存与移动/删除串行化。
- 属性：只读展示路径、大小、编码、换行、修改时间、只读属性；换行额外区分 LF、CRLF、混合。未命名文档由页面本地显示“尚未保存”。
- 定位：`Shell.ShowItemInFolder` 不返回启动错误，应用只校验文件存在；Explorer 启动失败按尽力而为处理，契约不承诺 `reveal_failed`。
- 侧栏定位：目录模式展开祖先并选中；单文件模式或文件在工作区外时，确认后以父目录为新根，当前文档与缓冲保持不变。
- 原生验证：属性字段正确；“在侧边栏中显示”后当前文档保持、树列出 alpha/beta；删除 alpha.md 成功进入回收站，窗口显示已移除横幅与另存为。移动目录对话框与资源管理器启动未脚本化，记录在 `docs/develop/M5-1-验收记录.md`。
- 测试：页面 263 项、Go 195 项；跨盘回退通过注入重命名失败覆盖校验路径。跨盘复制保留时间与权限位，ACL 继承目标目录，属于已知边界。

### D-T49 · M5-2 左侧视图与目录搜索：Go 解析大纲，搜索走扫描与 Channel

- 左侧视图为文件树、文档列表、大纲、目录搜索四种状态，每窗口本进程记忆，不写入设置；视图菜单用勾选项标出当前状态。
- 大纲由 Go `ExtractOutline` 用与渲染器相同的 GFM/公式解析器提取，返回级别、文字与 1-based 源码行号；编辑模式停止输入 300ms 后更新，阅读/预览用当前文本。最多 500 个标题。点击大纲在编辑模式跳到源码行，阅读/预览按标题序号滚动。
- 文档列表由扫描结果过滤 Markdown 文件并按路径自然排序，重名文件显示相对路径；单文件模式确认后以父目录为工作区再切换。
- 目录搜索 Go 侧先扫描已授权根，再逐文件经 `docread` 读取；文件名与正文都匹配，拉丁不区分大小写、中文原样；500 条命中、200 个文件、单文件 10 MiB，超过上限标记截断。结果通过 Channel 分批发送，页面关闭 Channel 即取消。
- 搜索结果严格按纯文本展示；点击结果打开文件，阅读/预览用搜索词执行文内查找，编辑模式由大纲按行定位。单文件模式先确认打开父目录，再进入搜索。
- 快捷键：`Ctrl+Shift+1/2/3` 切换大纲/列表/树，`Ctrl+Shift+F` 搜索；`Ctrl+Shift+L` 与视图菜单共用侧栏开关；预留侧栏开关也在视图菜单。
- 原生验证：目录+文件启动显示树；大纲、列表、树切换正常；搜索“共同”在 alpha/beta 各一条，点击 beta 打开并显示文内查找 1/1。视图菜单勾选状态由页面测试覆盖。
- 测试：页面 277 项、Go 202 项。搜索取消、单文件确认、重名相对路径与结果打开由自动测试覆盖；1 万文件列表压力与搜索取消的原生操作未单独执行。

### D-T50 · M5-3 扩展语法：渲染器生成结构，编辑器只写固定源码

- 渲染：启用 goldmark `extension.Footnote`；新增警告框/TOC 的 AST transformer 与自定义节点渲染器；下划线只放行精确的无属性 `<u>`/`</u>`；完整 HTML 注释在阅读/预览隐藏，未闭合与混排仍转义。
- 安全：警告框类型、TOC 结构与脚注 id 由渲染器生成；白名单只增加闭合枚举的 `nav`、`sup`、`u`、`alert*`/`toc*`/`footnote*` 类名、`data-type` 五值、脚注 `role` 三值；文档原始 HTML 继续转义。脚注返回文字在清理后替换为“返回”。
- 编辑器：新增 `src/editor/extended.ts` 纯变换，覆盖表格插入/行列/对齐/删除、脚注、警告框、引用式链接、`[TOC]`、front matter、下划线与注释；SourceEditor 以一次 dispatch 应用，菜单与 `Ctrl+U` 复用同一命令。表格插入使用应用内行列对话框。
- 清除样式同步移除 `<u>`；注释、警告框、脚注、TOC、front matter 等块结构不参与清除样式，行内代码/公式保护不变。
- 原生验证：rich.md 显示警告框 `alert alert-note`/`data-type=note`、TOC 标题链接、脚注“返回”、下划线、表格；隐藏注释未出现在正文。
- 测试：页面 287 项、Go 209 项。表格与扩展语法的保存重开未单独做原生往返；TOC 使用平铺 `ol` 加层级 class 缩进，不是嵌套列表。

### D-T51 · M5-4 链接操作与图片落盘：两阶段确认，永不覆盖

- 链接操作放在格式菜单的“链接操作”子菜单：编辑地址…、移除链接、复制链接地址。光标位于行内或引用式链接内才启用，禁用项写明“光标不在链接内”。菜单栏新增一层子菜单，支持点击、悬停、左右方向键展开与 Escape 先关子菜单。
- 链接变换是纯函数：行内链接只替换目标地址，链接文字与 `"标题"` 保持；引用式链接只改文末定义行，所有引用点共享同一地址；移除链接只把 `[...](...)` 或 `[...][...]` 还原为文字，不删除定义行。复制地址只写系统剪贴板，不访问网络。
- 图片插入/更换采用两阶段绑定：`PickImage` 选择并校验本地 PNG/JPEG/GIF/WebP、计算 `assets/` 目标、返回一次性令牌，不写文件；页面在确认对话框显示完整目标路径后才调用 `CopyImage`。取消调用 `CancelImage`，不创建目录。
- `CopyImage` 重新校验源图、窗口根与文档范围，在创建 `assets/` 前先检查文档所在目录，创建后再检查目标目录没有链接/联接；确认期间工作区改变会拒绝写入。复制用独占创建，目标已存在即失败，绝不覆盖；同名文件在选择阶段自动使用 `名称-1.ext`。
- 生成 Markdown 路径为 `assets/` + `url.PathEscape(文件名)`，中文与括号按 URL 编码，图片仍经 `mtres` 协议与文件头校验加载。未落盘文档禁用插入图片并提示先另存为；更换图片不删除旧图片文件。
- 菜单启用：插入图片要求编辑模式且文档已落盘；更换图片还要求光标位于 `![...](...)` 语法内。路径拒绝、超限、格式不支持时显示 Go 返回的原因，不插入链接。
- 测试：页面 295 项、Go 213 项；Go 覆盖选择不写盘、复制到 assets、重名序号、URL 编码、令牌一次性、取消不建目录、确认期间目标被占用与工作区改变。原生已验证链接子菜单三项可用、编辑地址保留链接文字、复制地址写入系统剪贴板、移除链接还原文字；系统图片选择对话框无法稳定脚本化（D-T17），图片完整点击流程待用户桌面验收。

### D-T52 · M5-5 剪贴板扩展：一次 Item 双格式，选区按来源分流

- 新增绑定 `ClipboardCopyPlainText`、`ClipboardCopyHTML`、`ClipboardCopyImage`、`ClipboardReadImage`。HTML 与简化格式通过 `transfer.NewItem(transfer.Bytes(transfer.HTML, …), transfer.Bytes(transfer.Text, …))` 写入同一个 Item；图片统一解码为 PNG，再以 `transfer.PNG` 写入。现有纯文本绑定继续保留。
- 源码选区与阅读/预览选区分开处理：源码选区交给 Go 渲染或提取文本；阅读选区由页面把 DOM 片段裁剪到 `.markdown` 文章、替换 KaTeX 与 Mermaid 为源文本，再交给 Go 的剪贴板白名单二次清理。阅读选区使用 Range 与文章范围求交，Ctrl+A 或跨出正文的选区只复制正文，不复制工具栏与状态栏。
- 普通 HTML 清理保留标题、段落、列表、引用、代码、表格与安全链接；简化格式只保留 `p`、`br`、`strong`、`em`、`ul`、`ol`、`li`、`blockquote`、`code`、`a[href]`，标题降为加粗段落，表格与图片整体移除，无安全 `href` 的链接只保留文字。纯文本回退保留表格制表符、代码换行与图片替代文字。
- `Ctrl+V` 在编辑区改由页面接管：先读纯文本，有文本就插到当前选区；没有文本再尝试剪贴板图片。“粘贴图片”仍是独立菜单入口，明确只走图片流程。焦点在查找框等非编辑区时 `Ctrl+V` 不被拦截。`Ctrl+Shift+V` 保持纯文本。
- 图片粘贴复用 M5-4 的两阶段确认：`ClipboardReadImage` 只准备 `assets/` 目标与一次性令牌，确认后才调用 `CopyImage`。PNG 原样写入，其他格式转 PNG；输入与转码后的 PNG 都检查 20 MiB，像素检查 2500 万；未落盘文档返回 `no_file`。切换文档会丢弃待确认图片，避免把资源写到旧文档目录。
- 拷贝图片的 `source` 来自编辑器图片语法或阅读区 `mtres` 地址；Go 侧相对路径走文档目录授权，`mtres` 令牌必须属于调用窗口；复制只读文件，不修改文档、不联网。
- 对抗式审查发现并修复四项：待确认图片跨文档存活、转码 PNG 未复检大小、菜单 `mousedown` 阻止默认后丢失键盘焦点、Ctrl+A 选区因共同祖先在文章外而被判为空。测试：页面 305 项、Go 221 项；原生验收见 M5-5 验收记录。

### D-T53 · M5-6 导出与打印：页面增强产物 + 独立导出清理器 + 隔离打印窗口

- 导出正文来自页面已经增强的 `.markdown` DOM：公式取 KaTeX 的 MathML，Mermaid 取净化后的内联 SVG，图片保留 mtres 引用，front matter 与注释不进入正文。编辑模式先在离屏 `.markdown` 容器里用同一渲染管线生成并增强，再序列化；阅读/预览直接使用当前文章。为此 `renderMath` 增加了幂等保护：已有 `.katex` 或 `.math-error` 的元素不再重复排版。
- Mermaid 12 的标签开关改为根级 `htmlLabels: false`；此前写在 `flowchart` 下已弃用，导致标签依赖 `foreignObject` 并被 DOMPurify 清空。启用根级开关后标签是 SVG `<text>`，页面与导出都能保留“开始/判断/结束”等文字；DOMPurify 仍只启用 SVG profile，并禁止 `img`、`script`、`iframe`、`object`、`embed`、`link`、`meta`。
- 新增独立导出清理器（不复用页面 bluemonday）：HTML 结构、MathML 固定元素/属性子集、Mermaid SVG 固定元素/属性子集；SVG 的 `style` 只允许本地 `url(#id)`，拒绝 `http(s)`、`data:`、`@import`、`expression`、`javascript:` 与控制字符链接。图片只允许 `data:image/(png|jpeg|gif|webp);base64,` 出现在 `img.src`；超 20 MiB 总量或读取失败时替换为占位并回报警告。
- HTML 导出模板是固定字符串：`lang="zh-CN"`、文档名标题、固定打印样式、代码高亮颜色、CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'`；写入走用户选择路径与 `docwrite` 原子替换，取消不写文件。
- PDF 与打印使用隔离的 mygo 窗口加载同一份导出 HTML。窗口先等待初始 about:blank 完成，再 LoadHTML，并用 `main.markdown` + `document.readyState` 轮询确认正文已提交；随后等待图片与 `document.fonts.ready`。窗口设置 `Untrusted`，不注册进 winctx，并在 `printWindowIDs` 中登记，打开请求与焦点路由跳过它。PDF 使用 A4 纵向、0.6 英寸边距、打印背景；打印窗口保持打开供用户查看/关闭，打印预览取消不影响正文与文件。
- PDF 的 30 秒预算覆盖实际 `PrintToPDF` 调用：该 mygo 调用不接受 context，因此在 goroutine 中执行并 select context；超时关闭打印窗口以释放挂起的 CDP 调用，服务层总会释放导出单飞槽。此前的隐藏/离屏窗口在 WebView2 中会得到空白 PDF，最终采用可见但独立的打印窗口，并通过初始页面等待避免空白/竞态。
- 对抗式审查修复五项：`details.fm` 判断误删 chroma `fm` 代码 token、`PrintToPDF` 超时未真正生效、打印窗口被第二实例当成打开目标、控制字符 href 未拒绝、打印视图页面被当作受信页面。测试：页面 311 项、Go 228 项；原生验收见 M5-6 验收记录。

### D-T54 · M5-7 视图模式与窗口：每窗口会话状态，Ctrl+Tab 由页面接收

- 专注模式（F8）在 CodeMirror 中用行装饰淡化当前空行分隔段落以外的行，当前段落保持正常对比度；打字机模式（F9）在光标/文档变化时把当前行滚动到视口约 40% 高度。两者只在编辑模式启用，阅读/预览的菜单项禁用并说明原因；状态为每窗口会话状态，不写设置。
- `Ctrl+Tab` 在真实 WebView2 窗口实测由页面 keydown 捕获，不需要原生菜单加速器，也不注册全局热键；`Ctrl+Shift+Tab` 反向。Go 侧 `winctx.Registry` 记录创建顺序作为兜底，`RecordFocus` 维护 MRU；打印视图不注册进注册表且在焦点路由中排除，因此不会成为打开请求或切换目标。对话框打开时页面统一拦截切换命令。
- 全屏（F11）、置顶、缩放进整页 WebView2；全屏退出由 mygo 用 `GetWindowPlacement` 恢复原尺寸与位置，缩放范围 50%–200%、10% 步进，超出边界由 Go 夹取。三者均为每窗口会话状态；前端不传窗口 ID，Go 用 `CallerWindow(ctx)` 定位。
- 字数统计由 Go 用与渲染相同的 goldmark 解析器计算：CJK 字符每字 1 词，连续拉丁字母/数字/下划线 1 词；排除 front matter 与注释；代码块和公式源码计入字符；段落数为段落、标题与代码块。页面有选区时传选区，否则传全文；结果只读对话框展示。
- 状态栏显隐是 M5-7 唯一新增持久化偏好：`SettingsView.showStatusBar`、`appstate.Settings` 用指针兼容旧文件默认显示；保存成功后发 `settings-changed` 给所有应用窗口。隐藏后提示消息改为右下浮动条，窗口标题用 `•` 标出未保存状态，保存失败/冲突仍通过对话框与提示可见。
- 对抗式审查修复六项：光标停在空行时专注模式误合并相邻段落、文档替换后用旧滚动位置覆盖打字机定位、隐藏状态栏时绑定连接失败不可见、选区统计误把开头 `---` 当 front matter、紧凑列表/表格跨块合并词且段落数为零、Ctrl+滚轮可绕过菜单缩放导致百分比过期（页面拦截 Ctrl+滚轮，缩放只由视图命令控制）。测试：页面 327 项、Go 233 项。原生：Ctrl+Tab/Ctrl+Shift+Tab 在两个窗口间切换焦点；F11 全屏并恢复；置顶开/关；缩放 100%→110%→100%；F8 淡化 31/32 行；F9 光标移动后滚到 577px；字数统计 213 字符/176 非空白/100 词/10 段；隐藏状态栏跨窗口生效且重启保留，随后恢复显示。详见 M5-7 验收记录。



### D-T55 · M5-8 编辑辅助与主题菜单：纯变换命令、缓冲内 LF、主题复用设置

- 删除范围、清理行尾空格与确保末尾换行都做成 `src/editor/editassist.ts` 的纯快照变换，SourceEditor 用一次 dispatch 应用，因此每个命令是一步 CodeMirror 撤销。删除词向前删除：拉丁字母/数字/下划线连续串为一个词，CJK 每字为一个词；删除行删除当前行与行尾换行，最后一行改为删除前导换行；删除段落删除空行分隔的当前块并连带一个分隔空行。菜单只在编辑模式且源码编辑区有焦点时启用；菜单/工具栏获得焦点不视为离开编辑器，命令执行后焦点回到编辑器。
- 清理行尾空格删除空格与制表符，但代码围栏与缩进代码行不处理，反斜杠硬换行保留反斜杠并去掉其后空格，两个及以上空格构成的硬换行保留恰好两个空格。确保文件末尾换行把末尾多个换行收敛为一个；空文件不修改。两个命令无变化时返回 null，不标记脏、不产生撤销步骤。
- 编辑器缓冲始终保存 LF；`DetectLineEnding` 在打开/属性查询时报告 `LF`、`CRLF` 或 `混合`。换行符子菜单显示当前值并提供转换为 LF/CRLF：转换不修改缓冲文本，只改变窗口的换行选择并标记未保存；编辑器记录最近一次转换，第一次 `Ctrl+Z` 先撤销转换（之后有文本编辑时转换随该编辑一起失效）。混合换行不做转换直接保存时沿用 P1 规则统一写 CRLF，保存结果回填状态栏与窗口状态；转换后保存按所选值写回，BOM 与冲突基线逻辑不变。
- 表情与符号只在编辑模式的菜单里显示“按 Win+. 打开 Windows 表情面板”的非阻塞提示；不注册全局快捷键、不拦截 Win+.，系统面板输入按普通文本进入 CodeMirror。
- 顶层新增“主题”菜单，位于“视图”和“帮助”之间，只有浅色、深色、跟随系统三项单选。它读写同一 `appearance` 设置：本地立即应用并调用 `saveSettings`，Go 的 `theme-changed` 事件让所有窗口同步；不新增主题或自定义配色，视觉仍以 DESIGN.md 两套令牌为准。
- 测试：页面 336 项、Go 237 项；新增恶意样本 `testdata/malicious/extensions.md` 覆盖警告框、脚注、TOC、下划线、注释与引用定义中的脚本、事件属性、危险协议和远程图片；新增大表格完整渲染与搜索取消 1 秒内生效的回归用例；`bun run build:web` 仍通过，保持既有大分包警告。原生验收见 `docs/develop/M5-8-验收记录.md`。

### D-T56 · M5 发布版本 0.5.0：版本号只以 mygo.config.ts 为准

- 版本从 P0 验收构建的 `0.1.0` 升到 `0.5.0`，对应 P2/M5 阶段完成；`identifier` 仍为 `dev.mile.typora`，不因版本升级改变应用数据目录与单实例标识。
- `mygo.config.ts` 是版本号唯一来源，`mygo build` 用它生成 `Mile Typora.exe` 的 PE 元数据与 `mile-typora-setup-0.5.0-amd64.exe` 文件名；`package.json` 不重复写版本，避免两处漂移。
- 产物与哈希记录在 `docs/develop/M5-发布记录.md`。构建使用 `bun run build`；不提交 `build/` 产物，发布时将安装包与免安装版一起交付。
- 本次只做启动冒烟，未在干净系统验证安装向导与 WebView2 缺失引导；已列入发布记录的待验收项。

### D-T57 · M6-1 导入：Go 侧离线转换，新缓冲不落盘图片

- `ImportDocument` 在 Go 侧读取用户选中的 HTML / HTM / DOCX，转换为 Markdown 文本与格式损失警告；前端不执行输入内容、不把导入结果写进 `innerHTML`。HTML 使用已有 `golang.org/x/net/html` 遍历器，DOCX 使用标准库 `archive/zip` + `encoding/xml`，不引入第三方文档转换库。
- 输入上限 10 MiB；HTML 只接受 UTF-8；DOCX 检查 ZIP/OOXML、最多 2048 个条目、相关 XML 解压合计 32 MiB、压缩比超过 100:1 拒绝、拒绝 `..` / 绝对路径，宏、OLE、页眉页脚、脚注与外部关系一律不读取。转换超时 8 秒。
- 图片不落盘：HTML 只保留 http(s) 图片地址（阅读器仍不会请求远程图片），本地 / `data:` / `file:` 图片与 DOCX 内嵌图片变成替代文字或“图片未导入”占位并警告。这样未保存缓冲不会写入无授权目录，也不会产生假资源路径。
- 导入结果写入新缓冲：调用窗口没有打开文件且不脏时直接载入；否则新建窗口，通过 `ReadyInfo.startText` / `startName` 移交文本。`winctx.Window` 增加一次性 start text 状态，`ClearStartUntitled` 同时清理它；不改变 Ctrl+N 的现有行为。
- 新绑定与契约：`contract.ImportResult`、`ReadyInfo.startText/startName`；`src/mygo.ts` 由 `bun run generate` 重建。前端 `transport.importDocument()` 统一返回 `imported` / `cancelled` / `failed`，导入期间禁用再次触发，警告用独立对话框展示。
- 测试：HTML/DOCX 转换、恶意输入、路径穿越、宏/页眉忽略、容量与取消、空窗口导入与新窗口移交；原生系统文件对话框无法脚本化，完整点击流程按既有约定留给用户桌面验收。

### D-T58 · M6-2 数学工具：纯文本变换，KaTeX 只做检查

- 新增 `src/editor/mathtools.ts` 纯变换：行内公式包裹/解包、公式模板、四种定界符转换与公式信息读取。命令经 SourceEditor 的一次 dispatch + isolateHistory 应用，一步撤销；不做 CAS、求解、公式 OCR 或源码内实时预览。
- 公式识别支持 `$…$`、`\(…\)`、`$$` 块与 `\[…\]` 块；跳过 front matter、围栏/缩进代码、行内代码、HTML 注释、分隔线与保护行。菜单新增 `inMath` / `mathBlocked` 上下文：转换与检查要求光标在公式内，模板在代码或 front matter 内禁用并说明原因。
- `检查当前公式` 复用 `src/render/math.ts` 新增的 `validateMath`，参数与阅读渲染一致（`trust: false`、`strict: warn`、`maxSize: 50`、`maxExpand: 1000`）；只把 KaTeX 的真实错误显示在非阻塞提示中，不自动修改公式。
- 公式模板为有界清单：分数、根号、上标、下标、矩阵、分段函数、多行对齐、求和、积分、极限；插入后选中第一个占位内容。块级公式复用既有 `insertFence` 公式块命令（`Ctrl+Shift+M`），不新增快捷键。
- 数学模块与编辑辅助一样按需加载，避免把 CodeMirror 相关代码带进阅读首包；`contextAt` 增加 `inMath` / `mathBlocked` 供菜单使能，不改变既有表格、链接、图片上下文。
- 测试：mathtools 纯变换、KaTeX 校验、页面数学子菜单与只读禁用；原生验收见 `docs/develop/M6-2-验收记录.md`。

### D-T59 · M6-3 智能标点：inputHandler 逐键变换 + 共享保护判定

- 新增 `src/editor/smartpunct.ts` 纯函数：对每个新输入的 `"`、`'`、`.`、`-` 决定是否转换，返回 `{from,to,insert}`；SourceEditor 经 `EditorView.inputHandler` 在同一次 dispatch 里替换，一次 Ctrl+Z 撤销输入本身。只拦单字符，IME 组合（`view.composing`）、粘贴与多字符输入直接放行；没有批量改写命令（P3 §3.3 已冻结）。
- 新增 `src/editor/protection.ts` 共享判定（P3-AC-14）：`protectedAt` = `protectedLineSet`（front matter、围栏/缩进代码、公式块、分割线）+ `inlineProtected`（行内代码、HTML 标签/注释、链接图片地址、autolink、行内公式）。`includeMath` 参数让数学工具把公式从判定中排除——数学命令要在公式内部运行，而块级 `$$` 仍由 `protectedLineSet` 保护；`mathProtected` 改为 `protectedAt(text,pos,false)`，三个扫描器用同一份判定不会漂移。
- 规则实现：`"` 仅在前或后是 CJK 时转换，开括号/空白/行首出 `“`，其余 `”`；`'` 只在两个 CJK 之间转换（`don't` 保持半角）；`...` → `…`；`--` → `–`、`--`+`-`（含已有 `–`+`-`）→ `—`，全行只有横线与空格的行（分割线/front matter 线）不转换。
- 设置链：`appstate.Settings.SmartPunctuation *bool`（老文件无字段默认 false）→ `SettingsView`/`SettingsChange` 加字段 → `SaveSettings` 持久化并在变化时广播；编辑菜单新增「智能标点」子菜单（一项 checkbox 与设置同步），设置对话框「编辑」组加复选框。
- 测试：smartpunct 纯变换（CJK 上下文、开闭引号、`don't`、省略号、`--`/`---`、保护区域、IME/多字符放行）、protection 共享判定一致性、appstate 默认值与往返、service `settingsChanged` 广播、App 菜单勾选态与持久化；原生验收见 `docs/develop/M6-3-验收记录.md`。

### D-T60 · M6-4 拼写检查：typo-js 词典 + 自绘波浪线 + 区域扫描去抖

- 词库：`typo-js@2.0.0`（Hunspell 风格）+ 包内自带 `en_US.aff/.dic`，经 Vite `?url` 静态资源引入、`fetch` 取内容交给 `new Typo("en_US", aff, dic)`；不联网、不调系统检查器、不支持其他语言（CJK 永不标记）。`.dic`（约 540 KB） emit 为独立 asset，`.aff`（约 3 KB）被 Vite 内联成 data URI，`fetch` 两者都成立。
- 懒加载：`src/editor/spellcheck.ts` 的 `loadDictionary()` 只在设置首次打开时跑一次（模块级 promise 缓存），失败返回 `null` 不抛错——词典缺失时检查器安静地保持关闭而不是拖垮编辑器。源码区 `contentAttributes` 固定 `spellcheck="false"` 关掉 WebView2 原生检查器，避免双下划线。
- 自绘：StateField 持有 `Decoration.mark`（`cm-spell-error`，CSS 波浪线 `underline wavy var(--danger)`）；ViewPlugin 在 `docChanged`/`viewportChanged` 后 400 ms 去抖扫可见视口，单次最多 5000 个英文词，滚动与换文档触发重扫。关闭设置时显式 `field.init(() => Decoration.none)` 清标记，不靠下一次输入。
- 范围：只扫正文/标题/列表文本；跳过围栏与缩进代码、行内代码、行内/块级公式、front matter、链接图片地址、HTML 标签/注释、Markdown 标记——复用 `protectedAt` 共享判定（P3-AC-14），并新增 `protectedMask` 批量版本：范围扫描一次预计算，替代逐词全文扫描（6000 词从超时降到亚秒）。
- 右键菜单：自绘页面级浮层，仅在右键落在被标单词上时出现；至多 5 条建议 + 「忽略本次」（会话级 Set，不持久化）。点建议是一次可撤销编辑；点空白、Esc 或换词关闭。
- 设置链：`appstate.Settings.SpellCheck *bool`（老文件无字段默认 false）→ `SettingsView`/`SettingsChange` 加字段 → `SaveSettings` 持久化并在变化时广播；编辑菜单新增「拼写检查」子菜单（一项 checkbox 与设置同步），设置对话框「编辑」组加复选框。
- 测试：spellcheck 纯函数（错词标记、CJK 跳过、保护区域、5000 词上限、`wordAt` 边界与保护区、忽略清单、建议、hasWordChars）、appstate 默认值与往返、service `settingsChanged` 广播、App 菜单勾选态与持久化；原生验收见 `docs/develop/M6-4-验收记录.md`。
