# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

智慧树 (ZhiHuiShu) auto-course-watching bot. Automates browser-based video playback on the Zhihuishu online education platform, handling login, quiz popups, and CAPTCHA interruptions. Has a Tkinter GUI for configuration and control.

## Running

```bash
source .venv/bin/activate
python main.py          # Launches the Tkinter GUI
```

No test suite, no linter, no type checker is currently configured.

## Building

### macOS

```bash
./scripts/build_mac.sh        # py2app, outputs dist/智慧树自动刷课.app
```

Uses `scripts/setup_mac.py` (py2app config). The script auto-copies missing @rpath dylibs from the Python installation.

### Windows

```powershell
.\scripts\build_win.ps1        # pyinstaller, outputs dist/智慧树自动刷课.exe
```

One-directory mode (--onedir), windowed (no console).

## Architecture

- **[main.py](main.py)** — Tkinter GUI entry point. `ZhiHuiShuGUI` owns the UI, spawns a bot on a daemon thread, and bridges logging/CAPTCHA-events between the bot thread and the GUI via `threading.Event` primitives.
- **[zhihuishu_bot.py](zhihuishu_bot.py)** — Core Selenium automation. `ZhiHuiShuBot.run()` is the main loop: launch Chrome → login → navigate to course → iterate unfinished videos → monitor playback. Quiz popups are answered randomly and closed. CAPTCHA detections notify the GUI thread via shared `threading.Event` objects so the user can solve them manually in the browser.
- **[database.py](database.py)** — SQLite wrapper (`Database` class). Stores URL history (per login type) and key-value app settings. Automatically creates tables and migrates missing columns on first use.

- **[config.py](config.py)** — Resolves `DB_PATH` to platform-appropriate user data directory (`~/Library/Application Support/`, `%APPDATA%`, `~/.local/share/`). Sensitive config (credentials) is stored via the system keyring.

## Login methods

Two paths, selectable from the GUI:
1. **zhihuishu** — Direct login at `onlineweb.zhihuishu.com`, fills a phone-number + password form, then handles a NetEase Yidun slider CAPTCHA.
2. **upc** — SSO via `i.upc.edu.cn` (数字石大). Fills username/password in a Vant UI form inside an iframe, then navigates to the course-center app via a hardcoded `forward_url`.

## Key details

- Database file (`course_progress.db`) is stored in the platform user data directory, not the app bundle.
- Credentials are persisted via the system keyring (service name: `zhihuishu_auto_course`), not in plaintext.
- Video completion is determined by checking for `.time_icofinish` CSS class on `li.video` items, not by database state.
- The bot polls for quiz popups every 2 seconds and CAPTCHA every 30 seconds during video monitoring.
- ChromeDriver is auto-managed by `webdriver-manager` — no manual path configuration needed.
