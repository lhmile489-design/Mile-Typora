$ids = @(Get-Process 'Mile Typora Dev' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$wv = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*Mile Typora Dev*' } |
  Select-Object -ExpandProperty ProcessId)
$all = @($ids + $wv) | Select-Object -Unique
if ($all.Count -eq 0) {
  0
} else {
  (Get-Process -Id $all -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum
}
