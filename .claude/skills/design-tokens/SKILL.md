---
name: design-tokens
description: Mile Typora 的设计令牌落地与维护：根目录 DESIGN.md 是唯一契约，落成 src/styles/tokens.css（:root 浅色 + [data-theme="dark"] 深色同名覆盖）与 markdown.css；深浅主题切换、防白闪、原生窗口底色、Mermaid 主题变量、chroma 高亮 class 映射、WCAG 对比度校验。只要在写或改界面样式、颜色、字号、间距、主题、深色模式、图标，或要新增令牌，都应加载本 skill。
---

# design-tokens

原版（mygo-bento-design-tokens）面向 Bento 卡片网格和 Go 原生 UI 双端，本项目只有 WebView 前端、风格是阅读器，已改写；原件归档在 `E:\Agent-skills\_archives\mile-typora-original-skills-20261116\`。

## 1. 单一来源

```text
DESIGN.md（契约，人和 AI 读）
  -> src/styles/tokens.css   全部令牌，两个块：:root（浅）与 :root[data-theme="dark"]（深）
  -> src/styles/markdown.css 正文排版，只引用令牌
  -> 组件样式（CSS Modules 或普通 CSS） 只引用令牌
  -> main.go 窗口 BackgroundColor       light-dark(--bg-app 浅, --bg-app 深)
  -> render/mermaid.ts themeVariables   运行时从令牌读取
```

设计稿 `docs/design/mile-typora-design.html` 内嵌的 `:root` 与 DESIGN.md §2–§6 一一对应，落地时可以直接复制到 `tokens.css`，删掉末尾"仅属于设计稿画布"的 `--draft-*` 变量。

## 2. 改令牌的流程

1. 先改 DESIGN.md 的表格（浅色、深色两列都要填）。
2. 涉及文字或可交互元素的颜色，重新计算 DESIGN.md §2.6 的对比度：正文和小字 ≥ 4.5，非文字界面元素（输入框描边、焦点环）≥ 3。用下面的脚本算，结果写回表格：

```bash
python -I -c "
def L(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
a,b=sorted([L('#636973'),L('#F6F6F7')],reverse=True); print(round((a+0.05)/(b+0.05),2))"
```

3. 同步 `tokens.css` 和设计稿 HTML。
4. 改了 `--bg-app` 要同步 `main.go` 的 `BackgroundColor`。

不允许在组件里"临时"写一个颜色再说。

## 3. 主题机制（DESIGN.md §1）

- 偏好三值：`system`、`light`、`dark`，存在应用设置里（Go 侧），不存 localStorage。
- 根元素始终带解析后的 `data-theme`。CSS 只写两个块，不用 `@media (prefers-color-scheme)` 写颜色，避免"跟随系统"与"手动选择"两套逻辑打架。
- 防白闪：`index.html` 引入独立的 `theme-init.js`（不能内联，CSP 禁止内联脚本），按 `prefers-color-scheme` 先写 `data-theme`；Go 在建窗前 `mygo.Theme.SetSource`，所以首帧媒体查询就正确。
- `color-scheme` 跟着 `data-theme` 切换，滚动条和原生控件随主题变化。
- 主题切换后：KaTeX 继承 `currentColor` 无需处理；Mermaid 图表 SVG 写死了颜色，要用新令牌重新渲染当前文档的图表。

## 4. 代码高亮映射

chroma 用 `html.WithClasses(true)` 输出 class（Pygments 风格短名）。`markdown.css` 把它们映射到六个 `--syn-*` 令牌：

| chroma class | 令牌 |
| --- | --- |
| `.k .kc .kd .kn .kp .kr .kt`（关键字） | `--syn-keyword`，`.kt` 用 `--syn-type` |
| `.s .s1 .s2 .sb .sc .sd .se .sh .si .sr .ss .sx` | `--syn-string` |
| `.c .c1 .cm .cp .cs .ch` | `--syn-comment`，斜体 |
| `.nf .fm` | `--syn-function` |
| `.m .mb .mf .mh .mi .mo .il` | `--syn-number` |
| `.nc .nn .nt .no` | `--syn-type` |

其余 class 继承正文色。具体 class 列表以 chroma v2.27.0 `formatters/html` 输出为准，M1 跑一遍各语言样本核对。

## 5. 硬规则

- 组件里没有 hex、rgb、hsl 色值；没有令牌外的字号、间距、圆角、阴影、z-index。
- 只有一个强调色；状态色只表达状态。
- 页面元素无阴影，浮层只用 `--shadow-1` / `--shadow-2`；不叠加 border 和 shadow。
- 动效只动 `opacity` / `transform`，时长取 `--dur-*`，`prefers-reduced-motion` 时为 0。
- 图标只用 `lucide-react`，线宽 1.75，16 或 20px；不用 emoji。
- 中文正文 16px / 1.75，最大宽度 860px。
- 反模式清单见 DESIGN.md §0，命中任何一条都要改。

## 6. 交付前自检

- [ ] DESIGN.md、`tokens.css`、设计稿 HTML 三处数值一致
- [ ] 新增或修改的颜色在两套主题下都算过对比度并写回 §2.6
- [ ] `BackgroundColor` 与 `--bg-app` 一致
- [ ] 切换主题无白闪，Mermaid 已重新渲染
- [ ] 在 DESIGN.md §10 验收清单上逐项打勾
