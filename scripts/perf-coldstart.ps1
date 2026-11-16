param(
  [string]$Exe = "build\windows-amd64\Mile Typora.exe",
  [int]$Runs = 5
)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$rows = @()
for ($i = 1; $i -le $Runs; $i++) {
  $err = Join-Path $env:TEMP ("mile-perf-" + $i + ".log")
  $out = Join-Path $env:TEMP ("mile-perf-" + $i + ".out")
  Remove-Item $err, $out -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $env:MILE_PERF = $err
  $p = Start-Process -FilePath (Resolve-Path $Exe) -RedirectStandardError $err -RedirectStandardOutput $out -PassThru
  Remove-Item Env:MILE_PERF
  for ($t = 0; $t -lt 500; $t++) {
    if (Test-Path $err) {
      $hit = Select-String -Path $err -Pattern 'perf: ready' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) { break }
    }
    Start-Sleep -Milliseconds 20
  }
  $sw.Stop()
  $readyMs = $null
  if (Test-Path $err) {
    $hit = Select-String -Path $err -Pattern 'perf: ready window=(\d+) ms=(\d+)' | Select-Object -First 1
    if ($hit -and $hit.Matches.Count -gt 0) { $readyMs = [int]$hit.Matches[0].Groups[2].Value }
  }
  $rows += [pscustomobject]@{ run = $i; wallMs = $sw.ElapsedMilliseconds; readyMs = $readyMs }
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-windows.ps1 -Action close -Count 1 | Out-Null
  if (-not $p.WaitForExit(5000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
}
$rows | Format-Table -AutoSize
