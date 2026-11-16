# DESIGN.md — Mile Typora 设计令牌与组件规范

> 本文是前端视觉的**单一来源**。颜色、字体、字号、间距、圆角、阴影、层级、动效都从这里取值，组件代码里不允许出现 hex 色值或游离的魔法数字。
> 落地文件：`src/styles/tokens.css`（令牌），`src/styles/markdown.css`（正文排版，只引用令牌）。
> 视觉参考：Typora 在 Windows 11 下的阅读观感（原生标题栏、白色纸面、居中正文、标题细下划线、灰色引用条）。只参考观感，不复刻 Typora 的主题文件或外观细节。
> 设计稿：[docs/design/mile-typora-design.html](docs/design/mile-typora-design.html)，可在页面顶部切换深浅色。
> 产品约束见 [PRODUCT.md](PRODUCT.md) 与 [docs/PRD.md](docs/PRD.md)，两者与本文冲突时以 PRD 为准。
> 版本：v1.0 · 2026-11-16

## 0. 风格一句话

**安静的纸面。** 正文是一张不加装饰的纸，界面外壳退到浅灰背景里，只在需要操作时出现。整个界面只有一个蓝色强调色；层级靠背景明度和细线区分，不靠卡片和阴影。

视觉指纹（缺一不可）：

1. 正文区纯色纸面（浅色 `#FFFFFF` / 深色 `#1C1D20`），外壳（工具栏、侧栏、状态栏）比纸面低一档
2. 正文居中，最大宽度 860px，中文正文 16px / 行高 1.75
3. 一级、二级标题带一条细下划线；引用块左侧 3px 灰色竖条
4. 唯一强调色蓝（浅 `#1F64C8` / 深 `#78AEF5`），只用于链接、选中、焦点、主按钮
5. 只有浮层（查找条、对话框、菜单、提示）才有阴影，页面内元素一律无阴影
6. 系统字体：Segoe UI Variable + 微软雅黑 UI，代码用 Cascadia Mono

反模式（一票否决）：

- 卡片套卡片，正文段落外加卡片框
- 渐变背景、点阵、纹理、毛玻璃（`backdrop-filter`）
- 第二个强调色；用颜色区分文件类型
- emoji 当图标
- 页面元素加阴影；border 和 shadow 叠加
- 整窗出现纵向滚动条
- 右侧预留栏出现聊天框、输入框、模型选择或假数据

## 1. 主题机制

- 两套主题：`light`、`dark`。偏好有三个值：`system`（跟随 Windows）、`light`、`dark`。
- 根元素始终带 `data-theme="light"` 或 `data-theme="dark"`，由前端根据偏好与系统外观解析后写入。CSS 只写两个块：`:root` 是浅色，`:root[data-theme="dark"]` 覆盖为深色，同名变量一一对应。
- 根元素声明 `color-scheme: light` 或 `color-scheme: dark`，让滚动条、表单控件和 WebView 默认控件跟随主题。
- 防白闪：`index.html` 引入独立的 `public/theme-init.js`（生产 CSP 禁止内联脚本），在 React 挂载前按 `prefers-color-scheme` 写好 `data-theme`；Go 在建窗前调用 `mygo.Theme.SetSource`。设计稿 HTML 是静态文件，内联脚本只用于演示。原生窗口 `BackgroundColor` 取当前主题的 `--bg-app`（浅 `#FFFFFF`，深 `#1C1D20`）。
- 渲染后的 Mermaid SVG 颜色写死在 SVG 里，切换主题时要用新的令牌值重新渲染该文档的图表。KaTeX 继承 `currentColor`，不用重新渲染。
- 显式偏好（浅色或深色）由 Go 在建窗时通过 `PageOptions.PreloadScript` 在首帧前写入 `data-theme`，`theme-init.js` 检测到已有主题就不再按系统覆盖；跟随系统时才由媒体查询决定首帧。应用内改外观后，所有窗口收到 `theme-change` 事件即时切换，Mermaid 按保留的源码重绘。
- 发布范围：P0 开放三种外观，设置里可选跟随系统、浅色、深色，首次默认跟随系统（PRD C-12、FR-10.12、AC-29）。P2 的“主题”菜单复用同一设置，可再增加内置主题。

## 2. 颜色令牌

所有对比度都按 WCAG 2.1 计算过，结果见 §2.6。

### 2.1 表面与线条

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--bg-app` | `#FFFFFF` | `#1C1D20` | 正文纸面；原生窗口底色 |
| `--bg-chrome` | `#F6F6F7` | `#222327` | 工具栏、左右侧栏、状态栏 |
| `--bg-sunken` | `#F6F7F8` | `#26282C` | 代码块、front matter 块、表头 |
| `--bg-inline-code` | `#F0F1F3` | `#2C2E33` | 行内代码 |
| `--bg-raised` | `#FFFFFF` | `#2A2C31` | 浮层：查找条、对话框、菜单、提示 |
| `--bg-hover` | `#EBECEE` | `#2E3035` | 按钮、树节点悬停 |
| `--bg-active` | `#E1E3E6` | `#36383E` | 按下 |
| `--bg-selected` | `#E5EDFA` | `#253447` | 文件树选中项、正文选区 |
| `--bg-overlay` | `rgba(17, 17, 17, 0.32)` | `rgba(0, 0, 0, 0.5)` | 对话框遮罩 |
| `--line` | `#E3E4E7` | `#33363B` | 分隔线、标题下划线、表格线（装饰，不承载信息） |
| `--line-strong` | `#D0D2D6` | `#43464D` | 侧栏与正文分界、浮层描边 |
| `--line-input` | `#8C9099` | `#6A6F79` | 输入框、单选框描边（与底色 ≥ 3:1） |
| `--quote-bar` | `#D0D2D6` | `#4A4E56` | 引用块左竖条 |

### 2.2 文字

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--text` | `#262626` | `#D5D7DB` | 正文 |
| `--text-strong` | `#111111` | `#EEEFF1` | 标题、加粗 |
| `--text-soft` | `#4F555D` | `#AEB3BA` | 引用块文字、次要正文、工具栏标签 |
| `--text-muted` | `#636973` | `#959AA3` | 状态栏、路径、提示、六级标题 |
| `--text-faint` | `#9A9EA6` | `#6C717A` | 仅用于占位符和停用态，不得承载必要信息 |
| `--text-on-accent` | `#FFFFFF` | `#111418` | 主按钮上的文字 |

### 2.3 强调色（全应用唯一）

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#1F64C8` | `#78AEF5` | 链接、主按钮底、选中树节点文字、焦点环 |
| `--accent-hover` | `#1A55AA` | `#9AC3F8` | 链接、主按钮悬停 |
| `--accent-soft` | `#E5EDFA` | `#253447` | 强调色浅底（同 `--bg-selected`） |
| `--focus-ring` | `#1F64C8` | `#78AEF5` | 2px 焦点环 |

### 2.4 状态色

状态不能只靠颜色表达：每个状态都要同时配图标和文字。

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--warn` / `--warn-bg` | `#8A5300` / `#FFF5DC` | `#E8B84A` / `#3A2F14` | 内容已过期、结果不完整、部分目录无法访问 |
| `--danger` / `--danger-bg` | `#B3261E` / `#FDEDEB` | `#FF8C82` / `#3F2120` | 加载失败、文件不存在、编码不支持 |
| `--ok` / `--ok-bg` | `#18742F` / `#E6F4EA` | `#5CC27A` / `#1C3324` | 设置已保存 |
| `--info` / `--info-bg` | `#1F64C8` / `#E5EDFA` | `#78AEF5` / `#253447` | 只读标识、普通提示 |

### 2.5 正文专用

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--mark` | `#FFE48A` | `#6E5A12` | 查找命中 |
| `--mark-current` | `#FFC266` | `#7A4F0A` | 当前命中（深色下文字用 `--text-strong`） |
| `--syn-keyword` | `#CF222E` | `#FF7B72` | 代码高亮：关键字 |
| `--syn-string` | `#0A3069` | `#A5D6FF` | 字符串 |
| `--syn-comment` | `#5C636C` | `#8B949E` | 注释 |
| `--syn-function` | `#8250DF` | `#D2A8FF` | 函数名 |
| `--syn-number` | `#0550AE` | `#79C0FF` | 数字、常量 |
| `--syn-type` | `#953800` | `#FFA657` | 类型、类名 |
| `--diagram-node` | `#F6F7F8` | `#26282C` | Mermaid 节点填充 |
| `--diagram-stroke` | `#8C9099` | `#6A6F79` | Mermaid 节点描边、连线 |
| `--diagram-text` | `#262626` | `#D5D7DB` | Mermaid 文字 |
| `--diagram-accent` | `#E5EDFA` | `#253447` | Mermaid 次级节点、甘特任务条 |

代码高亮的配色参考 GitHub 浅色和深色主题。chroma 输出的 class 映射到上面六个令牌，不使用 chroma 自带的内联样式。

### 2.6 对比度核验（WCAG 2.1）

| 组合 | 浅色 | 深色 | 要求 |
| --- | --- | --- | --- |
| `--text` / `--bg-app` | 15.13 | 11.70 | ≥ 4.5 |
| `--text-soft` / `--bg-chrome` | 6.97 | 7.44 | ≥ 4.5 |
| `--text-muted` / `--bg-chrome` | 5.12 | 5.55 | ≥ 4.5 |
| `--text-muted` / `--bg-hover` | 4.68 | 4.67 | ≥ 4.5 |
| `--accent` / `--bg-app` | 5.65 | 7.36 | ≥ 4.5 |
| `--accent` / `--bg-selected` | 4.80 | 5.52 | ≥ 4.5 |
| `--text-on-accent` / `--accent` | 5.65 | 8.07 | ≥ 4.5 |
| `--warn` / `--warn-bg` | 5.83 | 7.13 | ≥ 4.5 |
| `--danger` / `--danger-bg` | 5.76 | 6.43 | ≥ 4.5 |
| `--ok` / `--ok-bg` | 5.17 | 6.10 | ≥ 4.5 |
| `--text` / `--mark` | 12.05 | 4.65 | ≥ 4.5 |
| `--text-strong` / `--mark-current` | 11.83 | 6.19 | ≥ 4.5 |
| `--syn-comment` / `--bg-sunken` | 5.66 | 4.80 | ≥ 4.5 |
| `--info` / `--info-bg` | 4.80 | 5.52 | ≥ 4.5 |
| `--line-input` / `--bg-app` | 3.20 | 3.34 | ≥ 3（非文字） |

浅色 `--ok`（原 `#1A7F37`，4.47）与 `--syn-comment`（原 `#6E7781`，4.24）在校验后调深到现值。修改任何颜色令牌后都要重新计算本表。

## 3. 字体

只用 Windows 11 系统字体（本地字体，不走 CDN，满足 PRD 8.1 离线要求）。KaTeX 字体随 `katex` 包打进前端产物。

```css
--font-ui: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
--font-reading: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
--font-heading: "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
--font-mono: "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace;
```

选择理由：阅读器要和 Windows 原生窗口融为一体，中文正文没有可以随包分发的轻量字体；系统字体渲染质量最好、零体积。代码字体在 Cascadia 缺失时回退到 Consolas。

### 3.1 界面字阶

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--ui-xs` | 12px / 16px | 状态栏、徽标、快捷键提示 |
| `--ui-sm` | 13px / 20px | 文件树、工具栏标签、提示 |
| `--ui-base` | 14px / 20px | 对话框正文、按钮、输入框 |
| `--ui-lg` | 16px / 24px | 对话框标题、空状态标题 |
| `--ui-xl` | 20px / 28px | 空白页标题 |

界面字重只用 400 与 600。

### 3.2 正文字阶

正文基准 `--read-size: 16px`，其余用 `em` 跟随基准，P2 缩放只改基准值。

| 元素 | 字号 | 行高 | 字重 | 上 / 下间距 | 其他 |
| --- | --- | --- | --- | --- | --- |
| 段落 | 1em | 1.75 | 400 | 0 / 1em | |
| h1 | 2em | 1.3 | 600 | 0.8em / 0.6em | 底部 1px `--line`，下内边距 0.3em；`scroll-margin-top` 留出锚点跳转余量 |
| h2 | 1.5em | 1.35 | 600 | 1.4em / 0.6em | 底部 1px `--line`，下内边距 0.3em |
| h3 | 1.25em | 1.4 | 600 | 1.3em / 0.5em | |
| h4 | 1.0625em | 1.5 | 600 | 1.2em / 0.5em | |
| h5 | 1em | 1.5 | 600 | 1.2em / 0.5em | |
| h6 | 0.9375em | 1.5 | 600 | 1.2em / 0.5em | 颜色 `--text-muted` |
| 行内代码 | 0.875em | 继承 | 400 | | `--bg-inline-code`，左右内边距 0.35em，圆角 `--r-xs` |
| 代码块 | 0.875em | 1.6 | 400 | 0 / 1em | `--bg-sunken`，内边距 12px 16px，圆角 `--r-md` |
| 表格 | 0.9375em | 1.6 | 400 | 0 / 1em | 单元格内边距 6px 12px |

正文首个元素的上间距为 0。中文与英文之间不自动加空格，保留原文。

标题锚点 `id` 保留中文与数字，重复标题追加 `-1`、`-2`；链接里的 `#锚点` 先做 URL 解码再匹配。

## 4. 间距、尺寸与布局

### 4.1 间距（4px 基网）

`--sp-1: 4px` · `--sp-2: 8px` · `--sp-3: 12px` · `--sp-4: 16px` · `--sp-5: 20px` · `--sp-6: 24px` · `--sp-8: 32px` · `--sp-12: 48px`。不允许出现 13px、7px 这类非网格值。

### 4.2 布局尺寸

| 令牌 | 值 | 说明 |
| --- | --- | --- |
| `--toolbar-h` | 44px | 工具栏高度（PRD 5.1） |
| `--statusbar-h` | 26px | 状态栏高度 |
| `--sidebar-left-w` | 240px | 左侧文件树（PRD 5.2） |
| `--sidebar-right-w` | 260px | 右侧预留栏（PRD 5.2） |
| `--content-max` | 860px | 正文最大宽度（PRD 5.2） |
| `--content-pad-x` | 48px | 正文左右留白；中间区宽度小于 720px 时降为 24px |
| `--content-pad-top` | 40px | 正文顶部留白 |
| `--tree-row-h` | 28px | 文件树行高 |
| `--tree-indent` | 16px | 每级缩进 |
| `--control-h` | 32px | 按钮、输入框高度 |
| `--icon-sm` / `--icon-md` | 16px / 20px | 行内图标 / 工具栏图标 |
| `--window-min` | 960 × 640 | 最小客户区（PRD 5.2） |
| `--bp-right-collapse` | 1200px | 窗口宽度低于此值时自动收起右栏（PRD 5.2） |

### 4.3 整窗结构

```text
┌───────────── 原生标题栏（系统绘制，不在页面内） ─────────────┐
├ 工具栏 44px  --bg-chrome，底部 1px --line ──────────────────┤
│ 左栏 240px        │ 正文区（--bg-app）        │ 右栏 260px    │
│ --bg-chrome       │ 居中 max 860px            │ --bg-chrome   │
│ 右侧 1px          │ 独立滚动                  │ 左侧 1px      │
│ --line-strong     │                           │ --line-strong │
├ 状态栏 26px  --bg-chrome，顶部 1px --line ──────────────────┤
```

- 页面根节点 `height: 100dvh; overflow: hidden`；中间行高度 `calc(100dvh - var(--toolbar-h) - var(--statusbar-h))`。
- flex 链路每一层都写 `min-height: 0`，左栏、正文、右栏各自 `overflow-y: auto`。
- 代码块、表格、Mermaid 图表、宽公式在自己的容器里横向滚动，不能撑宽正文。
- 侧栏折叠时宽度直接变 0 并移出可访问树（`hidden`），正文仍保持最大宽度居中。
- DPI 100% / 125% / 150% / 200% 下所有尺寸按逻辑像素计算，不做额外适配。

## 5. 圆角、阴影、层级

### 5.1 圆角

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--r-xs` | 3px | 行内代码、徽标 |
| `--r-sm` | 4px | 按钮、树节点、输入框 |
| `--r-md` | 6px | 代码块、提示条、图片占位 |
| `--r-lg` | 8px | 对话框、查找条、菜单 |
| `--r-pill` | 999px | 只读徽标 |

### 5.2 阴影（只给浮层）

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--shadow-1` | `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px var(--line-strong)` | `0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px var(--line-strong)` | 查找条、提示、菜单 |
| `--shadow-2` | `0 8px 28px rgba(0,0,0,0.14), 0 0 0 1px var(--line-strong)` | `0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px var(--line-strong)` | 对话框 |

浮层的 1px 描边写在阴影里，不再另加 `border`。

### 5.3 层级

`--z-sticky: 10`（表头吸顶等） · `--z-popover: 20`（查找条、菜单、提示） · `--z-overlay: 30`（对话框遮罩） · `--z-dialog: 31` · `--z-toast: 40`。不允许出现其他 z-index。

## 6. 动效

| 令牌 | 值 |
| --- | --- |
| `--dur-fast` | 120ms（悬停、按下） |
| `--dur-base` | 180ms（浮层出现、侧栏折叠） |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` |

- 只动画 `opacity` 和 `transform`。侧栏折叠不做宽度动画，直接切换。
- 浮层出现：`opacity 0 → 1` 加 `translateY(-4px) → 0`。
- `prefers-reduced-motion: reduce` 时所有时长变为 0。
- 不做页面加载动画、滚动入场动画、悬停放大。阅读器的动效越少越好。

## 7. 图标

- 使用 Lucide（`lucide-react`），线宽 1.75，尺寸 16px（行内、树节点）或 20px（工具栏）。全应用只用这一套。
- 图标颜色继承 `currentColor`。
- 只有图标没有文字的按钮必须有 `aria-label` 和悬停提示（含快捷键）。

| 位置 | 图标 |
| --- | --- |
| 打开文件 / 打开目录 / 新窗口 | `file-text` / `folder-open` / `app-window` |
| 刷新 / 查找 / 设置 | `refresh-cw` / `search` / `settings` |
| 左栏开关 / 右栏开关 | `panel-left` / `panel-right` |
| 目录展开 / 折叠 | `chevron-right`（展开时旋转 90°） |
| 目录 / Markdown 文件 | `folder` / `file-text` |
| 只读 | `lock` |
| 警告 / 错误 / 成功 / 信息 | `triangle-alert` / `circle-x` / `circle-check` / `info` |
| 图片受限 / 外链 / 复制 | `image-off` / `external-link` / `copy` |

### 7.1 应用图标

- 来源：`docs/images/深色背景上的橙角MT文档图标.png`（设计原图，深色底、白色纸面、右上橙色折角、衬线 MT）。不要手改生成的 PNG，改图后重新生成。
- 生成：`python -I scripts/make-icons.py "docs/images/深色背景上的橙角MT文档图标.png"`。脚本用洪水填充取轮廓（字母黑色与深色底同色，不能按颜色差抠图），去底、反预乘、居中到 86% 画布。
- 产物与用途：

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `resources/icon.png` | 1024×1024 透明 | 构建产物（`mygo build`）的应用图标：任务栏、窗口标题栏、开始菜单、安装包 |
| `resources/icon-dev.png` | 1024×1024 透明，右下角橙色 DEV 徽标 | `mygo dev` 开发窗口的图标，与正式版区分 |
| `public/icon.png` | 256×256 透明 | 页面图标（`index.html` 的 `link[rel=icon]`），浏览器面板与 WebView 标签用 |

- 图标内容占画布的 86%，四周留白交给系统；不自带阴影（系统会画）。
- 页面内不重复摆放大号应用图标；空白页以文字为主（§8.9）。P0 没有托盘，若以后加入托盘，用 `resources/icon.png`，不另做一套。

## 8. 组件规范

### 8.1 工具栏

- 高 44px，左右内边距 `--sp-2`，项间距 `--sp-1`，分组之间放 1px × 20px 的 `--line` 竖线。
- 分组：［打开文件、打开目录、新窗口］｜［刷新、查找］｜弹性空白｜［左栏开关、右栏开关、设置］。
- "打开文件""打开目录"带文字标签，其余只放图标。
- 按钮高 32px、圆角 `--r-sm`、文字 `--ui-sm` `--text-soft`；悬停 `--bg-hover`，按下 `--bg-active`；侧栏开关在打开状态下用 `--bg-active` 底并设 `aria-pressed="true"`。
- 停用态：文字 `--text-faint`，无悬停反馈，设 `aria-disabled`。

### 8.2 文件树

- 行高 28px，左内边距 `--sp-2` + 层级 × 16px；字号 `--ui-sm`。
- 结构：箭头（仅目录）→ 图标 → 名称（单行省略，悬停 `title` 显示完整路径）。
- 悬停 `--bg-hover`；选中 `--bg-selected` 加文字 `--accent`、字重 600；键盘焦点额外显示 2px 内描边 `--focus-ring`。
- 树根行显示目录名，字重 600，下方 `--sp-1` 间隔。
- 单文件模式只列出当前文件一行，不显示箭头。
- 树顶部的状态行（扫描中、部分目录无法访问、结果不完整）用 §8.7 的紧凑提示条，放在树根上方。
- 文件行悬停（或键盘焦点在该行）时右侧出现"在新窗口打开"图标按钮（`SquarePlus`，20px），点击把该文件开在新窗口；这是为 PRD FR-02.4 补的入口，给用户确认后定稿（docs/开发计划.md 门禁 G6）。
- 10 000 份文件以上用虚拟列表渲染，行高固定。

### 8.3 正文区

- 正文容器 `max-width: var(--content-max)`，左右 `--content-pad-x`，顶部 `--content-pad-top`，底部留 40vh，让最后一段能滚到视线中部。
- 链接：`--accent`，无下划线，悬停加下划线；外部链接名称后跟 12px `external-link` 图标。
- 引用：左 3px `--quote-bar`，左内边距 `--sp-4`，文字 `--text-soft`。
- 列表：缩进 1.75em，项间距 0.25em；任务列表的复选框只读，勾选态用 `--accent` 填充，`cursor: default`，设 `aria-readonly`。
- 表格：外框和单元格线用 `--line`，表头底色 `--bg-sunken`、字重 600；偶数行不加斑马纹；宽表格放进横向滚动容器。
- 分隔线：1px `--line`，上下 1.5em。
- 图片：最大宽度 100%，居中，圆角 0；加载失败或被阻止时换成 §8.6 的占位块。
- 代码块：右上角悬停出现"复制"按钮（图标加文字，`--ui-xs`）；语言名用 `--ui-xs` `--text-muted` 放在左上角。
- YAML front matter：折叠成一行"元信息"（`--ui-sm` `--text-muted`，左侧 `chevron-right`），展开后以代码块样式只读显示。
- 选区：`::selection` 背景 `--bg-selected`。

### 8.4 数学公式与 Mermaid

- 行内公式随正文基线，不改行高；块级公式居中，上下 1em，宽公式横向滚动。
- Mermaid 图表放在 `--bg-app` 上，不加外框；容器上下 1em，内容居中，超宽时横向滚动。右上角悬停出现"查看源码"和"复制源码"。
- Mermaid 主题用 `base`，`themeVariables` 从当前主题的 `--diagram-*` 和 `--font-ui` 计算后传入。

### 8.5 查找条

- 浮在正文区右上角，距顶 `--sp-3`、距右 `--sp-4`，宽 360px，高 40px，`--bg-raised` 加 `--shadow-1`，圆角 `--r-lg`。
- 结构：输入框（无边框，`--ui-base`）→ 计数"3 / 12"（`--ui-xs` `--text-muted`）→ 上一个、下一个、关闭按钮。
- 无结果时计数换成"未找到匹配内容"，颜色 `--danger`。
- 命中用 CSS Custom Highlight API 绘制：`::highlight(find)` 用 `--mark`，`::highlight(find-current)` 用 `--mark-current`，不改 DOM。

### 8.6 局部降级占位块

用于图片受限、远程图片未加载、公式错误、Mermaid 不支持或超限：

- `--bg-sunken` 底，1px 虚线 `--line-strong`，圆角 `--r-md`，内边距 `--sp-3` `--sp-4`。
- 第一行：16px 图标加原因（`--ui-sm` `--text-soft`），例如"远程图片未加载""公式语法错误：Undefined control sequence \foo"。
- 第二行（可选）：替代文字或原始源码，用 `--font-mono` `--ui-xs` `--text-muted`，最多显示 6 行，超出可展开。
- 占位块不使用 `--danger` 红色底，局部问题不应看起来像整篇失败。

### 8.7 提示条

- **整篇级**（内容已过期、文件已不存在）：贴在正文区顶部，宽度与正文一致，高度自适应，内边距 `--sp-2` `--sp-4`，圆角 `--r-md`，底色 `--warn-bg` 或 `--danger-bg`，文字和图标用对应前景色。右侧放操作按钮（重试、关闭当前文档）。
- **紧凑型**（文件树顶部）：内边距 `--sp-1` `--sp-2`，`--ui-xs`，可点击"重试"。
- 状态栏只放文字状态，不放提示条。

### 8.8 状态栏

- 高 26px，`--ui-xs` `--text-muted`，左右内边距 `--sp-3`，项间距 `--sp-4`。
- 左侧：只读徽标（`lock` 图标加"只读"，`--info` 文字，`--info-bg` 底，`--r-pill`）→ 当前文件相对路径（悬停显示完整路径）。
- 右侧：渲染状态（"加载中""已更新 14:32""公式 2 处渲染受限"）→ 编码"UTF-8"→ 换行"LF / CRLF"。
- 错误状态要带图标，不能只变色。

### 8.9 空白页与空状态

- **空白窗口**：正文区垂直居中，最大宽度 480px。标题"开始阅读"（`--ui-xl` 600）→ 两个按钮（主按钮"打开文件 Ctrl+O"，次按钮"打开目录 Ctrl+Shift+O"）→ "最近打开"列表（最多 8 条显示，名称加灰色路径，文件和目录用不同图标，右侧"清空记录"文字按钮）。没有记录时不显示列表。
- **目录未选文件**：正文区居中显示"请从左侧选择 Markdown 文件"（`--ui-base` `--text-muted`）。
- **目录无 Markdown**：左栏和正文都显示空状态，文字"此目录下未找到 Markdown 文件"，下方次按钮"打开其他目录"。
- **空文件**：正文区显示"这是一个空 Markdown 文件"，不是错误样式。
- **首次加载失败**：正文区居中，`circle-x` 图标（`--danger`）加错误类别标题 → 一句原因 → 主按钮"重试"、次按钮"重新选择"。不显示堆栈。

### 8.10 右侧预留栏

- `--bg-chrome` 底，只放一行顶部标题"预留侧栏"（`--ui-xs` `--text-muted`）和右上角折叠按钮，其余留空。
- 默认收起，由工具栏的右栏开关展开（PRD D-06，v0.4 调整）；展开时才占用 260px。
- 不放插画、说明文字、输入框或"即将上线"之类的宣传语。

### 8.11 按钮

| 类型 | 底色 | 文字 | 悬停 | 用途 |
| --- | --- | --- | --- | --- |
| 主按钮 | `--accent` | `--text-on-accent` | `--accent-hover` | 每个视图最多一个 |
| 次按钮 | 透明，1px `--line-strong` | `--text` | `--bg-hover` | 取消、次要操作 |
| 文字按钮 | 透明 | `--accent` | 下划线 | 清空记录、展开 |
| 图标按钮 | 透明 | `--text-soft` | `--bg-hover` | 工具栏、浮层内 |

高 32px，圆角 `--r-sm`，左右内边距 `--sp-3`，字号 `--ui-base`。快捷键提示用 `--ui-xs` `--text-muted` 跟在文字后面（主按钮上用 `--text-on-accent` 加 0.8 不透明度）。

### 8.12 对话框

- 宽 440px（设置对话框 560px），`--bg-raised`，`--shadow-2`，圆角 `--r-lg`，内边距 `--sp-6`。
- 标题 `--ui-lg` 600 → 正文 `--ui-base` `--text-soft` → 底部按钮右对齐，主按钮在最右。
- 打开时焦点进入对话框，Esc 关闭，焦点回到触发元素。
- **外部链接确认**：标题"即将访问外部站点"，正文显示完整 URL（`--font-mono`，可选中），按钮"取消""在浏览器中打开"。
- **工作区外 Markdown 确认**：标题"打开工作区外的文件"，正文显示目标路径，按钮"取消""在新窗口打开"。

### 8.13 设置对话框

- 左侧分组导航（P0 只有"常规"），右侧内容。
- "启动时"是单选组：○ 恢复上一份文档、○ 打开新的空白页，每项下方一行 `--ui-xs` `--text-muted` 说明。
- 底部按钮：取消、保存。保存成功后对话框关闭，状态栏显示"设置已保存"（`--ok`）；保存失败时对话框不关闭，在按钮上方显示 `--danger` 提示条"本次设置未保存"加重试按钮。
- 单选框：16px 圆形，描边 `--line-input`，选中时外圈 `--accent`、内点 6px `--accent`。

### 8.14 焦点与可访问性

- 所有可交互元素的 `:focus-visible`：`outline: 2px solid var(--focus-ring); outline-offset: 2px`。树节点和列表项改用内描边（`outline-offset: -2px`）。
- 状态和错误都要有图标加文字。
- 只有图标的按钮必须有 `aria-label`。
- 文件树用 `role="tree"` / `treeitem`，支持方向键（PRD FR-09）。

## 9. 落地示例（tokens.css 节选）

```css
:root {
  color-scheme: light;
  --bg-app: #FFFFFF;
  --bg-chrome: #F6F6F7;
  --bg-sunken: #F6F7F8;
  --text: #262626;
  --text-muted: #636973;
  --accent: #1F64C8;
  --line: #E3E4E7;
  /* 其余令牌按 §2–§6 全部列出 */
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-app: #1C1D20;
  --bg-chrome: #222327;
  --bg-sunken: #26282C;
  --text: #D5D7DB;
  --text-muted: #959AA3;
  --accent: #78AEF5;
  --line: #33363B;
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; }
}
```

完整变量表以 `src/styles/tokens.css` 为准，设计稿 HTML 内嵌的 `:root` 与本文 §2–§6 一一对应，可直接复制。

## 10. 验收清单

- [ ] 组件代码里没有 hex、rgb 色值，没有非令牌的字号、间距、圆角
- [ ] 深浅两套主题下，§2.6 所有组合达到要求
- [ ] 整窗无纵向滚动条；最小 960 × 640 下三栏、工具栏、状态栏可用
- [ ] 窗口宽度 < 1200 时右栏自动收起；用户手动隐藏后不自动恢复
- [ ] 侧栏折叠后正文仍居中，最大宽度不变
- [ ] 宽代码、宽表格、宽图表、宽公式只在各自容器内横向滚动
- [ ] 所有可交互元素有可见焦点；只有图标的按钮有 `aria-label`
- [ ] 状态与错误同时有图标和文字
- [ ] 页面内元素没有阴影；浮层只用 `--shadow-1` / `--shadow-2`
- [ ] 切换主题无白闪，原生窗口底色与 `--bg-app` 一致
- [ ] 切换主题后 Mermaid 图表按新令牌重新渲染
- [ ] `prefers-reduced-motion` 下没有动画
- [ ] 界面上没有 emoji；右侧预留栏没有任何暗示 Agents 已可用的元素
