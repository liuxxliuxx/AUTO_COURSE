# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

智慧树 (ZhiHuiShu) auto-course-watching bot. Automates browser-based video playback on the Zhihuishu online education platform, handling login, quiz popups, and CAPTCHA interruptions. Has a Tkinter GUI for configuration and control.

## Running

```bash
# Activate conda env (named "zhihuishu") or .venv
python main.py          # Launches the Tkinter GUI
```

No test suite, no linter, no type checker is currently configured.

## Building

### Prerequisites

Before the first build, download Chrome for Testing (bundled into the package so target PCs don't need Chrome installed):

```bash
python scripts/download_chrome.py
```

This downloads ~150MB of Chrome + ChromeDriver matching a specific version into `bin/`.

### macOS

```bash
./scripts/build_mac.sh        # py2app, outputs dist/智慧树自动刷课.app
```

Uses `scripts/setup_mac.py` (py2app config). The script auto-copies missing @rpath dylibs from the Python installation.

### Windows

```powershell
.\scripts\build_win.ps1        # pyinstaller, outputs dist/智慧树自动刷课/
```

One-directory mode (--onedir), windowed (no console). The script auto-runs `download_chrome.py` if `bin/` is missing.

### Creating an installer (Windows)

```powershell
.\scripts\create_installer.ps1           # NSIS installer (requires NSIS installed)
.\scripts\create_installer.ps1 -Portable # Portable zip with shortcut script
```

The installer creates a desktop shortcut and Start Menu entry.

## Architecture

```
src/
├── constants.py                  # All CSS selectors, timeouts, URLs, intervals
├── config.py                     # DB path, keyring key names
├── db/
│   └── database.py               # SQLite CRUD (no business logic)
├── bot/
│   ├── bot_core.py               # ZhiHuiShuBot orchestrator (main loop)
│   ├── browser.py                # Chrome driver factory
│   ├── video.py                  # VideoController: play/pause/progress
│   ├── quiz.py                   # QuizHandler: detect/answer/close popups
│   ├── captcha.py                # CaptchaHandler: detect + notify GUI
│   ├── course.py                 # CourseNavigator: navigate, parse video list
│   └── login/
│       ├── base.py               # LoginStrategy ABC
│       ├── zhihuishu.py          # Direct phone-number login
│       └── upc.py                # UPC SSO login (Vue JS injection)
├── ui/
│   └── log_handler.py            # QueueLogHandler (logging → Tkinter)
└── utils/
    └── element_finder.py         # Multi-selector fallback find_element()
```

- **[main.py](main.py)** — Tkinter GUI entry point. `ZhiHuiShuGUI` owns UI, spawns bot on daemon thread, bridges logging/CAPTCHA via `threading.Event`.
- **[src/bot/bot_core.py](src/bot/bot_core.py)** — Orchestrator that composes sub-modules. `run()` flow: init driver → login → navigate → iterate videos → cleanup. Accepts 8 hook callbacks (`on_bot_start`, `on_video_end`, etc.) for external extensibility.
- **[src/db/database.py](src/db/database.py)** — SQLite wrapper. Stores URL history and key-value settings. Auto-creates tables and migrates on first use.
- **[src/config.py](src/config.py)** — Platform-appropriate DB path + keyring config.

## Login methods

Two strategies, selectable from the GUI, both implementing `LoginStrategy`:

1. **zhihuishu** — `ZhihuishuLogin`: phone + password form → Yidun slider CAPTCHA
2. **upc** — `UPCLogin`: SSO via `i.upc.edu.cn`, injects credentials into Vue component via JS → redirects to course center

## Key details

- Database (`course_progress.db`) stored in platform user data directory, not app bundle.
- Credentials persisted via system keyring (service: `zhihuishu_auto_course`).
- Video completion: CSS class `.time_icofinish` on `li.video`. When "跳过已学课程" is unchecked, all videos are processed regardless.
- Quiz popups polled every 2s, CAPTCHA every 30s during video monitoring.
- Browser: bundled Chrome for Testing in `bin/` preferred. Falls back to system chromedriver → webdriver-manager if bundle absent.
- Quiz answering uses `AnswerStrategy` protocol — default `RandomAnswerStrategy`, swappable via `QuizHandler(answer_strategy=...)`.
- All CSS selectors / timeouts / URLs live in `src/constants.py` — platform DOM changes only need updates there.
