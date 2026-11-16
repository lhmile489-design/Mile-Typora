# 绑定、契约与 Channel（Mile Typora，mygo v0.9.0）

## 目录

1. 绑定服务清单
2. 契约类型与错误码
3. 联合类型
4. Channel：目录扫描分批推送
5. 取消与迟到结果
6. 常见错误

## 1. 绑定服务清单

签名：`func Bind(services ...any)`、`func CallerWindow(ctx context.Context) *Window`、`func CallerPage(ctx context.Context) *Page`。

```go
mygo.Bind(service.WindowService{}, service.DocService{}, service.LinkService{}, service.SettingsService{})
```

| 服务 | 方法（建议） | 说明 |
| --- | --- | --- |
| `WindowService` | `Ready()`、`NewWindow()`、`Close()`、`OpenFileDialog()`、`OpenFolderDialog()`、`OpenRecent(id)`、`OpenInNewWindow(rel)` | 都用 `CallerWindow(ctx)` 定位发起窗口，按 FR-02 矩阵决定复用或新开 |
| `DocService` | `Scan(ch)`、`Load(req)`、`Refresh()` | 扫描走 Channel，读取渲染返回一次性结果 |
| `LinkService` | `ResolveLink(href)`、`OpenExternal(url)`、`OpenOutside(path)` | 文内链接分类与授权，外链交系统浏览器 |
| `SettingsService` | `Get()`、`Save(s)`、`Recent()`、`ClearRecent()`、`RemoveRecent(id)` | 应用级设置与最近记录 |

规则：

- 方法第一个参数是 `context.Context`（TS 侧不出现）。
- **前端只传相对路径或 token，不传绝对路径。** 例如 `Load({ rel: "docs/a.md", requestId })`，Go 用窗口上下文里的根目录拼接并校验。唯一的绝对路径入口是系统对话框和最近记录（由 Go 自己保存）。
- 服务结构体不放状态；状态在 `winctx.Registry` 和 `appstate.Store`。
- 改了导出方法、参数结构体、事件后运行 `mygo generate`，`git diff src/mygo.ts` 确认改动。

## 2. 契约类型与错误码

前端可见类型集中在 `internal/contract`。

v0.9.0 的 `mygo-runtime` 里 `CallError` 只有 `message` 和 `method`（`packages/runtime/src/index.ts`），带不了结构化错误码。所以分两类：

- **可预期的失败**（文件不存在、无权限、超限、编码不支持、越界、渲染超时、队列已满）放进返回值，类型安全：

```go
type Failure struct {
    Code   string `json:"code"`   // "not_found" | "permission" | "too_large" | "encoding" | "out_of_scope" | "unsupported_type" | "render_timeout" | "queue_full" ...
    Detail string `json:"detail"` // 给用户看的一句话，不含正文、不含未授权路径
    Size   int64  `json:"size,omitempty"`  // too_large 时的实际大小
    Limit  int64  `json:"limit,omitempty"`
}

type LoadResult struct {
    RequestID int64       `json:"requestId"`
    Doc       *RenderedDoc `json:"doc,omitempty"`
    Failure   *Failure     `json:"failure,omitempty"`
}
```

- **意外故障**（程序缺陷、窗口上下文丢失）才返回 Go `error`，前端收到 `CallError` 时显示通用错误并写日志。
- 错误码清单写进 `docs/develop/接口契约.md`，前端只映射清单内的码，未知码显示通用文案。
- 结果里需要的大小、行数用 `int64` / `int`；时间用 RFC 3339 字符串。

## 3. 联合类型

判别字段加可选字段的单结构体，生成的 TS 能用 `switch (x.kind)` 收窄。不要用 `any`，会生成 `unknown`。

```go
type LinkTarget struct {
    Kind     string `json:"kind"`               // "anchor" | "workspace" | "outside" | "external" | "blocked" | "attachment"
    Anchor   string `json:"anchor,omitempty"`
    Rel      string `json:"rel,omitempty"`      // 工作区内 Markdown 的相对路径
    Display  string `json:"display,omitempty"`  // 确认对话框里显示的路径或 URL
    Reason   string `json:"reason,omitempty"`   // blocked 时的原因码
}
```

## 4. Channel：目录扫描分批推送

签名：`type Channel[T any]`，`func (ch *Channel[T]) Send(v T) error`，`func (ch *Channel[T]) Close()`；关闭后 `Send` 返回 `ErrChannelClosed`。`Send` 在未消费超过 1 MiB 时阻塞（背压）。

```go
type ScanFrame struct {
    Kind      string          `json:"kind"`              // "batch" | "done"
    Nodes     []contract.Node `json:"nodes,omitempty"`   // 按父节点分组的增量
    Truncated bool            `json:"truncated,omitempty"`
    Partial   []string        `json:"partial,omitempty"` // 无法访问的相对目录
    Skipped   int             `json:"skipped,omitempty"` // 跳过的重解析入口数
}

func (DocService) Scan(ctx context.Context, ch *mygo.Channel[contract.ScanFrame]) error {
    wc, err := windowCtx(ctx)
    if err != nil { return err }
    sctx, cancel := mergeCtx(ctx, wc.Ctx) // 页面导航或关窗任一发生都停止
    defer cancel()
    return scan.Run(sctx, wc.Root, scan.Limits{Entries: 50000, Files: 10000, Depth: 64},
        func(f contract.ScanFrame) error { return ch.Send(f) })
}
```

- 每 500 条或每 100ms 发一批，保证首批 1 秒内到达（PRD 8.2）。
- 往下层只传 `func(ScanFrame) error`，不传 Channel 本身；`scan` 包不依赖 mygo，可直接单测。
- `Send` 返回错误说明页面不再读，立即返回。
- 读取单个文档不用 Channel：一次返回完整的渲染结果。

## 5. 取消与迟到结果

- 被动取消：页面导航、`channel.close()`、关窗都会取消调用 ctx。扫描、读取、渲染全部从它派生。
- 窗口 ctx：窗口级长任务（监听）挂在 `wc.Ctx`，关窗时取消。
- 迟到结果：`Load` 请求带前端生成的 `requestId`，Go 原样带回；前端只接受当前最新 `requestId`。Go 侧也可以在窗口上下文里记录最新 `requestId`，旧请求在渲染前检查后直接放弃，省掉无用的渲染。
- 证明有效：`winctx` 维护活动任务计数，测试里关窗后断言 5 秒内归零（PRD 8.2 资源释放）。

## 6. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| A 窗口显示了 B 窗口的文件 | 用了 `Broadcast`，或用前端传的窗口 ID 定位 | 一律 `CallerWindow(ctx)` + `EmitPage` |
| 越权读取 | 前端传了绝对路径并被直接使用 | 只接受相对路径或 token，Go 侧拼接校验 |
| 生成的 TS 字段是 `unknown` | Go 用了 `any` | 改成判别联合结构体 |
| generate 报找不到 mygo 包 | go.mod 缺 require | `go mod tidy` |
| 关窗后扫描仍在跑 | 用了 `context.Background()` | 从调用 ctx 和窗口 ctx 派生 |
| 快速切换后显示旧文件 | 没有 `requestId` 守卫 | 前端丢弃非最新结果 |
