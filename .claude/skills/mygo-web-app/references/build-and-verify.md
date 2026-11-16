# 构建、发版与验证（Mile Typora，mygo v0.9.0）

## 目录

1. 命令速查
2. 配置契约
3. 发版流程
4. 真实窗口验收清单
5. 自动化走查
6. 踩坑速查

## 1. 命令速查

```bash
mygo doctor                 # 环境自检（Go 1.27.3、Bun、WebView2）
mygo dev                    # 起 Vite + 窗口，监听 Go 变化重编
mygo dev -background        # v0.9.0 新增：窗口不抢焦点，适合边写边看
mygo generate               # 重新生成 src/mygo.ts
mygo build                  # 安装包 + exe（NSIS 首次联网下载）
mygo build -skip-installer  # 只出 exe，会清空输出目录
go test ./...
go test -race ./internal/...
go vet ./...
bun run typecheck
bunx vitest run
```

bash 里找不到 `go` 时：`export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`。

## 2. 配置契约

v0.9.0 web 模板（`cmd/mygo/template/web/`）生成的字段：

| 文件 | 字段 |
| --- | --- |
| `mygo.config.ts` | `name`、`identifier`、`version`、`devUrl: "http://localhost:5173"`、`devCommand: "bun run dev:web"`、`buildCommand: "bun run build:web"`、`frontendDist: "dist"`、`bindings: "src/mygo.ts"`、`out: "build"` |
| `vite.config.ts` | `server.port: 5173`、`strictPort: true`、`watch.ignored: ["**/.mygo/**", "**/build/**"]` |
| `package.json` | `mygo-runtime`（dependencies）、`mygo-cli`、`typescript ^7`、`vite ^8`；脚本 `dev`、`build`、`generate`、`dev:web`、`build:web`、`typecheck` |

- 本项目把前端放在 `frontend/` 还是根目录，以 `mygo init` 的实际结构为准，不擅自挪动后再手改配置。
- 加 React 时在模板基础上增加 `react`、`react-dom`、`@vitejs/plugin-react`，不替换模板已有字段。
- 5173 常被其他项目占用：换一个固定端口，`devUrl` 和 `vite.config.ts` 同改。
- `identifier` 定稿后不要改，它决定应用数据目录和单实例锁。建议 `dev.mile.typora`（M1 确认）。

## 3. 发版流程

1. 改 `mygo.config.ts` 的 `version`；如果 Go 里有版本常量（"关于"页），同步改并加一个比对测试。
2. 跑全：`go test ./...`、`go vet ./...`、`bun run typecheck`、`bunx vitest run`。
3. 构建后 grep `dist/` 确认没有 `src/mocks/` 内容、没有 `http://` / `https://` 的 CDN 引用（PRD 8.1 离线）。
4. `mygo build`；需要免安装 exe 时，先备份安装包再 `-skip-installer`。
5. 记录产物大小与 SHA-256，写入发版记录。安装包体积基线在 M1 建立（PRD 8.2 末段）。
6. 图标 `resources/icon.png` 用 1024 × 1024 带透明通道 PNG；复制二进制用 `cp` / `Copy-Item`。

## 4. 真实窗口验收清单

自动测试覆盖不到原生行为。下面每项都在真实 Windows 11 上用**分发包**验收（PRD 12.2）：

| 项 | 怎么验 | PRD |
| --- | --- | --- |
| 多窗口 | A、B、A 三窗口各停在不同段落，逐个关闭互不影响；最后一个关闭后进程退出 | AC-03、AC-04 |
| 10 窗口 | 同时打开 10 个 100 KiB 文档，连续切换、滚动、关闭 | AC-04、8.2 |
| 窗口矩阵 | 空白窗口复用、非空白新开、显式新开不去重 | AC-02 |
| 对话框 | 取消选择不改变任何状态；中文、空格路径 | AC-01、AC-08 |
| 外部修改 | 记事本保存、VS Code 原子替换保存，两个窗口同时更新 | AC-11 |
| 删除与断开 | 外部删除当前文件、移除根目录 | AC-12 |
| 安全 | 恶意样本：HTML 脚本、`javascript:` 链接、远程图片、用户 SVG、越界图片、联接、Mermaid 回调 | AC-14、AC-15、AC-25 |
| 离线 | 断网打开公式与六种 Mermaid 图表 | AC-16 |
| 快捷键 | F5 刷新而非重载页面；Ctrl+P 无打印；Ctrl+S 只提示；F12 无检查器 | FR-09 |
| 外观 | 设置里切换跟随系统 / 浅色 / 深色，多窗口即时生效、阅读位置不变、Mermaid 重绘；跟随系统时切换 Windows 外观；冷启动首帧无白闪 | AC-29、DESIGN.md §1 |
| 布局 | 960 × 640；DPI 100 / 125 / 150 / 200%；宽度 < 1200 右栏收起 | AC-19 |
| 启动恢复 | 两种模式来回切换重启；恢复目标失效 | AC-26、AC-27 |
| 只读 | 全流程前后对样本目录算 SHA-256 | AC-21 |
| WebView2 缺失 | 在没有运行时的虚拟机上安装 | AC-22 |

汇报时分两栏：「自动验证通过」和「原生验收待补」，不用构建成功代替原生验收。

## 5. 自动化走查

- 启动前设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223"`，用 Playwright `connectOverCDP` 或 chrome-devtools 工具连接。多窗口时每个窗口是一个 target。
- 窗口隐藏时 PNG 截图会卡：先 `Page.bringToFront`，改用 JPEG 并加超时。
- 查实际渲染字体用 CDP `CSS.getPlatformFontsForNode`（验证 Segoe UI Variable 与微软雅黑 UI 回退），`document.fonts.check` 会误报。
- 自动化走查只在用户明确要求时执行。

## 6. 踩坑速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `mygo dev` 白屏 | Vite 换了端口，`devUrl` 仍指旧端口 | `strictPort: true`，两处同改 |
| generate 报找不到 mygo 包 | go.mod 缺 require | `go mod tidy` |
| 生产包里 F5 重载了整个页面 | `DevTools` 没设 `DevToolsDisabled` | 生产构建关掉 |
| 本地图片全部 404 | 协议在建窗后才注册，或 CSP 没放行 `http://mtres.localhost` | 建窗前 `Protocol.Handle`；CSP `img-src` 加上 |
| 新窗口收不到打开请求 | 页面未就绪时就 Emit | 走打开请求队列与 `Ready()` 握手 |
| 启动白闪 | 窗口 `BackgroundColor` 与 `--bg-app` 不一致 | `light-dark(#FFFFFF, #1C1D20)` |
| 两个进程写坏设置 | 没有单实例锁 | `RequestSingleInstanceLock` 放 `main` 第一行 |
| `bun run test` 报怪错 | 命中系统 `test` 命令 | `bunx vitest run` |
| 整窗出现滚动条 | 高度公式与外层 padding 重复占位 | 只留一次 |
