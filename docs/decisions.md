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
