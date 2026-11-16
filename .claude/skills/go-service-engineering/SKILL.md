---
name: go-service-engineering
description: Mile Typora 的 Go 本地后端工程法：internal 分包与依赖方向、ctx 取消贯穿、Windows 路径规范化与授权范围校验（真实路径、重解析点、UNC、单次解码）、有上限的递归目录扫描、UTF-8 校验与 BOM、只读访问保证、应用元数据原子写入与损坏保留、测试策略。只要在写或改本项目 internal/ 下的 Go 代码、处理文件路径或读用户文件、写设置或最近记录，都应加载本 skill。
---

# go-service-engineering（Mile Typora 版）

本 skill 以 `docs/PRD.md` 为准。原版来自另一个项目（Mile AI Search，含出站 HTTP、密钥、SQLite），这些内容本项目 P0 不需要，已删去；备份在 `E:\Agent-skills\go\go-service-engineering\`。

## 1. 何时加载 / 不加载

- 加载：写 `internal/` 下任何 Go 包；读用户文件或目录；做路径授权；写设置、最近记录、恢复目标；写 Go 测试。
- 不加载：mygo 窗口、绑定、事件、Channel、打包（用 `mygo-web-app`）；Markdown 渲染管线细节（用 `mygo-desktop-app-dev`）。

## 2. 目录与依赖方向

```text
internal/
├── contract/   前端可见类型：请求、结果、事件载荷、错误码。不依赖其他业务包
├── pathguard/  路径规范化、真实路径解析、授权范围判断。纯函数，不 import mygo
├── scan/       递归目录扫描、排序、容量上限。纯 Go
├── docread/    读取单个文档：大小检查、UTF-8 校验、BOM、换行识别
├── markdown/   goldmark 管线、HTML 清理、资源与链接改写
├── appstate/   设置、最近记录、恢复目标：原子写入、损坏保留
├── winctx/     每个窗口的上下文、打开请求队列、就绪状态。不 import mygo，原生调用经函数注入
└── service/    mygo 绑定层：装配依赖、登记窗口、转换错误
```

依赖方向：`service -> winctx/markdown/docread/scan/appstate -> pathguard -> contract`。下层不反向引用上层；只有 `service` 和 `main` import mygo。这样路径、扫描、队列这些边界条件全部能用 `go test` 覆盖，原生行为只在真实窗口里少量验收。

## 3. ctx 与取消

1. 绑定方法第一个参数是 `context.Context`，页面导航或窗口关闭时会被取消。扫描、读取、渲染都从这个 ctx 派生，**不用 `context.Background()`**。
2. 窗口专属的长任务（目录扫描、监听）挂在"窗口 ctx"上：`winctx` 在窗口创建时 `context.WithCancel`，`OnClosed` 时取消。PRD 8.2 要求关窗 5 秒内停止专属任务。
3. 扫描循环每处理一批条目检查一次 `ctx.Err()`；读取文件用 `io.LimitReader` 加分段读，在段间检查 ctx。
4. 用计数证明取消有效：`winctx` 维护 `activeScans`、`activeWatches` 原子计数，关窗前后各记一次，测试断言归零。截图证明不了取消。

## 4. 路径授权（安全核心，PRD FR-06）

所有用户路径都在 Go 侧校验，前端传来的路径一律不可信。

### 4.1 规范化

```go
// Canon 把路径变成可比较的绝对真实路径；任何一步失败都拒绝
func Canon(p string) (string, error) {
    if p == "" || strings.ContainsRune(p, 0) { return "", ErrInvalidPath }
    if isUNC(p) { return "", ErrUNC }                 // \\server\share、\\?\UNC\ 均拒绝
    abs, err := filepath.Abs(filepath.Clean(p))
    if err != nil { return "", err }
    real, err := filepath.EvalSymlinks(abs)          // 只解析符号链接，不解析目录联接（见下）
    if err != nil { return "", err }
    if isUNC(real) { return "", ErrUNC }
    return real, nil
}
```

**Go 1.23 起 `filepath.EvalSymlinks` 不再解析 Windows 挂载点（目录联接）**，`os.Lstat` 也不再给联接设 `ModeSymlink`，而是 `ModeIrregular`。所以只靠 `EvalSymlinks` 挡不住"经联接指向范围外"的资源路径。范围判断时，从授权根目录开始到目标为止，对路径的**每一级**做 `os.Lstat`，任何一级带 `ModeSymlink` 或 `ModeIrregular` 就拒绝（PRD FR-06.6）。这条要有单测（`mklink /J` 建联接）。

- 比较前统一大小写：Windows 路径不区分大小写，用 `strings.EqualFold` 或比较前 `strings.ToLower`，不要用 `strings.HasPrefix` 直接判断范围。
- 判断"在范围内"：`rel, err := filepath.Rel(root, target)`，`rel` 不以 `..` 开头且不是绝对路径才算在内。前缀判断会把 `C:\docs2` 当成 `C:\docs` 的子目录。
- `\\?\` 长路径前缀、`C:` 这种无分隔符的驱动器相对路径、末尾的点和空格（Windows 会静默去掉）都要有单测。

### 4.2 重解析点

PRD FR-03 要求扫描时不跟随符号链接、目录联接和其他重解析入口。`os.Lstat` 后检查：

```go
fi, _ := os.Lstat(p)
if fi.Mode()&os.ModeSymlink != 0 || fi.Mode()&os.ModeIrregular != 0 { skip() }
// Go 1.23+ 的 Windows 上，目录联接和非符号链接的重解析点报告为 ModeIrregular。
// OneDrive 按需文件、去重文件的表现未确认，M1 用 golang.org/x/sys/windows 读
// FILE_ATTRIBUTE_REPARSE_POINT 对照验证后再决定是否兜底
```

`os.ReadDir` 返回的 `DirEntry.Type()` 不足以判断联接，要对目录项再 `Lstat` 一次（或用 `entry.Info()`）。

跳过时计数，扫描结果带 `skippedReparse int`，前端据此提示"存在跳过项"。

### 4.3 资源路径解码

Markdown 里的图片地址可能有 URL 编码（`%E5%9B%BE.png`、`%20`）。规则：

1. **只解码一次**（`url.PathUnescape`），解码后若仍含 `%` 编码序列，不再解码，按字面文件名处理。
2. 解码后再拼接到"当前 Markdown 所在目录"，然后走 `Canon` 和范围判断。
3. 拒绝：绝对路径、盘符、UNC、`file:`、解码后含 NUL 的路径。
4. 单测覆盖：中文、空格、`%2e%2e%2f`（编码的 `../`）、`%252e`（双重编码）、大小写混合扩展名。

### 4.4 授权范围

| 模式 | 范围 |
| --- | --- |
| 目录工作区 | 用户选择的根目录（真实路径）及其普通子目录 |
| 单文件 | 该文件，以及其父目录内的相对图片；不扫描父目录 |
| 工作区外链接 | 用户确认后在新的单文件窗口打开，范围按单文件计算 |

范围存在 `winctx` 里，按窗口隔离。错误信息只说类别（越界、不存在、无权限），不带未授权文件的内容和完整路径。

## 5. 目录扫描（PRD FR-03、8.3）

1. 用 `os.ReadDir` 逐层遍历（不用 `filepath.WalkDir` 的默认行为，因为要自己控制重解析点、深度和上限）。
2. 只收 `.md`、`.markdown`（扩展名不区分大小写）和包含它们的祖先目录；空目录与没有 Markdown 后代的目录不返回。
3. 隐藏目录和点号目录照常扫描，不套用 `.gitignore`。
4. 上限：总条目 50 000、Markdown 10 000、深度 64（PRD 8.3 建议值）。总条目或文件数先到就停止并返回 `truncated: true`；深度到达只跳过该分支，返回 `depthLimited` 列表。
5. 某个子目录读取失败（无权限）不终止扫描，记入 `partialErrors`，其余分支继续。
6. 排序：目录在前、文件在后，名称按不区分大小写的自然排序（`a2` 在 `a10` 前）。自己实现比较函数并单测，中文按码点顺序即可。
7. 分批推送：每 500 条或每 100ms 推一批给前端（Channel，见 `mygo-web-app`），保证 1 万条目的样本首批 1 秒内可操作（PRD 8.2）。
8. 不读正文。只在用户选中文件时读取。

## 6. 读取文档（PRD FR-04 编码、8.3）

1. 读前 `Stat`：超过 10 MiB 拒绝；读取用 `io.LimitReader(f, max+1)`，读到超过上限也拒绝（文件可能在读的过程中变大）。
2. 去掉开头的 UTF-8 BOM，记 `hasBOM`。
3. `utf8.Valid` 不通过就返回 `ErrEncoding`，不猜 GBK、UTF-16，不用替换字符顶替。
4. 识别换行风格（LF / CRLF / 混合）给状态栏显示；解析前把 CRLF 统一成 LF。
5. 空文件是有效文档，返回 `empty: true`，不是错误。
6. **只读打开**：`os.Open`（只读），不用 `os.OpenFile` 的写标志，不修改访问时间以外的任何属性。

## 7. 应用元数据（PRD FR-08、FR-10）

设置、最近记录、恢复目标写在 `mygo.App.Path(mygo.PathUserData)` 下，永远不写用户文档目录。

1. 单一写入者：所有窗口通过 `appstate.Store`（包级单例，内部加锁）读写，避免并发覆盖。
2. 原子写入：同目录 `os.CreateTemp` → 写 → `Sync` → `Close` → `os.Rename` 覆盖。
3. 损坏保留：读到无法解析的 JSON 时，返回 `ErrCorrupt`，本次按默认值运行；**不覆盖原文件**，也不把文件内容写进日志或错误。下一次用户成功保存设置时，先把坏文件改名为 `settings.corrupt-<时间>.json` 再写新文件。
4. 写入失败返回错误，前端显示"本次设置未保存"，不能提示成功（PRD FR-08.8）。
5. 只写 UTF-8 无 BOM；字段加 `version`，便于以后迁移。
6. 清空最近记录要同时清掉恢复目标和持久化阅读位置，但不改启动模式（PRD FR-10.10）。

## 8. 日志

- 不记录正文、不记录完整路径（只记扩展名、大小、耗时、错误类别）。
- 用 `log/slog`，开发期输出到 stderr，发版写到 `mygo.App.Path(mygo.PathLogs)`。

## 9. 测试策略

1. `pathguard`、`scan`、`docread`、`appstate`、`winctx` 全部是纯 Go，单测覆盖边界条件。
2. 用 `t.TempDir()` 搭样本目录：5 层以上嵌套、同名文件、隐藏目录、中文和空格路径、无权限目录（用 `icacls` 去掉权限，测试结束恢复）、目录联接（`mklink /J`，需要时 `t.Skip`）。
3. **只读保证测试**（PRD AC-21）：扫描和读取前后对工作区所有文件算 SHA-256，断言完全一致，且工作区内没有新文件。
4. 路径解析用 `go test -fuzz` 做模糊测试，断言"任何输入要么被拒绝，要么结果在授权范围内"。
5. 取消测试：启动扫描后取消 ctx，断言扫描 goroutine 退出、计数归零。
6. 常用命令：`go test ./...`、`go vet ./...`、`go test -race ./internal/...`。

## 10. 交付前自检

- [ ] 所有读取、扫描都从调用方或窗口 ctx 派生
- [ ] 用户路径全部经过 `Canon` 和范围判断，没有前缀字符串判断
- [ ] UNC、重解析点、双重编码、越界都有单测
- [ ] 扫描有总量、文件数、深度三个上限，超限有明确返回值
- [ ] 读取有大小上限，非法 UTF-8 报错而不是乱码
- [ ] 元数据只写应用数据目录，原子写入，损坏时不覆盖
- [ ] 只读保证有哈希对比测试
- [ ] 日志、错误里没有正文和完整敏感路径
