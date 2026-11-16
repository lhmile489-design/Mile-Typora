---
name: markdown-render-pipeline
description: Mile Typora 的 Markdown 渲染与阅读交互：Go 侧 goldmark（CommonMark + GFM）解析、公式与 Mermaid 定界保留、YAML front matter、chroma 代码高亮、原始 HTML 转义、中文标题锚点、链接与图片改写、bluemonday 清理；前端 KaTeX 与 Mermaid 严格模式渲染、DOMPurify 清理 SVG、局部降级与容量上限、文内查找（CSS Custom Highlight API）、阅读位置恢复。只要在改渲染、公式、图表、代码高亮、链接图片处理、查找、滚动位置，或排查"某段渲染不对 / 有安全问题"，都应加载本 skill。
---

# markdown-render-pipeline

PRD 依据：FR-04、FR-05、FR-06、FR-07、8.3。依赖版本见 `docs/decisions.md`（2026-11-16 查询的最新稳定版，M1 用 `go.mod` / `bun.lock` 锁定）。

## 1. 何时加载 / 不加载

- 加载：改 `internal/markdown/`、`src/render/`、查找、阅读位置；渲染结果不对或疑似安全问题。
- 不加载：窗口、绑定、事件（`mygo-web-app`）；路径授权与文件读取（`go-service-engineering`）；颜色字号（`design-tokens`）。

## 2. 分工：谁做什么

```text
Go（internal/markdown）                         前端（src/render）
读取 -> goldmark 解析 -> 自定义渲染器              dangerouslySetInnerHTML 注入已清理 HTML
  公式：保留源码到 data 属性                        KaTeX 渲染 .math 节点
  Mermaid：保留源码到 <pre>                         按需加载 mermaid，严格模式渲染 + DOMPurify
  代码：chroma 输出 class                          复制按钮、查找、锚点、阅读位置
  链接 / 图片：分类与改写                           拦截链接点击 -> LinkService
-> bluemonday 白名单清理 -> 返回 HTML + 元信息
```

理由：HTML 解析与清理放在 Go，前端拿到的永远是白名单内的标签；公式和图表需要浏览器排版，放前端。前端不再解析 Markdown。

## 3. Go 侧管线

### 3.1 依赖

| 用途 | 包 |
| --- | --- |
| 解析 | `github.com/yuin/goldmark` v1.8.7 |
| GFM | goldmark 自带 `extension.GFM`（表格、删除线、任务列表、自动链接） |
| 公式定界 | `github.com/gohugoio/hugo-goldmark-extensions/passthrough` v0.6.0 |
| front matter | `go.abhg.dev/goldmark/frontmatter` v0.3.0 |
| 代码高亮 | `github.com/alecthomas/chroma/v2` v2.27.0（直接调用，不用 goldmark-highlighting，后者只有 2023 年的伪版本） |
| HTML 清理 | `github.com/microcosm-cc/bluemonday` v1.0.27 |

### 3.2 解析器配置

```go
md := goldmark.New(
    goldmark.WithExtensions(
        extension.GFM,
        &frontmatter.Extender{},   // 只解析开头合法的 YAML，不执行
        passthrough.New(passthrough.Config{
            InlineDelimiters: []passthrough.Delimiters{{Open: "$", Close: "$"}, {Open: `\(`, Close: `\)`}},
            BlockDelimiters:  []passthrough.Delimiters{{Open: "$$", Close: "$$"}, {Open: `\[`, Close: `\]`}},
        }),
    ),
    goldmark.WithParserOptions(
        parser.WithAutoHeadingID(),
        parser.WithIDs(newCJKIDs()), // 见 3.4
    ),
    goldmark.WithRendererOptions(
        renderer.WithNodeRenderers(util.Prioritized(&readerRenderer{}, 100)), // 见 3.3
        // 不加 html.WithUnsafe()
    ),
)
```

- passthrough 让定界符内的内容不被 Markdown 解析（`_`、`*` 不变成强调），代码块和行内代码里的 `$` 不受影响；转义的 `\$` 不作为定界符。AC-23 的用例都要写成测试。
- 解析前把 CRLF 统一成 LF；读取层已经去掉 BOM。

### 3.3 自定义渲染器（`readerRenderer`）

| 节点 | 输出 |
| --- | --- |
| `ast.HTMLBlock`、`ast.RawHTML` | **转义后的原文**（`<pre class="raw-html">` 或行内 `<code class="raw-html">`）。goldmark 默认输出 `<!-- raw HTML omitted -->`，不符合 PRD FR-04"以转义后的文本展示" |
| passthrough 行内 / 块 | `<span class="math" data-display="false">转义后的 TeX</span>`、`<div class="math" data-display="true">…</div>`；超过 16 KiB 直接输出降级块 |
| 围栏代码块 `mermaid` | `<pre class="mermaid-src">转义后的源码</pre>`；超过 64 KiB 或超过每文档 20 个，输出降级块并标注原因 |
| 其他围栏代码块 | chroma `html.WithClasses(true)` 输出 class，外层 `<div class="code" data-lang="go">`；未知语言按纯文本；chroma 的 class 在 `markdown.css` 映射到 `--syn-*` 令牌 |
| front matter | `<details class="fm"><summary>元信息 · N 项</summary><pre>转义后的 YAML</pre></details>` |
| 任务列表复选框 | `<input type="checkbox" disabled>`，前端再设 `aria-readonly` |
| 链接 | 见 3.5 |
| 图片 | 见 3.6 |

每文档公式超过 200 个时，第 201 个起输出源码并标注超限（PRD 8.3）。计数在渲染器里做，不要到前端才截断。

### 3.4 中文标题锚点

goldmark 默认的 ID 生成器（`parser/parser.go` 中 `ids.Generate`）**丢弃所有非 ASCII 字符**，中文标题全部变成 `heading`、`heading-1`。自定义实现：

- 保留 Unicode 字母和数字（`unicode.IsLetter` / `IsNumber`），英文转小写，空白和 `-`、`_` 转为 `-`，其余去掉。
- 重复标题追加 `-1`、`-2`，规则稳定（同一文档每次渲染结果相同）。
- 链接 `#安装步骤` 先 `url.PathUnescape` 再匹配。
- 单测：中文、中英混合、全是标点、重复标题、emoji。

### 3.5 链接分类

渲染时给每个 `<a>` 加 `data-kind`，真正的授权在点击时由 `LinkService.ResolveLink` 再做一次：

| href | data-kind | 点击行为 |
| --- | --- | --- |
| `#xxx` | `anchor` | 当前窗口滚动 |
| 相对 `.md` / `.markdown` | `doc` | 交给 `ResolveLink`，按 FR-06.2–4 处理 |
| `http:` / `https:` | `external` | 确认后系统浏览器打开 |
| 其他相对路径 | `attachment` | 提示"暂不支持打开此类附件" |
| `javascript:`、`data:`、`file:`、`vbscript:`、自定义协议 | 去掉 `href`，加 `data-kind="blocked"` | 不可点击 |

### 3.6 图片改写

- 相对路径：按 `go-service-engineering` §4 校验，通过则登记 token，`src` 改为 `mtres://localhost/<token>`（WebView2 下 `http://mtres.localhost/<token>`，由前端常量决定）。
- 远程 HTTP(S)：不请求，替换成降级块"远程图片未加载"并保留 alt 和原地址文本。
- 绝对路径、UNC、越界、SVG、非白名单格式：降级块并说明原因。
- 图片解码预算（单窗口 256 MiB）在前端按需加载控制：`loading="lazy"`，离开视口很远的图片可替换回占位。

### 3.7 bluemonday 白名单

最后一步用一个**只为本项目渲染器输出设计**的白名单清理（不用 `UGCPolicy`，它比需要的宽）：

- 元素：`p h1-h6 a strong em del code pre blockquote ul ol li table thead tbody tr th td hr br img span div details summary input`。
- 属性：`a[href data-kind]`、`img[src alt title]`、`h1-h6[id]`、`span/div[class data-display data-lang]`、`input[type=checkbox disabled checked]`、`th/td[align]`、`ol[start]`。
- URL 协议：`http`、`https`、`mtres`，以及相对地址和 `#`。
- 禁止一切 `on*`、`style`、`iframe`、`object`、`embed`、`svg`、`script`。

清理后的 HTML 才返回前端。渲染器的单测直接断言"清理前后一致"，若不一致说明渲染器产出了白名单外的东西。

### 3.8 超时与取消

- 整体渲染从调用 ctx 派生 8 秒超时（PRD 8.3）。goldmark 本身不接受 ctx：把渲染放进 goroutine，主调用 `select` 等结果或超时；超时返回 `render_timeout`，后台 goroutine 跑完即被丢弃。M1 用病态输入（深层嵌套列表、超长表格）测是否需要额外的输入预检。
- 返回结果带 `requestId`、`hasMath`、`hasMermaid`、`limits`（超限计数）、`lineEnding`、`hasBOM`。

## 4. 前端渲染

### 4.1 依赖

| 用途 | 包 |
| --- | --- |
| 公式 | `katex` 0.19.1（字体随包，Vite 打进产物） |
| 图表 | `mermaid` 12.3.0，**动态 import**，只有 `hasMermaid` 时才加载 |
| SVG 清理 | `dompurify` 3.4.18（`USE_PROFILES: { svg: true, svgFilters: true }`） |

### 4.2 KaTeX

```ts
katex.render(tex, el, {
  displayMode,
  throwOnError: true,   // 捕获后显示降级块和错误原因
  trust: false,         // 不允许 \href、\includegraphics 等
  strict: "warn",
  maxSize: 50,
  maxExpand: 1000,      // 防宏展开炸弹
  output: "htmlAndMathml",
});
```

- 不传 `macros`，不允许用户自定义全局宏。
- 错误时降级块显示 `ParseError` 的消息和原 TeX（DESIGN.md §8.6）。

### 4.3 Mermaid

```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: fromTokens(),     // DESIGN.md §2.5 的 --diagram-*，切换主题后重新渲染
  flowchart: { htmlLabels: false }, // 不用 foreignObject 里的 HTML
  maxTextSize: 65536,
});
```

- 只渲染六种图：先取源码第一行的图类型关键字（`flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt`），不在名单内直接降级为"不支持的图表类型"，不交给 mermaid。
- 去掉源码里的 `%%{init: ...}%%` 指令，或检测到就降级：PRD 要求不接受文档内指令修改配置。mermaid 12 对 init 指令的具体处理以源码为准，M1 验证。
- `mermaid.render(id, src)` 外包 3 秒超时（`Promise.race`），超时降级。mermaid 部分计算是同步的，超时只能保证界面回退，不能真正中断；M1 要测病态图会不会卡住主线程，必要时改到 Worker 预检。
- 拿到的 SVG 字符串先过 DOMPurify，再插入。
- 每个图块独立 try/catch，一个失败不影响其他（AC-25）。

### 4.4 注入顺序

1. `article.innerHTML = html`（已清理）。
2. 恢复阅读位置（4.6）。
3. 渲染视口内的公式和图表，其余用 `IntersectionObserver` 进入视口前 1 屏时再渲染，避免 1 MiB 文档一次性卡顿。
4. 渲染完成后若高度变化，按锚点再校正一次滚动位置。

### 4.5 文内查找（PRD FR-05）

- 用 `TreeWalker` 收集正文文本节点（跳过 `.katex`、`svg`、`.mermaid-src` 隐藏源码），构建字面匹配，不区分英文大小写（`toLocaleLowerCase` 对齐长度后比较）。
- 用 CSS Custom Highlight API 画命中：`CSS.highlights.set("find", new Highlight(...ranges))`，当前命中单独一个 `find-current`。不改 DOM，切换文件时 `CSS.highlights.clear()`。
- 查找提示里说明"公式、图表内部不参与查找"（PRD FR-05.7）。

### 4.6 阅读位置

- 记录：最近经过的标题 id + 相对该标题的偏移比例，再加整体滚动比例作为兜底。
- 恢复：先找标题 id，找不到用比例，结果夹在有效范围内（PRD FR-07.3）。
- 每个窗口在自己的 state 里按文件保存；跨重启只为恢复目标保存近似位置（PRD FR-08.5）。

## 5. CSP

生产构建的 `index.html` 加：

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' http://mtres.localhost; font-src 'self'; connect-src 'self';
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'
```

- `style-src 'unsafe-inline'` 是 KaTeX 和 mermaid 的内联样式需要；脚本不允许内联，防白闪脚本改成独立的 `theme-init.js`。
- 开发期 Vite 需要更宽的策略，CSP 只在构建时注入（Vite 插件 `transformIndexHtml`，`apply: "build"`）。
- 应用来源在 Windows 上是 `http://mygo.localhost`，`'self'` 即指它；M1 在真实窗口确认。

## 6. 测试

- Go：表驱动测试覆盖 AC-09、AC-23、AC-15 的样本；每个降级分支至少一个用例；渲染器输出过 bluemonday 前后一致；`go test -fuzz` 对渲染入口做模糊测试，断言不 panic、输出不含 `<script`、`on\w+=`、`javascript:`。
- 前端：Vitest + jsdom 测查找、阅读位置计算、Mermaid 图类型判断、KaTeX 错误降级（KaTeX 可在 jsdom 运行；mermaid 需要真实布局，放到真实窗口验收）。
- 恶意样本集放 `testdata/malicious/`，每次改渲染都要跑。

## 7. 交付前自检

- [ ] 原始 HTML 显示为转义文本，没有被丢弃也没有被执行
- [ ] 中文标题有可用锚点，重复标题可区分
- [ ] 公式、图表的数量和大小上限在 Go 侧生效，超限逐项标注
- [ ] 输出过白名单清理，单测断言清理前后一致
- [ ] KaTeX `trust: false`、`maxExpand` 已设；Mermaid `securityLevel: "strict"`、图类型白名单、init 指令被拒绝
- [ ] Mermaid SVG 经 DOMPurify 后插入；切换主题后重新渲染
- [ ] 远程图片不请求；本地图片只经 `mtres` 协议
- [ ] 查找不改 DOM，切换文件清空
- [ ] 生产 CSP 已注入且没有内联脚本
