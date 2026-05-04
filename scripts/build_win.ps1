# 智慧树自动刷课 - Windows 构建脚本 (pyinstaller)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$APP_NAME = "智慧树自动刷课"
$DIST_DIR = "dist"
$WORK_DIR = "build_win_tmp"

Write-Host "==> Installing/updating dependencies..." -ForegroundColor Cyan
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Clean previous output
if (Test-Path $DIST_DIR) {
    Remove-Item -Recurse -Force $DIST_DIR
}
if (Test-Path $WORK_DIR) {
    Remove-Item -Recurse -Force $WORK_DIR
}

Write-Host "==> Building with pyinstaller (onedir, windowed)..." -ForegroundColor Cyan
pyinstaller `
    --onedir `
    --windowed `
    --name $APP_NAME `
    --distpath $DIST_DIR `
    --workpath $WORK_DIR `
    --clean `
    --noconfirm `
    --hidden-import keyring.backends.Windows `
    --hidden-import keyring.backends.null `
    --hidden-import keyring.backends.chainer `
    --hidden-import certifi `
    --hidden-import selenium.webdriver.chrome.options `
    --hidden-import selenium.webdriver.chrome.service `
    --collect-submodules webdriver_manager `
    main.py

# Clean up work dir and .spec file
Write-Host "==> Cleaning up..." -ForegroundColor Cyan
if (Test-Path $WORK_DIR) {
    Remove-Item -Recurse -Force $WORK_DIR
}
$specFile = "${APP_NAME}.spec"
if (Test-Path $specFile) {
    Remove-Item -Force $specFile
}

Write-Host "==> Done: $DIST_DIR\$APP_NAME\$APP_NAME.exe" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "  - Output is a directory (--onedir), not a single .exe" -ForegroundColor Yellow
Write-Host "  - Chrome must be installed on the target system" -ForegroundColor Yellow
Write-Host "  - chromedriver is auto-managed by webdriver-manager at runtime" -ForegroundColor Yellow
