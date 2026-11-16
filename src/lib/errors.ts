// Error code to user message, in one place (docs/开发计划.md §1, PRD §7.2).
// Go sends its own specific detail; this table covers what is left and gives
// every code a message even when the detail is generic.
const messages: Record<string, string> = {
  not_found: "文件不存在或已被移动",
  permission: "没有权限读取此文件",
  too_large: "文件超过读取上限",
  encoding: "暂不支持此文件编码，请转换为 UTF-8",
  unsupported_type: "只支持 .md 和 .markdown 文件",
  out_of_scope: "此路径不在允许的范围内",
  window_failed: "无法创建新窗口",
  request_expired: "这次打开请求已经处理过",
  no_folder: "尚未打开文件夹",
  scan_failed: "无法读取此文件夹",
  render_timeout: "渲染超时",
  queue_full: "打开请求太多，请稍后再试",
  no_frontend: "页面没有加载",
};

/** failureMessage prefers the detail Go sent, then the code's own message. */
export function failureMessage(code: string, detail?: string): string {
  return detail?.trim() || messages[code] || "操作失败";
}

/** formatBytes shows a size the way the status bar does. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
