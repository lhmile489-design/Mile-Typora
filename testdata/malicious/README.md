# testdata/malicious

恶意与边界样本，供 `internal/markdown` 与渲染管线回归。每次改渲染器或白名单都要重跑这里的所有文件。

| 文件 | 针对什么 |
| --- | --- |
| `html.md` | 脚本、事件属性、iframe、内联样式、用户 SVG 写在正文里 |
| `protocol.md` | `javascript:`、`data:`、`file:`、`vbscript:`、自定义协议，以及 data 图片 |
| `svg.md` + `icon.svg` | 内联 SVG 带脚本与 onload；SVG 作为图片引用（协议层按文件头拒绝） |
| `mermaid-init.md` | `%%{init}%%` 改配置，以及 `click` 回调 |
| `math-escape.md` | KaTeX 的 `\href`、`\includegraphics` 与宏递归 |

断言方式：`internal/markdown/render_test.go` 的 `TestMaliciousSamples` 逐份渲染，用 token 流检查没有危险元素、事件属性、`style` 与危险协议；图片一律被解析器拦下。
