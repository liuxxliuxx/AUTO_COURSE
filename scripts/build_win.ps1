# ZhiHuiShu Auto Course - Windows Build Script (pyinstaller)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Internal name: English only (used for directories, exe, paths)
$APP_NAME = "ZhiHuiShu_AutoCourse"
$DIST_DIR = "dist"
$WORK_DIR = "build_win_tmp"

Write-Host "==> Installing/updating dependencies..." -ForegroundColor Cyan
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Check and download Chrome for Testing
$BIN_DIR = "bin"
$CHROME_EXE = "$BIN_DIR\chrome-win64\chrome.exe"
$CHROMEDRIVER_EXE = "$BIN_DIR\chromedriver-win64\chromedriver.exe"

if (-not (Test-Path $CHROME_EXE) -or -not (Test-Path $CHROMEDRIVER_EXE)) {
    Write-Host "==> Chrome for Testing not found, downloading..." -ForegroundColor Cyan
    python scripts/download_chrome.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Chrome for Testing download failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "==> Chrome for Testing already exists, skipping download" -ForegroundColor Cyan
}

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
    --icon assets/icon.ico `
    --add-data "${BIN_DIR};${BIN_DIR}" `
    --hidden-import keyring.backends.Windows `
    --hidden-import keyring.backends.null `
    --hidden-import keyring.backends.chainer `
    --hidden-import certifi `
    --hidden-import urllib3 `
    --hidden-import selenium `
    --hidden-import selenium.webdriver `
    --hidden-import selenium.webdriver.chrome `
    --hidden-import selenium.webdriver.chrome.webdriver `
    --hidden-import selenium.webdriver.chrome.options `
    --hidden-import selenium.webdriver.chrome.service `
    --hidden-import selenium.webdriver.common `
    --hidden-import selenium.webdriver.common.by `
    --hidden-import selenium.webdriver.common.action_chains `
    --hidden-import selenium.webdriver.common.keys `
    --hidden-import selenium.webdriver.remote `
    --hidden-import selenium.webdriver.remote.webdriver `
    --hidden-import selenium.webdriver.support `
    --hidden-import selenium.webdriver.support.ui `
    --hidden-import selenium.webdriver.support.expected_conditions `
    --hidden-import selenium.common `
    --hidden-import selenium.common.exceptions `
    --hidden-import src `
    --hidden-import src.constants `
    --hidden-import src.bot `
    --hidden-import src.bot.bot_core `
    --hidden-import src.bot.browser `
    --hidden-import src.bot.video `
    --hidden-import src.bot.quiz `
    --hidden-import src.bot.captcha `
    --hidden-import src.bot.course `
    --hidden-import src.bot.login `
    --hidden-import src.bot.login.base `
    --hidden-import src.bot.login.zhihuishu `
    --hidden-import src.bot.login.upc `
    --hidden-import src.ui `
    --hidden-import src.ui.log_handler `
    --hidden-import src.utils `
    --hidden-import src.utils.element_finder `
    --hidden-import src.transcriber `
    --hidden-import src.transcriber.audio_capture `
    --hidden-import src.transcriber.transcription_worker `
    --hidden-import src.transcriber.transcription_manager `
    --hidden-import requests `
    --hidden-import sounddevice `
    --hidden-import numpy `
    --hidden-import gui `
    --hidden-import gui.app `
    --hidden-import gui.bridge `
    --add-data "gui/qml;gui/qml" `
    --hidden-import PySide6 `
    --hidden-import PySide6.QtCore `
    --hidden-import PySide6.QtGui `
    --hidden-import PySide6.QtWidgets `
    --hidden-import PIL `
    --hidden-import PIL.Image `
    --hidden-import PIL.ImageFilter `
    --collect-submodules webdriver_manager `
    --collect-submodules selenium `
    --collect-submodules PySide6 `
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

Write-Host ""
Write-Host "==> Done: $DIST_DIR\$APP_NAME\$APP_NAME.exe" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "  - Output is a directory (--onedir), not a single .exe" -ForegroundColor Yellow
Write-Host "  - Chrome for Testing is bundled -- no need to install Chrome" -ForegroundColor Yellow
Write-Host "  - Distribute the entire '$DIST_DIR\$APP_NAME\' folder" -ForegroundColor Yellow
