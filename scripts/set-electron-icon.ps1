# 给 dev 用的 electron.exe 换应用图标。rcedit 直改原文件常因占用/签名提交失败，
# 走「副本改好再换名」；换名带重试（Windows 删除/改名有句柄延迟释放窗口）。
# 需先完全关闭应用。打包版图标由 electron-builder 管，与此无关。
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root "node_modules\electron\dist\electron.exe"
$tmp = Join-Path $root "node_modules\electron\dist\electron_icon.tmp.exe"
$icon = Join-Path $root "src-tauri\icons\icon.ico"
$rcedit = Join-Path $root "node_modules\rcedit\bin\rcedit-x64.exe"

Copy-Item $exe $tmp -Force
& $rcedit $tmp --set-icon $icon
if ($LASTEXITCODE -ne 0) {
  Write-Host "rcedit 对副本也失败，放弃（打包版图标不受影响）" -ForegroundColor Yellow
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  exit 1
}

$done = $false
for ($i = 0; $i -lt 20 -and -not $done; $i++) {
  try {
    Remove-Item $exe -Force -ErrorAction Stop
    $done = $true
  } catch {
    Start-Sleep -Milliseconds 300
  }
}
if (-not $done) {
  Write-Host "原 electron.exe 删不掉（仍被占用？先关掉应用再跑）" -ForegroundColor Red
  exit 1
}
for ($i = 0; $i -lt 20; $i++) {
  try {
    Rename-Item $tmp "electron.exe" -ErrorAction Stop
    Write-Host "electron.exe 图标已替换为 VxAPO 图标" -ForegroundColor Green
    exit 0
  } catch {
    Start-Sleep -Milliseconds 300
  }
}
Write-Host "换名重试超时" -ForegroundColor Red
exit 1
