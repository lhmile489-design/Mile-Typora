<#
.SYNOPSIS
  Counts, lists or closes the visible top-level windows of a running app, for
  the native acceptance of a stage (docs/开发计划.md §1.2 step 8).

.DESCRIPTION
  The automation tools cannot see a native window, so this asks Windows
  directly: EnumWindows for the windows of the process, and WM_CLOSE to close
  one the way the user's close button does.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-windows.ps1 -Action count
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-windows.ps1 -Action close -Count 2
#>
param(
  [ValidateSet('count', 'close')][string]$Action = 'count',
  [int]$Count = 1,
  [string]$Name = 'Mile Typora Dev'
)

$ErrorActionPreference = 'Stop'

if (-not ('MtNativeWindows' -as [type])) {
  Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class MtNativeWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> Handles(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) {
        var sb = new StringBuilder(256);
        GetWindowTextW(h, sb, 256);
        if (sb.Length > 0) found.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string Title(IntPtr h) {
    var sb = new StringBuilder(256);
    GetWindowTextW(h, sb, 256);
    return sb.ToString();
  }
  public static bool Close(IntPtr h) { return PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@
}

$proc = Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "process $Name is not running"; exit 1 }

$handles = [MtNativeWindows]::Handles([uint32]$proc.Id)
Write-Output ("pid=" + $proc.Id + " windows=" + $handles.Count)
foreach ($h in $handles) { Write-Output ("  " + [MtNativeWindows]::Title($h)) }

if ($Action -eq 'close') {
  $toClose = [Math]::Min($Count, $handles.Count)
  for ($i = 0; $i -lt $toClose; $i++) {
    $h = $handles[$handles.Count - 1 - $i]
    [void][MtNativeWindows]::Close($h)
    Start-Sleep -Milliseconds 800
  }
  Start-Sleep -Seconds 2
  if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) {
    $left = [MtNativeWindows]::Handles([uint32]$proc.Id).Count
    Write-Output ("closed=$toClose alive=true windows=" + $left)
  } else {
    Write-Output ("closed=$toClose alive=false")
  }
}
