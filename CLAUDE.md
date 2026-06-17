# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

智慧树 (ZhiHuiShu) auto-course-watching bot. Automates browser-based video playback on the Zhihuishu online education platform, handling login, quiz popups, and CAPTCHA interruptions. Tkinter GUI for configuration and control.

## Running

```bash
# Activate conda env named "zhihuishu"
# Use full path to conda python, e.g.:
/c/Users/liuxx/anaconda3/envs/zhihuishu/python.exe main.py
```

No test suite, linter, or type checker is configured.

## Building

### Windows

```powershell
.\scripts\build_win.ps1        # pyinstaller --onedir, outputs dist/ZhiHuiShu_AutoCourse/
.\scripts\create_installer.ps1           # NSIS installer (requires NSIS installed)
.\scripts\create_installer.ps1 -Portable # Portable zip with shortcut script
```

Build script auto-runs `download_chrome.py` if `bin/` is missing. Output is an English-named directory (Chinese paths break NSIS).

### macOS

```bash
./scripts/build_mac.sh        # py2app, outputs dist/ZhiHuiShu_AutoCourse.app + DMG
```

Uses `setup_mac.py` (project root, py2app config). Script auto-downloads Chrome for Testing and copies root-level modules into the bundle.

## Architecture

```
main.py                         # Tkinter GUI + auto-scheduler (ZhiHuiShuGUI, ~600 lines)
database.py                     # SQLite wrapper (root level, not src/db/)
config.py                       # Platform DB path resolver + keyring keys
src/
├── constants.py                # All CSS selectors, timeouts, URLs, polling intervals
├── bot/
│   ├── bot_core.py             # ZhiHuiShuBot orchestrator (main loop, 8 hooks)
│   ├── browser.py              # Chrome driver factory (3-tier priority)
│   ├── video.py                # VideoController: play/pause/progress
│   ├── quiz.py                 # QuizHandler + AnswerStrategy protocol
│   ├── captcha.py              # CaptchaHandler: detect + notify GUI via Event
│   ├── course.py               # CourseNavigator + get_next_video_after()
│   └── login/
│       ├── base.py             # LoginStrategy ABC
│       ├── zhihuishu.py        # Direct phone-number login
│       └── upc.py              # UPC SSO login (Vue JS injection)
└── ui/
    └── log_handler.py          # QueueLogHandler (logging → Tkinter queue)
```

## Key mechanisms

### Threading model

- **GUI thread**: owns tk widgets, polls via `root.after()` timers (200ms logs, 500ms captcha, 30s auto-scheduler)
- **Bot thread**: daemon `threading.Thread(target=bot.run)`, communicates via `threading.Event` (captcha_needed, captcha_done, stop_event) and `queue.Queue` (logging)
- `self.running` boolean only touched by GUI thread
- Bot hooks (`on_video_end`, `on_bot_stop`) run in bot thread — they write DB progress but must NOT touch tk widgets directly

### Auto-scheduler (`main.py:ZhiHuiShuGUI`)

`_auto_scheduler_tick()` → `root.after(30000)` perpetually. Logic in `_auto_scheduler_evaluate()`:

- **Start conditions**: auto_mode ON, bot not running, time in range (or "全天" checked), today's watched < time_limit
- **Stop conditions**: bot running AND (time out of range OR today's watched >= time_limit)
- **Natural completion**: detected when `self.running` True but `bot_thread.is_alive()` False
- If natural completion with <60s progress → course pool exhausted → auto-uncheck auto_mode
- `_stop_bot()` with `auto_uncheck=True` (user/manual stop) also unchecks auto_mode; scheduler calls with `auto_uncheck=False` (temporary stops — keeps auto_mode for next day)

### Video iteration (`bot_core.py` + `course.py`)

Uses `get_next_video_after(current_title)` on `CourseNavigator` — detects current position from DOM class `li.video.current_play`, then searches downward for next eligible video (respecting `skip_completed`). Wraps around to head when at end. This means if the user manually clicks a different course during auto-play, the next video will be the one *below* the user-clicked one.

### Progress tracking

- `bot_core._accumulate_duration()` uses actual monitor-loop elapsed time (not video DOM duration), so progress-bar dragging doesn't inflate the counter
- `on_video_end` hook (wired in `main.py:_start_bot`) writes delta to `daily_progress` table via `database.add_daily_progress()`
- `_auto_scheduler_evaluate()` reloads from DB each tick and updates the "今日已刷课时长" label

### Captcha flow

- `CaptchaHandler._notify_and_wait()`: sets `captcha_needed` Event → GUI `_check_captcha_status()` (500ms poll) shows red status + enables confirm button
- User clicks "没有需确认的验证码" → `_on_confirm_captcha()` sets `captcha_done` → bot resumes
- On stop: `_stop_bot()` sets `stop_event` but does NOT set `captcha_done` (doing so would make the captcha loop mistake stop for user confirmation). The captcha loop checks `_should_stop()` every 1s and exits cleanly

### Database schema

- `url_history(url_type, url, note, used_at)` — URL autocomplete history, UNIQUE(type, url)
- `settings(key PRIMARY KEY, value)` — key-value config persistence
- `daily_progress(date TEXT PRIMARY KEY, watched_seconds INTEGER)` — per-day brush time, UPSERT-incremented

### Login methods (GUI dropdown)

Two strategies selectable from dropdown "登录方式" between "登录跳转URL" and "课程视频URL":
1. **智慧树** — `ZhihuishuLogin`: phone + password → Yidun slider CAPTCHA
2. **数字石大** — `UPCLogin`: SSO via `i.upc.edu.cn`, injects credentials into Vue component via JS

When auto-mode checked, dropdown grays out (auto-mode always uses UPC).

### CSS selectors

All in `src/constants.py`. Key ones:
- `VIDEO_LIST_ITEM_CSS = "li.video"`, `VIDEO_CURRENT_PLAY_CSS = "li.video.current_play"`, `VIDEO_FINISHED_MARK_CSS = ".time_icofinish"`
- Platform DOM changes only need updates in constants.py

### Status messages

| State | Status text | Color |
|---|---|---|
| Idle | ● 就绪 | gray |
| Initializing | ● 正在初始化（登录方式）... | green |
| Brushing | ● 正在刷课 | green |
| Captcha | ⚠ 检测到验证码 — 请在浏览器中完成验证 | red |
| Manual stop | ● 已停止 | red |
| Auto target reached | ● 今日自动刷课已到目标时长 | orange |
| Auto out of range | ● 不在允许运行时间内 | orange |

## Paths and conda

- Conda env: `zhihuishu` at `/c/Users/liuxx/anaconda3/envs/zhihuishu/`
- Python: `/c/Users/liuxx/anaconda3/envs/zhihuishu/python.exe` (Windows `python` cmd may point to MS Store stub)
