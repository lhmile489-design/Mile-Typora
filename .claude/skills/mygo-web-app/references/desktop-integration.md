# 原生桌面集成（Mile Typora，mygo v0.9.0）

签名已对照 v0.9.0 源码。升级版本后先在源码里确认再用。

## 目录

1. 启动顺序与单实例
2. 多窗口：注册表、打开请求队列、就绪握手
3. 事件定向发送
4. 文件与目录对话框
5. 本地图片：自定义协议
6. 导航、外链与右键菜单
7. 快捷键：关掉 WebView 默认按键
8. 深浅外观与防白闪
9. 启动恢复（PRD FR-10）
10. 文件变更监听
11. 设计原则：可测的纯 Go 包

## 1. 启动顺序与单实例

```go
func main() {
    if !mygo.App.RequestSingleInstanceLock() { // 必须是第一个 mygo 调用
        return // 第二实例把参数转交给第一实例后退出
    }
    mygo.App.OnSecondInstance(func(args []string, wd string) {
        // 未来的文件关联 / 命令行打开：每个参数都是一个独立打开意图（PRD FR-10.8）
        go service.OpenFromArgs(args, wd)
    })

    if err := mygo.Protocol.Handle("mtres", resourceHandler()); err != nil { // 建窗前注册
        log.Fatal(err)
    }
    mygo.Theme.SetSource(themeFromSettings()) // 建窗前设置，首帧就是正确外观

    mygo.Bind(service.DocService{}, service.WindowService{}, service.SettingsService{})
    mygo.App.WhenReady(func() { service.Startup(os.Args[1:]) }) // 恢复上一份或空白页
    if err := mygo.App.Run(); err != nil { log.Fatal(err) }
}
```

- 签名：`func (a *Application) RequestSingleInstanceLock() bool`、`func (a *Application) OnSecondInstance(fn func(args []string, workingDir string)) (off func())`。
- 单实例是必需的：设置和最近记录由一个进程统一写入（PRD 8.4、9.2 第 8 条）。
- 不注册 `OnWindowAllClosed`：最后一个窗口关闭时应用自动退出，符合 PRD FR-02.8。P0 没有托盘。
- 第一实例自己的启动参数在 `os.Args`，两处都要处理。

## 2. 多窗口：注册表、打开请求队列、就绪握手

### 2.1 注册表

```go
// internal/winctx：不 import mygo
type WindowCtx struct {
    ID       int
    Mode     Mode            // Blank / SingleFile / Workspace
    Root     string          // 目录根或单文件路径（真实路径）
    Current  string          // 当前文档
    Ctx      context.Context // 关窗时取消
    cancel   context.CancelFunc
    queue    *Intents        // 有界 FIFO
}

type Registry struct {
    mu sync.Mutex
    m  map[int]*WindowCtx
    lastForeground int        // 启动恢复用（PRD FR-10.4）
}
```

`service` 层接线：

```go
win := mygo.NewWindow(mygo.WindowOptions{
    Title: "Mile Typora", URL: "/",
    Width: 1280, Height: 800, MinWidth: 960, MinHeight: 640, UseContentSize: true,
    BackgroundColor: bg,                           // 见第 8 节
    Page: mygo.PageOptions{DevTools: devToolsMode()},
})
wc := registry.Add(win.ID(), intent)
win.OnClosed(func() { registry.Remove(win.ID()) })   // 取消 wc.Ctx，释放监听引用
win.OnFocus(func() { registry.Foreground(win.ID()) })
hookPage(win.Page(), wc)                             // 第 6 节
```

- `func NewWindow(opts WindowOptions) *Window` 必须在 `App.WhenReady` 之后调用；`func (w *Window) ID() int`、`func WindowByID(id int) *Window`。
- `UseContentSize: true` 让 1280 × 800 指客户区（PRD 5.2 按客户区计算）。
- `StateKey` 只给启动时的第一个窗口，后续窗口按系统默认层叠位置打开。

### 2.2 打开请求队列

PRD 9.2 第 3 条：页面就绪前的打开请求不能丢，多次打开要有序处理。

```go
type Intents struct {
    mu      sync.Mutex
    ready   bool
    closed  bool
    pending []Intent // 上限 32
}

// Push 返回 true 表示已就绪，调用方可立即投递
func (q *Intents) Push(it Intent) (deliverNow bool, err error) {
    q.mu.Lock(); defer q.mu.Unlock()
    switch {
    case q.closed:              return false, ErrWindowClosed
    case q.ready:               return true, nil
    case len(q.pending) >= 32:  return false, ErrQueueFull // 发起窗口提示，不静默丢
    }
    q.pending = append(q.pending, it)
    return false, nil
}
func (q *Intents) Ready() []Intent  // ready=true，按序取出全部待投递意图
func (q *Intents) NotReady()        // ready=false
func (q *Intents) Requeue(it Intent) // 投递失败时放回队首
func (q *Intents) Close()           // closed=true，丢弃 pending
```

### 2.3 就绪握手

- 页面挂载、订阅完事件后调用 `WindowService.Ready(ctx)`：Go 用 `CallerWindow(ctx)` 找到窗口，取出队列按序 `EmitPage`。
- `page.OnWillNavigate`、`page.OnDidNavigate`、`page.OnDOMReady` 里调 `NotReady()`。注意 `OnWillNavigate` 不覆盖 `LoadURL` 和重载，所以三处都要挂。
- React 严格模式会挂载两次，`Ready` 必须可重复调用。
- 文件变更事件不入队：未就绪时只置"需要重新同步"，就绪后发一次 `resync`，页面重新拉取当前文档和树。

## 3. 事件定向发送

```go
var DocChanged = mygo.NewEvent[contract.DocChanged]("docChanged")
var TreeChanged = mygo.NewEvent[contract.TreeChanged]("treeChanged")
var OpenRequest = mygo.NewEvent[contract.OpenIntent]("openRequest")
var Resync = mygo.NewEvent[contract.Resync]("resync")
```

- 签名：`func (e *Event[T]) Emit(w *Window, payload T) error`、`EmitPage(p *Page, payload T) error`、`Broadcast(payload T) error`。
- 业务数据只用 `EmitPage(win.Page(), ...)`，**不用 `Broadcast`**。设置变更这类所有窗口都该知道的事，也遍历注册表逐个发，方便记录失败。
- `Emit` 返回错误说明窗口已关，停止向它发送并从订阅里移除。
- 事件名用纯字母数字，不以 `mygo:` 开头。

## 4. 文件与目录对话框

```go
paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
    Parent:  mygo.CallerWindow(ctx),
    Title:   "打开 Markdown 文件",
    Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown"}}},
})
// 目录：Directory: true；不设 Multiple 即单选（PRD FR-01.1、FR-03.1）
```

- 签名：`func (DialogModule) Open(opts OpenDialogOptions) ([]string, error)`。
- 取消选择返回空切片：不报错、不建窗、不写最近记录（PRD FR-01.5）。
- 过滤器只是方便，返回的路径仍要校验扩展名（大小写不敏感）并走 `pathguard`。
- 确认对话框（工作区外链接、外部站点）用前端的应用内对话框（DESIGN.md §8.12），不用 `Dialog.Message`，以便显示完整 URL 和统一样式。

## 5. 本地图片：自定义协议

```go
func resourceHandler() http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        win := mygo.CallerWindow(r.Context())
        if win == nil { http.NotFound(w, r); return }
        token := strings.TrimPrefix(r.URL.Path, "/")
        res, err := service.ResolveResource(win.ID(), token) // 授权校验 + 类型白名单 + 大小上限
        if err != nil { http.Error(w, err.Code(), http.StatusForbidden); return } // 不回传路径
        w.Header().Set("Content-Type", res.MIME)
        w.Header().Set("Cache-Control", "no-store")
        http.ServeContent(w, r, "", res.ModTime, res.File)
    })
}
```

- 渲染管线把 Markdown 里的相对图片改写成 `mtres://localhost/<token>`，Windows WebView2 上实际地址是 `http://mtres.localhost/<token>`（`protocol.go` 中 `schemeHosts`）。前端 CSP 的 `img-src` 要放行它。
- token 是渲染时登记的随机串，映射到"窗口 ID + 已校验的真实路径"。页面拿不到真实路径，也不能凭 token 访问其他窗口的资源。
- 每次请求仍要重新 `Lstat` 校验（文件可能在渲染后被替换成联接）。
- 只服务 PNG、JPEG、GIF、WebP，按文件头判断类型，不信扩展名；单图 20 MiB 上限（PRD 8.3）。SVG 一律拒绝（PRD FR-06.10）。
- 签名：`func (p *ProtocolModule) Handle(scheme string, handler http.Handler) error`，须在建窗前注册。

## 6. 导航、外链与右键菜单

```go
func hookPage(p *mygo.Page, wc *winctx.WindowCtx) {
    p.OnWillNavigate(func(e *mygo.NavigateEvent) {
        if !isAppOrigin(e.URL) { e.PreventDefault() } // 页面永远不离开应用（PRD FR-06.12）
        wc.Queue().NotReady()
    })
    p.OnDidNavigate(func(string) { wc.Queue().NotReady() })
    p.OnContextMenu(func(e *mygo.ContextMenuEvent) {
        if e.Menu != nil { e.Menu.Remove(mygo.ContextMenuReload, mygo.ContextMenuBack, mygo.ContextMenuForward, mygo.ContextMenuInspect) }
    })
}
```

- 应用来源：开发期是 `devUrl`（`http://localhost:<端口>`），构建后 Windows 上是 `http://mygo.localhost`。两者都放行，其余一律阻止。
- 外链：前端拦截 `<a>` 点击，调用 `LinkService.OpenExternal(ctx, url)`。Go 只接受 `http`、`https`，其余协议（`javascript:`、`data:`、`file:`、自定义协议）直接拒绝；确认对话框由前端显示，用户同意后 Go 调 `mygo.Shell.OpenExternal(url)`。
- 首次访问某来源的确认按窗口记忆（PRD FR-06.9），存在前端窗口状态里即可。

## 7. 快捷键：关掉 WebView 默认按键

- 生产构建 `PageOptions.DevTools = mygo.DevToolsDisabled`。源码 `internal/windows/webview.go` 显示它同时关闭 `AreBrowserAcceleratorKeysEnabled`，即 WebView2 自带的 F5、Ctrl+R 重载、Ctrl+P 打印、Ctrl+F 查找、Ctrl+加减号缩放都失效。
- 页面的 keydown 不受影响，`Ctrl+O`、`Ctrl+F`、`F5`、`Ctrl+W`、`Ctrl+,` 等由前端统一的快捷键模块处理，再调用绑定方法（`Ctrl+W` 调 `WindowService.Close`）。
- `Ctrl+S` 在 P0 只提示"当前版本仅支持阅读"并 `preventDefault`（PRD FR-09）。
- 开发构建用 `DevToolsAuto`（保留检查器）。此时 WebView 默认按键也开着，前端监听里照样 `preventDefault`，开发期行为与生产一致。
- 不用 `GlobalShortcut`：PRD FR-09 要求不注册全局快捷键。
- 编辑键（Ctrl+Z/X/C/V/A、Delete）由 WebView 保留给页面（`pageEditKey`），复制在只读正文里照常可用。

## 8. 深浅外观与防白闪

- P0 外观偏好：`system` / `light` / `dark`，首次默认 `system`（PRD C-12、FR-10.12）。保存后用 `EmitPage` 通知每个窗口切换，验收见 AC-29。
- 建窗前 `mygo.Theme.SetSource(mygo.ThemeSystem | ThemeLight | ThemeDark)`，签名 `func (t *ThemeModule) SetSource(s ThemeSource)`。
- 窗口 `BackgroundColor: "light-dark(#FFFFFF, #1C1D20)"`，与 DESIGN.md 的 `--bg-app` 一致。
- 页面：`index.html` 内联脚本按 `prefers-color-scheme` 写 `data-theme`，React 挂载后由偏好接管；`mygo.Theme.OnUpdated` 或页面的媒体查询变化时切换，并重新渲染 Mermaid。
- 修改外观偏好：先持久化，成功后再 `SetSource`，失败不改变当前外观。

## 9. 启动恢复（PRD FR-10）

- 恢复目标 = 注册表里最后一次"前台且有成功加载文档"的窗口的文档（`OnFocus` 和成功切换文档时更新），不按关窗顺序。
- 启动时只建一个窗口；恢复失败（不存在、无权限、超限、编码无效）回退空白页，并在空白页显示原因，不改用户的启动模式。
- 恢复时重新建立授权，正常走 `pathguard`、大小、编码检查。
- "新建窗口"永远空白。

## 10. 文件变更监听

v0.9.0 自带 `mygo.WatchFiles`（`watch.go`），优先用它而不是直接用 fsnotify：

```go
w, err := mygo.WatchFiles(wc.Ctx, root, mygo.FileWatchOptions{
    Recursive: true,
    Ignore: func(p string, isDir bool) bool { return false }, // PRD 不套用 .gitignore
    // Debounce 默认 50ms，MaxDelay 默认 500ms
})
for {
    events, err := w.Next(wc.Ctx) // 批量事件；io.EOF 表示关闭或根目录消失
    ...
}
```

- 签名：`func WatchFiles(ctx context.Context, path string, opts FileWatchOptions) (*FileWatcher, error)`。
- 事件是"再读一次"的提示，不是精确操作记录；原子替换保存报告为写入（适配 PRD FR-07.2）。
- Windows 上 `MaxEntries` 默认 8192（`watch_entries_other.go`），超过时返回 `mygo.ErrWatchLimit`。PRD 的扫描上限是 5 万条目，可以把 `MaxEntries` 设成 50000，但内存和句柄占用要在 M1 实测后再定。监听失败或超限时降级：状态栏提示"自动刷新不可用，请手动刷新"，F5 仍可用（PRD 8.2 外部变更一栏）。
- 写入稳定：收到批次后再等 200ms 并比较两次 `Stat`（大小与修改时间）一致才读取，避免读到半截文件。
- 单文件模式监听其父目录（`WatchFiles` 对单文件本来就是通过目录监听），只关心该文件的事件。
- 同一路径的监听在注册表里按引用计数共享，最后一个窗口释放时 `Close`。
- 目录结构另用 `watch.StartTree`（main 注入 `TreeWatcher` 池）：`Recursive: true`、`Debounce 200ms`、`MaxDelay 1s`、`MaxEntries 32768`，只上报新建 / 删除 / 改名，普通写入交给文件监听。数量超限时启动失败，只记日志，页面仍可用 F5。
- 监听以 `io.EOF` 结束时发 `Gone`：文件监听 `Gone`，以及目录监听 `Gone`，都要触发一次文档重读，否则父目录被删/改名后旧正文不会被标过期（AC-12）。目录 `Gone` 同时发 `tree-changed`，页面重扫失败时保留上一次树行并提示不可用。
- 页面侧对 `tree-changed` 防抖 250ms；重扫保留当前文档、阅读位置与仍存在的选中项。失败帧不能清空可用树。
- 请求队列满等"不阻断"的问题用 `app-notice` 事件（`{text}`）送到状态栏，不能只写日志（PRD §9.2.4）。

## 11. 设计原则：可测的纯 Go 包

队列、注册表、窗口行为矩阵、恢复目标选择、资源 token 表都放 `internal/winctx`，不 import mygo，原生调用通过函数参数注入。`service` 只做接线。边界条件（重复就绪、关窗后再投递、队列满、A、B、A 三窗口前台切换后的恢复目标）全部用 `go test` 覆盖；原生行为只在真实窗口里验收。
