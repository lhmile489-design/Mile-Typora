# CLAUDE.md — Mile Typora

> 给 AI 的项目级说明。优先级：用户当次指令 > 本文 > `docs/PRD.md` > `DESIGN.md` / `docs/decisions.md` > 项目 skills > 全局 `~/.claude/CLAUDE.md` > 通用经验。
> 全局规范（UTF-8、不编造、无 emoji、破坏性操作先确认、没有证据不算完成）照常生效，本文只写本项目特有的内容。
> 最后更新：2026-11-17（PRD v0.4；P0 完成，P1 需求已冻结；M4-1 至 M4-6 完成，保存全部与编辑/段落菜单留 M4-7）

## 0. 先读这几条

1. **P0 已完成（G4，29/29），P1 需求已冻结（G5，2026-11-16），M4-1 至 M4-6 已完成。** 按 [docs/开发计划.md](docs/开发计划.md) 继续 M4-7 菜单；“保存全部”与选择/删除等菜单入口随 M4-7 一起接。碰到 §1.5 的门禁就停下来让用户决策。
2. **需求以 [docs/PRD.md](docs/PRD.md) 为准**，[PRODUCT.md](PRODUCT.md) 是精简版。PRD 区分"已确认项"（C-01 至 C-12）和"建议默认项"（D-01 至 D-11、性能与容量数值），不能把建议项说成用户已确认。
3. **P0 是只读阅读器。** 任何写用户文件、写工作区目录的代码在 P0 都是缺陷。
4. **视觉以 [DESIGN.md](DESIGN.md) 为准**，组件不硬编码颜色、字号、间距。
5. **mygo API 以 v0.9.0 本机源码为准**，不凭记忆写 API。
6. **原生多窗口是最高风险项**，M1 第一件事就是在真实 Windows 11 窗口验证；不满足时停下来让用户决策，不能擅自改成标签页。

## 1. 项目概况

Windows 11 本地桌面 Markdown 阅读器。单文件预览、原生多窗口、目录文件树、CommonMark/GFM、数学公式、Mermaid，全部离线。三栏布局：左文件树、中正文、右侧空白预留（未来 Agents，P0 不接）。版本路线 P0 只读 → P1 编辑 → P2 效率排版 → P3 高级工具，见 PRODUCT.md §4。

```text
Mile-Typora/
├── CLAUDE.md                     本文件
├── PRODUCT.md                    产品概览
├── DESIGN.md                     设计令牌与组件规范（深浅两套）
├── main.go                       启动顺序：单实例 -> 外观 -> Bind -> WhenReady -> Run
├── internal/
│   ├── contract/                 前端可见的类型（Failure、ReadyInfo …）
│   └── service/                  绑定服务（WindowService …）
├── src/
│   ├── mygo.ts                   mygo generate 生成物，禁止手改
│   ├── main.tsx
│   ├── app/                      窗口根组件
│   ├── lib/transport.ts          唯一 import src/mygo.ts 的模块
│   ├── mocks/                    仅开发与单测
│   └── styles/                   tokens.css（取自设计稿）、app.css
├── public/theme-init.js          防白闪
├── public/icon.png               页面图标（脚本生成）
├── resources/icon.png            应用图标 1024（脚本生成）
├── resources/icon-dev.png        开发窗口图标，带 DEV 徽标（脚本生成）
├── scripts/make-icons.py         从设计原图生成上述图标
├── mygo.config.ts / vite.config.ts / vitest.config.ts / tsconfig.json
├── docs/
│   ├── PRD.md                    需求权威来源
│   ├── 开发计划.md               M1–M6 小阶段拆分、门禁、AC 覆盖矩阵、进度
│   ├── decisions.md              技术与产品决策（含依赖版本）
│   ├── develop/接口契约.md       绑定方法、事件、错误码
│   └── design/mile-typora-design.html   HTML 设计稿，顶部可切换深浅色
├── .agents/skills/               mygo init 附带的上游 skill（mygo-maintenance、mygo-native-modules），未改动
└── .claude/
    ├── skills/                   项目内 skills（见 §4）
    └── launch.json               design-draft（端口 8765）、web-shell（浏览器里看外壳，端口 5274）
```

开发端口：`mygo dev` 用 5273（`vite.config.ts` 与 `mygo.config.ts` 的 `devUrl` 同步，`strictPort`）；identifier `dev.mile.typora`，定稿不改。

Git：远程 `https://github.com/lhmile489-design/Mile-Typora.git`，分支 `main`。提交遵循 Conventional Commits，只 `git add` 本次任务相关的路径；推送前先问用户。

## 2. 技术栈（2026-11-16 锁定，详见 docs/decisions.md）

| 层 | 选型 |
| --- | --- |
| 桌面框架 | egoist/mygo **v0.9.0**（web 模板，WebView2）；npm `mygo-runtime` / `mygo-cli` 钉在 0.9.0（精确版本）。项目内用 `bun run dev/build/generate` 调本地 CLI，不用全局 `mygo`（本机全局是 0.8.3） |
| Go | 1.27.3；goldmark v1.8.7（含 GFM）、passthrough v0.6.0（公式定界）、goldmark frontmatter v0.3.0、chroma v2.27.0、bluemonday v1.0.27；文件监听用 mygo 自带 `WatchFiles` |
| 前端 | React 19.3.1、Vite 8.3.8、TypeScript 7.0.2、Bun 1.3.13；KaTeX 0.19.1、mermaid 12.3.0（按需加载）、DOMPurify 3.4.18、lucide-react 1.73.0、@tanstack/react-virtual 3.14.26；CodeMirror 6.7.6 / 6.43.15 / 6.11.1 / 6.13.1 / 6.5.2（编辑模式按需加载） |
| 状态管理 | React 内置 `useReducer` + Context，每窗口一个 store |
| 测试 | Go `testing`（含 fuzz、race）；Vitest 5.1.0 + Testing Library 16.3.3 + jsdom 31.0.1 |
| 字体 | 系统字体：Segoe UI Variable、微软雅黑 UI、Cascadia Mono |
| 平台 | 仅 Windows 11 x64 |

分工：**Go 解析 Markdown 并做白名单清理，前端只渲染公式、图表和交互**（D-T02）。

## 3. mygo v0.9.0 源码与关键事实

- 源码：`C:\Users\LHmile\go\pkg\mod\github.com\egoist\mygo@v0.9.0\`；先读 `docs/app.md`、`docs/windows.md`、`docs/bindings.md`、`docs/frontend.md`、`docs/native.md`。模板在 `cmd\mygo\template\web\`。
- 已核对的事实（详见 `docs/decisions.md` D-T01）：
  - 最后一个窗口关闭即退出；不要注册 `OnWindowAllClosed`。
  - 事件用 `EmitPage` / `Emit(win)` 定向发送，业务数据不用 `Broadcast`。
  - 生产构建 `PageOptions.DevTools = DevToolsDisabled`，同时关掉 WebView2 的 F5、Ctrl+P、Ctrl+F 等默认按键。
  - 本地图片经 `mygo.Protocol.Handle("mtres", ...)`（建窗前注册），Windows 上地址 `http://mtres.localhost/...`。
  - 前端 `CallError` 不带错误码，可预期的失败放在返回值的 `failure` 字段。
- `mygo.config.ts`、`vite.config.ts`、`package.json` 来自 `mygo init`，契约字段只增不改；已填的值是 identifier、端口 5273、mygo 包精确版本 0.9.0（decisions.md D-T12）。`src/mygo.ts` 是生成物，禁止手改。
- `mygo init` 默认取最新版（这次写成了 v0.9.1），已手动钉回 v0.9.0。升级 mygo 需在 decisions.md 新增条目并经用户同意。
- 参照项目 `E:\mygo\my-app\` 只参考工程结构，不照搬其业务参数和 Bento 视觉。

## 4. Skills

### 4.1 项目内 skills（优先，已按本 PRD 改写）

路径：`.claude/skills/`。动手前先读对应 `SKILL.md`，`references/` 只在命中具体问题时打开。

| Skill | 什么时候读 |
| --- | --- |
| [mygo-app-scaffold](.claude/skills/mygo-app-scaffold/SKILL.md) | M1 建项目、加 React、环境检查、`mygo dev/generate/build/doctor` 报错。只在授权 M1 后使用 |
| [mygo-web-app](.claude/skills/mygo-web-app/SKILL.md) | Go 绑定、多窗口、打开请求队列、就绪握手、事件路由、对话框、自定义协议、外链、快捷键、外观、单实例、构建验证。本项目最常用 |
| ↳ `references/desktop-integration.md` | 窗口注册表、打开请求队列、协议处理、导航拦截、启动恢复、文件监听 |
| ↳ `references/bindings-and-channels.md` | 绑定服务清单、契约与错误码、扫描结果分批推送、取消与迟到结果 |
| ↳ `references/frontend-transport.md` | transport 层、窗口 reducer、错误文案映射、快捷键模块、布局 |
| ↳ `references/build-and-verify.md` | 命令、配置契约、发版、真实窗口验收清单 |
| [go-service-engineering](.claude/skills/go-service-engineering/SKILL.md) | `internal/` 下的 Go 代码：分包、ctx 取消、路径授权、目录扫描、文档读取、元数据原子写入、测试 |
| [markdown-render-pipeline](.claude/skills/markdown-render-pipeline/SKILL.md) | 渲染管线、公式、Mermaid、代码高亮、链接图片改写、HTML 清理、CSP、查找、阅读位置 |
| [design-tokens](.claude/skills/design-tokens/SKILL.md) | 界面样式、颜色、主题、深色模式、图标、新增令牌、对比度校验 |

原件（来自 Mile AI Search 项目）归档在 `E:\Agent-skills\_archives\mile-typora-original-skills-20261116\`。改写后的 skill 若沉淀出可泛化的经验，按全局规范 §7 同步到 `E:\Agent-skills` 对应分类。

### 4.2 全局 skills

路径：`~/.claude/skills/`。本项目常用：

| 场景 | Skill |
| --- | --- |
| 任何 bug、测试失败，先定位根因 | `diagnose` |
| 声称完成前 | `verification-before-completion` |
| 中文、乱码、编码 | `windows-utf8-enforcement` |
| 多步任务先写计划 | `writing-plans`、`executing-plans` |
| 写实现代码 | `test-driven-development` |
| 界面视觉、深色模式 | `ui-ux-pro-max`、`frontend-design`、`dark-mode-design`（与 DESIGN.md 冲突时以 DESIGN.md 为准） |
| 审 PRD | `prd-self-check-skill-main` |
| 页面自动化走查（仅用户明确要求时） | `webapp-testing` |

### 4.3 全量技能仓库（兜底）

`E:\Agent-skills`。同一问题试 2–3 次无解或遇到不熟的能力时来查，先读 `AGENT_GUIDE.md`。相关分类：`go/`（`go-concurrency`、`go-error-handling`、`go-io-network-time`、`go-dev-guidelines`）、`react/`（`react-best-practices`、`composition-patterns`）、`testing/`（`regression-testing`）、`web-frontend-design/`（`contrast-accessibility`、`fixing-accessibility`）。需要时整目录复制到 `.claude/skills/` 并更新 §4.1。

## 5. 架构约束（PRD 第 9 节）

1. 一个进程管理多个原生窗口；单实例锁是 `main` 的第一个 mygo 调用。
2. 每个窗口有独立上下文（模式、目录根、授权范围、当前文件、阅读位置、查找词、侧栏），以 `win.ID()` 为键；关窗时取消窗口 ctx、释放监听引用。
3. 绑定方法用 `mygo.CallerWindow(ctx)` 定位窗口，**不信任前端传来的窗口 ID 或绝对路径**；前端只传相对路径或 token。
4. 打开请求进每窗口有界 FIFO 队列，页面 `Ready()` 后按序投递；队列满时提示，不静默丢弃。
5. 扫描、读取不阻塞主线程；快速切换用 `requestId` 丢弃迟到结果。
6. 路径在 Go 侧规范化、解析真实路径、逐级检查重解析点（Go 1.23 起 `EvalSymlinks` 不解析目录联接）、用 `filepath.Rel` 判断范围，不用字符串前缀判断。
7. 元数据由单一 store 原子写入应用数据目录（`mygo.App.Path(mygo.PathUserData)`），永远不写用户文档目录；配置损坏时保留原文件。
8. 前端组件不直接 import `src/mygo.ts`，统一经过 `src/lib/transport.ts`；mock 放 `src/mocks/`，生产构建不引用。
9. 生产包不依赖开发服务器；页面导航限制在应用来源内。
10. P1 起菜单、工具栏、快捷键调用同一命令。

## 6. 安全与容量红线

- 原始 HTML 转义成文本展示；输出经 bluemonday 白名单清理。
- 禁止 `javascript:`、`data:`、`file:` 及自定义协议链接；禁止脚本、事件属性、iframe、用户 SVG。
- 远程图片不请求；外部 HTTP(S) 链接确认后交系统浏览器。
- 本地图片只经 `mtres` 协议，按文件头只放行 PNG、JPEG、GIF、WebP；URL 只解码一次。
- KaTeX `trust: false`、`maxExpand: 1000`；Mermaid `securityLevel: "strict"`、六种图类型白名单、拒绝 `%%{init}%%`，SVG 经 DOMPurify。
- 生产 CSP 禁止内联脚本（防白闪脚本用独立文件）。
- 错误信息和日志不含正文与未授权路径。
- 容量（PRD 8.3 建议值）：单文件 10 MiB；单图 20 MiB / 2500 万像素；目录 5 万条目或 1 万份 Markdown、深度 64；渲染 8 秒；单公式 16 KiB、单 Mermaid 64 KiB / 3 秒；每文档前 200 个公式、20 个图表。超限明确提示。

## 7. 编码与文件格式

- 源码、文档 UTF-8 无 BOM；含中文的 `.ps1` 带 BOM。
- 读取用户文档：只接受 UTF-8（含 BOM），兼容 CRLF/LF；非法 UTF-8 报错提示转换。
- 测试样本覆盖中文文件名、空格路径、URL 编码字符。

## 8. 开发与验证

```bash
bun run dev            # mygo dev，原生窗口 + Vite 5273
bun run generate       # 改绑定后重新生成 src/mygo.ts
go vet ./...
go test ./...
go test -race ./internal/...
bun run typecheck
bunx vitest run
bun run build:web
bun run build          # mygo build，产物在 build/
```

- 没有证据不算完成：至少给出编译输出、测试结果或真实窗口截图之一。
- **构建通过不等于原生验收通过。** 多窗口、焦点、DPI、对话框、深浅外观、分发包必须在真实 Windows 11 窗口验证，汇报时分开写"自动验证"和"原生验收"。验收清单见 `mygo-web-app/references/build-and-verify.md` §4 与 PRD 12.1。
- 只读保证用文件哈希对比证明（AC-21）。取消、迟到结果、订阅释放用日志计数证明。
- 性能数值（PRD 8.2）尚未实测，不能写成"已达到"。

原生验收（工具看不到原生窗口时）：
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-windows.ps1 -Action count` 列出进程的可见窗口；`-Action close -Count N` 关窗
- 要读窗口里的页面，先手动启动带调试端口的应用：`MYGO_DEV=1 MYGO_DEV_URL=http://localhost:5273 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 ".mygo/dev/windows-amd64/Mile Typora Dev.exe"`，再用 `node scripts/native-eval.mjs "表达式"`（此时需先 `bun run dev:web` 提供 5273 的前端）
- 系统文件对话框无法可靠脚本化（DirectUI + 前台焦点限制），涉及对话框的验收请用户点一次，再用 `native-eval.mjs` 读结果（decisions.md D-T17）
- 两者只用于开发期验收，不进入构建产物（decisions.md D-T16）

设计稿预览：`.claude/launch.json` 的 `design-draft` 配置（端口 8765），打开 `/mile-typora-design.html`。`web-shell` 配置在浏览器里打开前端外壳（端口 5274）。浏览器里没有 mygo 运行时，状态栏会显示连接失败，这是预期结果，只用来看布局和主题。

## 9. 界面约束

以 DESIGN.md 为准，要点：

- 三栏 + 工具栏 + 状态栏，整窗无纵向滚动条，各区独立滚动。
- 正文居中，最大宽度 860，中文 16px / 1.75。
- 唯一强调色蓝；页面元素无阴影，只有浮层有阴影。
- P0 开放浅色、深色、跟随系统三种外观（PRD C-12、FR-10.12、AC-29）；两套令牌都以 DESIGN.md 为准。
- 图标只用 lucide-react；状态同时有图标和文字；可见焦点。
- 应用图标由 [docs/images/深色背景上的橙角MT文档图标.png](docs/images/深色背景上的橙角MT文档图标.png) 经 `scripts/make-icons.py` 生成到 `resources/` 与 `public/`，不手改 PNG（DESIGN.md §7.1）。
- 右侧预留栏不放聊天框、模型选择、假数据；未交付功能不出现在界面上。

## 10. 文档约定

| 文档 | 用途 | 何时更新 |
| --- | --- | --- |
| `docs/PRD.md` | 需求权威来源 | 用户评审改动后；改建议默认项要同步需求、异常规则和验收条目 |
| `PRODUCT.md` | 产品概览 | PRD 版本变化时 |
| `DESIGN.md` | 设计令牌与组件规范 | 改视觉前先改这里，同步 `tokens.css` 与设计稿 |
| `docs/decisions.md` | 技术与产品决策 | 选型、版本、重要取舍变化时新增条目 |
| `docs/开发计划.md` | 小阶段拆分、门禁、进度 | 每完成一个小阶段更新进度表；拆分阶段时登记 |
| `docs/develop/接口契约.md` | 绑定方法、事件、错误码清单 | 改绑定时同步 |
| `docs/踩坑记录.md` | 踩坑沉淀 | 做收尾工作时 |
| `CLAUDE.md` | AI 项目说明 | 技术栈、目录结构、skills 变化时 |

发现文档与代码不一致时以代码为准，并在文档里标注漂移。
