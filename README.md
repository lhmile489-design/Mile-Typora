# Mile Typora

Windows 11 上的本地 Markdown 阅读器。P0 只读：打开单个文件或目录，原生多窗口，公式、图表与代码高亮全部离线渲染。所有行为以 [docs/PRD.md](docs/PRD.md) 为准。

## 功能（P0）

- 打开 `.md` / `.markdown`（大小写均可），单文件或目录文件树。
- 一个进程多个原生窗口；空白窗口就地打开，非空白窗口把新文件交给新窗口。
- CommonMark + GFM：标题、列表、表格、任务列表、引用、代码高亮、front matter。
- KaTeX 公式与 Mermaid 图表，按需加载、局部降级，失败不影响正文其余部分。
- 外部修改自动刷新（多窗口共享监听），删除或根目录消失时保留旧内容并标过期。
- 文内查找、阅读位置恢复、最近打开、启动恢复、浅色 / 深色 / 跟随系统。
- 只读保证：不修改源文件；本地图片经应用内 `mtres` 协议按文件头与容量校验后提供。
- 不发起远程请求；外部链接确认后交系统浏览器。

## 运行要求

- Windows 11 x64。
- Microsoft Edge WebView2 Runtime。缺失时应用启动会提示安装地址，不会停在白屏。
- 不需要管理员权限即可阅读；安装包由 mygo 的 NSIS 向导生成。

## 安装与启动

- 安装包：`build/windows-amd64/mile-typora-setup-<版本>-amd64.exe`。
- 免安装运行：`build/windows-amd64/Mile Typora.exe`。
- 首次启动是空白页；可在“设置 → 常规 → 启动时”选择恢复上一份文档或打开空白页。

应用数据保存在 `%APPDATA%\Mile Typora\settings.json`（最近记录、启动与外观偏好、恢复目标），不会写入文档目录。

## 快捷键

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开目录 |
| `Ctrl+Shift+N` | 新建窗口 |
| `Ctrl+F` | 当前文档查找 |
| `F5` | 刷新当前阅读上下文 |
| `Ctrl+W` | 关闭当前窗口 |
| `Ctrl+,` | 设置 |
| `Ctrl+Shift+L` | 显示 / 隐藏左侧栏 |
| `Esc` | 关闭查找条或临时提示 |
| `Ctrl+S` | P0 不保存，提示“当前版本仅支持阅读” |

## 从源码构建

需要 Go 1.27.3、Bun 1.3、WebView2 Runtime。

```bash
bun install
bun run generate        # 生成 src/mygo.ts（改绑定后）
bun run dev             # 开发窗口 + Vite（5273）
bun run build           # 正式包与安装包，产物在 build/
```

验证：

```bash
go vet ./...
go test ./...
go test -run '^$' -bench . -benchmem ./internal/scan ./internal/markdown
bun run typecheck
bunx vitest run
bun run build:web
```

`go test -race` 在本机因缺少 gcc 不可用（decisions.md D-T14）；并发正确性用专项测试覆盖。

## 文档

- [docs/PRD.md](docs/PRD.md)：需求与验收条目。
- [docs/develop/接口契约.md](docs/develop/接口契约.md)：前端与 Go 的绑定、事件、错误码。
- [docs/develop/性能基线.md](docs/develop/性能基线.md)：本机实测与未测项。
- [docs/develop/P0-验收记录.md](docs/develop/P0-验收记录.md)：AC-01 至 AC-29 的验收结果。
- [docs/decisions.md](docs/decisions.md)：技术与产品决策。
- [DESIGN.md](DESIGN.md)：设计令牌与组件规范。

## P0 边界

- 不编辑、不保存、不新建文档；右侧预留栏只占位。
- 不支持导航到不支持的类型或外部页面；PDF、图片查看器等不在范围内。
- 大目录（超过扫描边界）会提示结果不完整；超出目录监听上限时用 `F5` 手动刷新。
- 远程图片不加载；本地图片格式限 PNG / JPEG / GIF / WebP。
