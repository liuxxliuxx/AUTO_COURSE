# 智慧树自动刷课 - Windows 构建脚本 (pyinstaller)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$APP_NAME = "智慧树自动刷课"
$DIST_DIR = "dist"

Write-Host "==> Installing pyinstaller..." -ForegroundColor Cyan
pip install pyinstaller

Write-Host "==> Building with pyinstaller..." -ForegroundColor Cyan
pyinstaller --onefile --windowed --name $APP_NAME main.py

Write-Host "==> Done: $DIST_DIR\$APP_NAME.exe" -ForegroundColor Green
