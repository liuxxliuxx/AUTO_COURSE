# ZhiHuiShu Auto Course - Installer Generator
#
# Prerequisite: run build_win.ps1 first to generate dist/ZhiHuiShu_AutoCourse/
#
# Usage:
#   .\scripts\create_installer.ps1              # NSIS installer (requires NSIS)
#   .\scripts\create_installer.ps1 -Portable    # Portable zip

param(
    [switch]$Portable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$APP_NAME = "ZhiHuiShu_AutoCourse"
$DISPLAY_NAME = "智慧树自动刷课"

$DIST_DIR = "dist"
$APP_DIR = "$DIST_DIR\$APP_NAME"
$APP_EXE = "$APP_DIR\$APP_NAME.exe"
$OUTPUT_DIR = "$DIST_DIR\installer"

if (-not (Test-Path $APP_EXE)) {
    Write-Host "ERROR: Build output not found: $APP_EXE" -ForegroundColor Red
    Write-Host "Run .\scripts\build_win.ps1 first" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR -Force | Out-Null
}

Write-Host "==> Generating installer for: $DISPLAY_NAME" -ForegroundColor Cyan

if ($Portable) {
    # ========================================================================
    # Portable: zip + shortcut creation batch script
    # ========================================================================

    Write-Host "Creating portable zip..."

    $batContent = @"
@echo off
chcp 65001 >nul
set SCRIPT_DIR=%~dp0
powershell -Command "^
    `$WshShell = New-Object -ComObject WScript.Shell;^
    `$Shortcut = `$WshShell.CreateShortcut('%USERPROFILE%\Desktop\$DISPLAY_NAME.lnk');^
    `$Shortcut.TargetPath = '%SCRIPT_DIR%$APP_NAME.exe';^
    `$Shortcut.IconLocation = '%SCRIPT_DIR%$APP_NAME.exe';^
    `$Shortcut.Save()"
echo Desktop shortcut for $DISPLAY_NAME created.
pause
"@

    $batPath = "$APP_DIR\CreateShortcut.bat"
    $batContent | Out-File -FilePath $batPath -Encoding ASCII

    $zipPath = "$OUTPUT_DIR\${APP_NAME}-portable.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    Compress-Archive -Path "$APP_DIR\*" -DestinationPath $zipPath -Force

    Write-Host ""
    Write-Host "==> Done: $zipPath" -ForegroundColor Green
    Write-Host "    Unzip and run CreateShortcut.bat to create desktop shortcut" -ForegroundColor Green
} else {
    # ========================================================================
    # NSIS installer
    # ========================================================================

    $nsisExe = $null
    foreach ($loc in @(
        "C:\Program Files (x86)\NSIS\makensis.exe",
        "C:\Program Files\NSIS\makensis.exe",
        "$env:LOCALAPPDATA\Programs\NSIS\makensis.exe"
    )) {
        if (Test-Path $loc) { $nsisExe = $loc; break }
    }

    if (-not $nsisExe) {
        Write-Host "NSIS not found, falling back to portable mode..." -ForegroundColor Yellow
        Write-Host "Install NSIS from: https://nsis.sourceforge.io/Download" -ForegroundColor Yellow
        & $PSCommandPath -Portable
        return
    }

    Write-Host "Using NSIS: $nsisExe"

    # Use absolute paths to avoid NSIS relative-path resolution issues
    $installerOut = (Resolve-Path "$OUTPUT_DIR").Path + "\${APP_NAME}-setup.exe"
    $appDirAbs = (Resolve-Path $APP_DIR).Path

    # Generate .nsi via Python (handles UTF-8 BOM encoding correctly)
    python scripts/generate_nsi.py $appDirAbs $installerOut
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to generate NSIS script" -ForegroundColor Red
        exit 1
    }

    # Compile
    $nsiPath = $installerOut -replace '\.exe$', '.nsi'
    Write-Host "Compiling NSIS installer..."
    & $nsisExe $nsiPath
    Remove-Item $nsiPath

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: NSIS compilation failed" -ForegroundColor Red
        exit 1
    }

    if (Test-Path $installerOut) {
        $sizeMB = [math]::Round((Get-Item $installerOut).Length / 1MB, 1)
        Write-Host ""
        Write-Host "==> Done: $installerOut ($sizeMB MB)" -ForegroundColor Green
        Write-Host "    Double-click to install, desktop shortcut auto-created" -ForegroundColor Green
    }
}
