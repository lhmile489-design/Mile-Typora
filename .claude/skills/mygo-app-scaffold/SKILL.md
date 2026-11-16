---
name: mygo-app-scaffold
description: 在 Windows 11 上为 Mile Typora 创建并跑通 egoist/mygo v0.9.0 的 web 模板项目，并叠加 React 19 与本项目依赖。用于 mygo init、环境检查（Go 1.27.3、Bun、WebView2、mygo CLI）、mygo.config.ts / vite.config.ts / package.json 配置、加 React、生成 src/mygo.ts、resources/icon.png、mygo dev|build|doctor 报错，以及"no required module provides package github.com/egoist/mygo"一类依赖问题。只在用户授权进入 M1 写代码后使用。
---

# mygo-app-scaffold（Mile Typora 版）

原版针对 v0.8.3 和 Bento 示例项目，已按 v0.9.0 源码和本项目 PRD 改写；原件归档在 `E:\Agent-skills\_archives\mile-typora-original-skills-20261116\`。

## 0. 铁律

1. **项目仍在 M0 时不要执行本 skill。** PRD C-08 要求先只交付文档，用户明确授权 M1 后才建项目。
2. **不凭记忆手写模板。** 权威模板在 `C:\Users\LHmile\go\pkg\mod\github.com\egoist\mygo@v0.9.0\cmd\mygo\template\web\`，由 `cmd/mygo/init.go` 嵌入。`*.tmpl` 是 Go template，变量见 `templateData`。能用 `mygo init` 就用，不能用才逐字照抄模板。
3. 模板生成的字段是运行期契约：`mygo.config.ts` 的 `devUrl/devCommand/buildCommand/frontendDist/bindings/out`、`package.json` 的 `mygo-runtime` / `mygo-cli` 版本、`vite.config.ts` 的 `strictPort`。叠加 React 时只增不改。

## 1. 环境前置检查

| 依赖 | 验证 | 本机实测（2026-11-16） |
| --- | --- | --- |
| Go ≥ 1.27 | `go version` | go1.27.3 windows/amd64 |
| Bun | `bun --version` | 1.3.13 |
| WebView2 | Windows 11 自带 | — |
| mygo CLI v0.9.0 | `go install github.com/egoist/mygo/cmd/mygo@v0.9.0`，然后 `mygo doctor` | GOPATH 下已有 v0.8.3 与 v0.9.0 源码；CLI 版本未确认，执行前先 `mygo --version` |

npm 上 `mygo-runtime` 与 `mygo-cli` 当前为 0.9.1（2026-11-16 `npm view`）。以 `mygo init` 写入的版本为准，不手动升到别的版本。

## 2. 创建项目

仓库根目录已有 `docs/`、`.claude/`、`CLAUDE.md` 等文件，`mygo init` 可能拒绝非空目录。做法：

1. 在临时目录 `mygo init mile-typora`，确认生成的文件清单。
2. 逐个复制到仓库根（不覆盖已有文件；`.gitignore` 合并，不替换）。
3. 模板 v0.9.0 web 的文件：`gitignore.tmpl`、`index.html.tmpl`、`main.go.tmpl`、`mygo.config.ts.tmpl`、`package.json.tmpl`、`tsconfig.json`、`vite.config.ts`、`src/main.ts`、`src/style.css`。
4. 之后：`go mod tidy` → `bun install` → `mygo generate` → `mygo dev`。

`identifier` 建议 `dev.mile.typora`，定稿后不再改（决定应用数据目录与单实例锁）。

## 3. 叠加 React 与本项目依赖

依赖版本见 `docs/decisions.md` 的选型表；`bun add` 时写确切版本，生成 `bun.lock` 后提交。

```bash
bun add react react-dom katex mermaid dompurify lucide-react @tanstack/react-virtual
bun add -d @vitejs/plugin-react @types/react @types/react-dom vitest @testing-library/react jsdom
```

- `vite.config.ts`：在模板配置上加 `plugins: [react()]`，保留 `server.port`、`strictPort: true`、`watch.ignored`。端口若与其他项目冲突，换一个固定端口，`mygo.config.ts` 的 `devUrl` 同改。
- `tsconfig.json`：加 `"jsx": "react-jsx"`，其余保留模板值（TypeScript ^7）。
- 把模板的 `src/main.ts` 换成 `src/main.tsx`，`index.html` 的入口同改；`src/style.css` 替换为 `src/styles/tokens.css` + `markdown.css`（见 `design-tokens`）。
- Go 依赖：`go get github.com/yuin/goldmark@v1.8.7 github.com/gohugoio/hugo-goldmark-extensions/passthrough@v0.6.0 go.abhg.dev/goldmark/frontmatter@v0.3.0 github.com/alecthomas/chroma/v2@v2.27.0 github.com/microcosm-cc/bluemonday@v1.0.27`。

## 4. 建议目录

```text
Mile-Typora/
├── main.go                 启动顺序：单实例 -> 协议 -> 外观 -> Bind -> WhenReady -> Run
├── internal/               见 go-service-engineering §2
├── src/                    前端（以 mygo init 实际结构为准）
│   ├── mygo.ts             生成物，不手改
│   ├── main.tsx
│   ├── app/                窗口根组件、store、快捷键
│   ├── components/         工具栏、文件树、正文、查找条、对话框
│   ├── render/             KaTeX、Mermaid、查找、阅读位置
│   ├── lib/transport.ts    唯一调用 src/mygo.ts 的模块
│   ├── mocks/              仅开发期
│   └── styles/             tokens.css、markdown.css
├── public/theme-init.js    防白闪（CSP 不允许内联脚本）
├── resources/icon.png      1024 × 1024 带透明通道
├── testdata/               渲染与安全样本
├── mygo.config.ts
└── vite.config.ts
```

## 5. 绑定契约

- `main.go` 里 `mygo.Bind(...)` 的导出方法经 `mygo generate` 写成 `src/mygo.ts` 的 `Service.method(...)`，返回 `Promise<T>`；`*mygo.Channel[T]` 参数变成 `Channel<T>`；`mygo.NewEvent[T]("name")` 变成 `events.name.on/once`。
- `generate` 报 `no required module provides package github.com/egoist/mygo`：先 `go mod tidy`。
- 页面加载 `URL: "/"`：开发期是 `devUrl`，构建后 Windows 上是 `http://mygo.localhost`。

## 6. Windows 执行要点

- bash 里找不到 `go`：`export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`。
- `mygo dev` 依赖 `bun` 在 PATH（`devCommand` 是 `bun run dev:web`）。
- `mygo build` 产物在 `build/windows-amd64/`；NSIS 首次需联网下载。
- 复制 PNG 等二进制用 `cp` / `Copy-Item`，不用文本写入工具。
- 本机测试用 `bunx vitest run`，不用 `bun run test`。

## 7. 跑通判定

- `mygo doctor` 全绿。
- `mygo dev` 弹出窗口，React 根组件渲染出三栏骨架，控制台无报错。
- 一个最小绑定（例如 `WindowService.Ready`）能从页面调用并返回。
- `go test ./...`、`bun run typecheck` 通过。
- 汇报时附命令输出或窗口截图，"弹窗正常"不能只凭构建成功判断。
