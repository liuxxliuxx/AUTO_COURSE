"""
QML 后端桥接器 —— QObject 暴露给 QML 上下文。

通过 PySide6 Signal/Slot/Property 机制与 QML 前端通信，
同时管理 Bot 生命周期和自动调度器。
"""

import logging
import os
import queue
import threading
import time as _time
from datetime import datetime, time as dt_time

from PySide6.QtCore import QObject, QTimer, Signal, Slot

from config import KEYRING_PASSWORD_KEY, KEYRING_SERVICE, KEYRING_USERNAME_KEY
from database import Database
from src.bot.bot_core import ZhiHuiShuBot
from src.constants import (
    AUTO_SCHEDULER_INTERVAL_MS,
    GUI_CAPTCHA_POLL_MS,
    GUI_LOG_POLL_MS,
    GUI_TRANSCRIBE_POLL_MS,
    UPC_BASE_URL,
    ZHIHUISHU_BASE_URL,
)
from src.ui.log_handler import QueueLogHandler

logger = logging.getLogger(__name__)


class ThreadBridge(QObject):
    """跨线程桥接器：Python ↔ QML。

    暴露给 QML 的接口：
      - Signals: logReceived, botStarted, botStopped, transcribeStatusChanged,
                 captchaDetected, coursesLoaded
      - Slots: toggle_running(), confirm_captcha(), save_setting(key, value),
               get_setting(key) -> str, browse_directory() -> str
    """

    # ── Signals (Python → QML) ──
    logReceived = Signal(str)
    statusChanged = Signal(str, str)
    botStarted = Signal(str)
    botStopped = Signal(str)
    transcribeStatusChanged = Signal("QVariantMap")
    captchaDetected = Signal(str)
    captchaCleared = Signal()
    coursesLoaded = Signal("QVariantList")

    def __init__(self, parent=None):
        super().__init__(parent)

        self.db = Database()

        # ── Cross-thread primitives ──
        self.log_queue = queue.Queue()
        self.transcribe_queue = queue.Queue()
        self.captcha_needed = threading.Event()
        self.captcha_done = threading.Event()
        self.stop_event = threading.Event()

        # ── Bot state ──
        self._bot = None
        self._bot_thread = None
        self._running = False
        self._transcribe_only = False
        self._last_recorded_seconds = 0
        self._todays_watched_seconds = 0
        self._today_date = _time.strftime("%Y-%m-%d")

        # ── Auto-scheduler state ──
        self._auto_mode = self.db.get_setting("auto_mode", "0") == "1"
        self._auto_allday = self.db.get_setting("auto_allday", "0") == "1"
        self._auto_start_time = self.db.get_setting("auto_start_time", "06:00")
        self._auto_end_time = self.db.get_setting("auto_end_time", "23:00")
        self._auto_time_limit = self._parse_int(
            self.db.get_setting("auto_limit", self.db.get_setting("time_limit", "0")),
            0,
        )

        # ── Log handler ──
        self._queue_handler = QueueLogHandler(self.log_queue)
        logging.getLogger().addHandler(self._queue_handler)

        # ── QTimers ──
        self._log_timer = QTimer(self)
        self._log_timer.setInterval(GUI_LOG_POLL_MS)
        self._log_timer.timeout.connect(self._poll_log)

        self._captcha_timer = QTimer(self)
        self._captcha_timer.setInterval(GUI_CAPTCHA_POLL_MS)
        self._captcha_timer.timeout.connect(self._poll_captcha)

        self._transcribe_timer = QTimer(self)
        self._transcribe_timer.setInterval(GUI_TRANSCRIBE_POLL_MS)
        self._transcribe_timer.timeout.connect(self._poll_transcribe)

        self._scheduler_timer = QTimer(self)
        self._scheduler_timer.setInterval(AUTO_SCHEDULER_INTERVAL_MS)
        self._scheduler_timer.timeout.connect(self._auto_scheduler_evaluate)

        self._log_timer.start()
        self._captcha_timer.start()
        self._transcribe_timer.start()
        self._scheduler_timer.start()

        self._todays_watched_seconds = self.db.get_daily_progress(self._today_date)

        # ── Initial course load ──
        self._load_courses()

    # ══════════════════════════════════════════════════════════════════
    # Slots (QML → Python)
    # ══════════════════════════════════════════════════════════════════

    @Slot()
    def toggle_running(self):
        """启动或停止 Bot。"""
        if self._running:
            self._stop_bot()
        else:
            self._start_bot(auto_start=self._auto_mode)

    @Slot()
    def confirm_captcha(self):
        self.captcha_done.set()
        self.captcha_needed.clear()
        self.captchaCleared.emit()

    @Slot(str, str)
    def save_setting(self, key: str, value: str):
        key = self._setting_key(key)
        value = "" if value is None else str(value)

        if key == "username":
            self._keyring_set(KEYRING_USERNAME_KEY, value)
            return
        if key == "password":
            self._keyring_set(KEYRING_PASSWORD_KEY, value)
            return
        if key == "login_method":
            value = "upc" if value in ("upc", "数字石大") else "zhihuishu"

        self.db.set_setting(key, value)

        if key == "logged_url":
            self.db.save_url_history("logged", value)
        elif key in ("video_url", "course_note"):
            self._save_current_course()
        elif key == "auto_mode":
            self._auto_mode = value == "1"
        elif key == "auto_allday":
            self._auto_allday = value == "1"
        elif key == "auto_start_time":
            self._auto_start_time = value or "06:00"
        elif key == "auto_end_time":
            self._auto_end_time = value or "23:00"
        elif key == "auto_limit":
            self._auto_time_limit = self._parse_int(value, 0)

    @Slot(str, result=str)
    def get_setting(self, key: str) -> str:
        key = self._setting_key(key)
        if key == "username":
            return self._keyring_get(KEYRING_USERNAME_KEY)
        elif key == "password":
            return self._keyring_get(KEYRING_PASSWORD_KEY)
        elif key == "login_method":
            raw = self.db.get_setting("login_method", "zhihuishu")
            return "数字石大" if raw in ("upc", "数字石大") else "智慧树"
        elif key == "logged_url":
            return self._get_logged_url()
        elif key == "video_url":
            return self._current_course()[0]
        elif key == "course_note":
            return self._current_course()[1]
        return self.db.get_setting(key, self._default_setting(key))

    @Slot(result="QVariantList")
    def get_courses(self):
        return self._course_items()

    @Slot(result=str)
    def browse_directory(self) -> str:
        from PySide6.QtWidgets import QFileDialog
        return QFileDialog.getExistingDirectory(None, "选择目录") or ""

    @Slot(str, result=str)
    def browse_file(self, kind: str) -> str:
        from PySide6.QtWidgets import QFileDialog

        if kind == "chromedriver":
            title = "Select ChromeDriver"
            file_filter = "ChromeDriver (chromedriver chromedriver.exe);;All files (*)"
        elif kind == "image":
            title = "Select image"
            file_filter = "Images (*.png *.jpg *.jpeg *.bmp *.webp);;All files (*)"
        else:
            title = "Select Chrome"
            file_filter = "Chrome (chrome.exe *.app);;All files (*)"

        path, _ = QFileDialog.getOpenFileName(None, title, "", file_filter)
        if not path:
            return ""
        if kind == "chrome":
            return self._normalize_chrome_path(path)
        return path

    @Slot(result="QVariantMap")
    def auto_detect_chrome(self):
        from src.bot.browser import (
            _find_cached_chrome,
            _find_cached_chromedriver,
            _find_system_chrome,
            _find_system_chromedriver,
        )

        chrome = _find_system_chrome() or _find_cached_chrome() or ""
        driver = _find_system_chromedriver() or _find_cached_chromedriver() or ""

        if chrome:
            self.db.set_setting("chrome_binary", chrome)
        if driver:
            self.db.set_setting("chromedriver_binary", driver)

        if chrome and driver:
            status = "Detected Chrome and ChromeDriver"
        elif chrome:
            status = "Detected Chrome; ChromeDriver will be resolved on start"
        elif driver:
            status = "Detected ChromeDriver; Chrome will be resolved on start"
        else:
            status = "No local Chrome/ChromeDriver found; start will try auto-download"

        return {"chrome": chrome, "driver": driver, "status": status}

    @Slot(str, str)
    def course_selected(self, url: str, note: str):
        if url:
            self.db.set_setting("video_url", url)
            self.db.set_setting("course_note", note or "")
            self.db.save_url_history("video", url, note)

    # ══════════════════════════════════════════════════════════════════
    # Bot lifecycle
    # ══════════════════════════════════════════════════════════════════

    def _start_bot(self, auto_start=False):
        if self._running:
            return

        login_method = (
            "upc"
            if auto_start or self.get_setting("login_method") == "数字石大"
            else "zhihuishu"
        )
        username = self._keyring_get(KEYRING_USERNAME_KEY)
        password = self._keyring_get(KEYRING_PASSWORD_KEY)
        logged_url = self._get_logged_url()
        video_url, course_note = self._current_course()

        time_limit = self._parse_int(self.db.get_setting("time_limit", "0"), 0)
        transcribe_enabled = self.db.get_setting("transcribe_enabled", "0") == "1"
        transcribe_dir = self.db.get_setting("transcribe_base_dir", "")
        chrome_binary = self.db.get_setting("chrome_binary", "").strip() or None
        chromedriver_binary = (
            self.db.get_setting("chromedriver_binary", "").strip() or None
        )
        brush_enabled = self.db.get_setting("brush_enabled", "1") == "1"
        self._transcribe_only = not brush_enabled

        error = self._validate_start(
            login_method=login_method,
            username=username,
            password=password,
            logged_url=logged_url,
            video_url=video_url,
            transcribe_only=self._transcribe_only,
            transcribe_dir=transcribe_dir,
            brush_enabled=brush_enabled,
            transcribe_enabled=transcribe_enabled,
        )
        if error:
            self.statusChanged.emit("⚠ " + error, "danger")
            return

        from_last = self.db.get_setting("from_last_progress", "0") == "1"
        last_title = ""
        if from_last and course_note:
            last_title, _ = self.db.get_course_progress(course_note)
            last_title = last_title or ""

        if login_method == "upc":
            base_url = UPC_BASE_URL
        else:
            base_url = ZHIHUISHU_BASE_URL

        enable_transcribe = transcribe_enabled or self._transcribe_only

        self.statusChanged.emit("● 正在初始化...", "success")
        self._running = True
        self.stop_event.clear()
        self.captcha_needed.clear()
        self.captcha_done.clear()

        self._bot = ZhiHuiShuBot(
            base_url=base_url, username=username, password=password,
            logged_url=logged_url, video_url=video_url, login_method=login_method,
            time_limit_minutes=0 if auto_start or self._transcribe_only else time_limit,
            skip_completed=self.db.get_setting("skip_completed", "1") == "1",
            captcha_event=self.captcha_needed, captcha_done_event=self.captcha_done,
            stop_event=self.stop_event,
            enable_transcription=enable_transcribe and bool(transcribe_dir),
            transcribe_base_dir=transcribe_dir, course_note=course_note,
            transcribe_status_queue=self.transcribe_queue,
            from_last_progress=from_last and bool(last_title),
            last_video_title=last_title,
            transcribe_only=self._transcribe_only,
            chrome_binary=chrome_binary,
            chromedriver_binary=chromedriver_binary,
        )

        captured = self._bot

        def _on_start():
            mode = "仅转录" if self._transcribe_only else "刷课"
            self.botStarted.emit(mode)

        def _on_video_end(title, success):
            if self._transcribe_only:
                return
            delta = captured.total_watched_seconds - self._last_recorded_seconds
            if delta > 0:
                self._last_recorded_seconds = captured.total_watched_seconds
                today = _time.strftime("%Y-%m-%d")
                self.db.add_daily_progress(today, int(delta))
                self._todays_watched_seconds += int(delta)

        def _on_bot_stop():
            if not self._transcribe_only:
                delta = captured.total_watched_seconds - self._last_recorded_seconds
                if delta > 0:
                    self._last_recorded_seconds = captured.total_watched_seconds
                    today = _time.strftime("%Y-%m-%d")
                    self.db.add_daily_progress(today, int(delta))
                    self._todays_watched_seconds += int(delta)

        self._bot.on_bot_start = _on_start
        self._bot.on_video_end = _on_video_end
        self._bot.on_bot_stop = _on_bot_stop
        self._bot._on_course_progress_updated = (
            lambda cn, vt: self.db.save_course_progress(cn, vt)
        )

        self._last_recorded_seconds = 0
        self._bot_thread = threading.Thread(target=self._bot.run, daemon=True)
        self._bot_thread.start()

    def _stop_bot(self):
        self._running = False
        self.stop_event.set()
        self.captcha_needed.clear()
        label = "转录已停止" if self._transcribe_only else "已停止"
        self.botStopped.emit(label)

    # ══════════════════════════════════════════════════════════════════
    # Polling
    # ══════════════════════════════════════════════════════════════════

    def _poll_log(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.logReceived.emit(msg)
        except queue.Empty:
            pass

    def _poll_captcha(self):
        if self._running and self.captcha_needed.is_set():
            self.captchaDetected.emit("检测到验证码，请在浏览器中完成验证")

    def _poll_transcribe(self):
        try:
            while True:
                status = self.transcribe_queue.get_nowait()
                self.transcribeStatusChanged.emit(status)
        except queue.Empty:
            pass

    # ══════════════════════════════════════════════════════════════════
    # Auto scheduler
    # ══════════════════════════════════════════════════════════════════

    @staticmethod
    def _time_in_range(now: dt_time, start_str: str, end_str: str) -> bool:
        try:
            sh, sm = map(int, start_str.strip().split(":"))
            eh, em = map(int, end_str.strip().split(":"))
        except (ValueError, AttributeError):
            return True
        start = dt_time(sh, sm)
        end = dt_time(eh, em)
        if start <= end:
            return start <= now <= end
        return now >= start or now <= end

    def _auto_scheduler_evaluate(self):
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        now_time = now.time()

        if self._today_date != today:
            self._today_date = today
            self._todays_watched_seconds = self.db.get_daily_progress(today)

        bot_alive = self._bot_thread is not None and self._bot_thread.is_alive()

        if self._running and not bot_alive:
            self._running = False
            if self._last_recorded_seconds < 60 and self._auto_mode:
                self._auto_mode = False
                self.db.set_setting("auto_mode", "0")
            self.botStopped.emit("已完成")

        self._todays_watched_seconds = self.db.get_daily_progress(today)

        if not self._auto_mode:
            return

        try:
            target_seconds = self._auto_time_limit * 60
        except (ValueError, TypeError):
            target_seconds = 0

        in_range = self._auto_allday or self._time_in_range(
            now_time, self._auto_start_time, self._auto_end_time
        )

        if bot_alive:
            if not in_range:
                self.statusChanged.emit("● 不在允许运行时间内", "warning")
                self._stop_bot()
            elif target_seconds > 0 and self._todays_watched_seconds >= target_seconds:
                self.statusChanged.emit("● 今日目标已完成", "warning")
                self._stop_bot()
        else:
            if not in_range or target_seconds <= 0:
                return
            if self._todays_watched_seconds >= target_seconds:
                return
            self._start_bot(auto_start=True)

    # ══════════════════════════════════════════════════════════════════
    # Helpers
    # ══════════════════════════════════════════════════════════════════

    @staticmethod
    def _normalize_chrome_path(path: str) -> str:
        if not path:
            return ""
        if path.endswith(".app"):
            app_name = os.path.splitext(os.path.basename(path))[0]
            candidates = [
                os.path.join(path, "Contents", "MacOS", app_name),
                os.path.join(path, "Contents", "MacOS", "Google Chrome"),
                os.path.join(path, "Contents", "MacOS", "Google Chrome for Testing"),
            ]
            for candidate in candidates:
                if os.path.exists(candidate):
                    return candidate
        return path

    def _load_courses(self):
        self.coursesLoaded.emit(self._course_items())

    def _course_items(self):
        items = []
        seen = set()
        current_url, current_note = self._current_course()
        if current_url:
            items.append(self._course_item(current_url, current_note))
            seen.add(current_url)
        for url, note in self.db.get_url_history("video"):
            if url in seen:
                continue
            items.append(self._course_item(url, note))
            seen.add(url)
        return items

    @staticmethod
    def _course_item(url, note):
        note = (note or "").strip()
        display = f"{note} · {url}" if note else url
        return {"url": url, "note": note, "display": display}

    def _current_course(self):
        video_url = self.db.get_setting("video_url", "").strip()
        course_note = self.db.get_setting("course_note", "").strip()
        if video_url:
            return video_url, course_note or self.db.get_note_for_url(video_url)

        video_history = self.db.get_url_history("video", limit=1)
        if video_history:
            return video_history[0][0], video_history[0][1]
        return "", course_note

    def _save_current_course(self):
        video_url = self.db.get_setting("video_url", "").strip()
        course_note = self.db.get_setting("course_note", "").strip()
        if video_url:
            self.db.save_url_history("video", video_url, course_note)
            self._load_courses()

    def _get_logged_url(self):
        logged_url = self.db.get_setting("logged_url", "").strip()
        if logged_url:
            return logged_url
        logged_history = self.db.get_url_history("logged", limit=1)
        return logged_history[0][0] if logged_history else ""

    @staticmethod
    def _setting_key(key):
        aliases = {
            "transcribe_dir": "transcribe_base_dir",
            "auto_start": "auto_start_time",
            "auto_end": "auto_end_time",
            "blur_radius": "bg_blur_radius",
        }
        return aliases.get(key, key)

    @staticmethod
    def _default_setting(key):
        defaults = {
            "brush_enabled": "1",
            "skip_completed": "1",
            "from_last_progress": "0",
            "transcribe_enabled": "0",
            "auto_mode": "0",
            "auto_start_time": "06:00",
            "auto_end_time": "23:00",
            "auto_allday": "0",
            "auto_limit": "0",
            "bg_blur_radius": "40",
            "chrome_binary": "",
            "chromedriver_binary": "",
        }
        return defaults.get(key, "")

    @staticmethod
    def _parse_int(value, default=0):
        try:
            return int(str(value or "").strip())
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _validate_start(
        login_method,
        username,
        password,
        logged_url,
        video_url,
        transcribe_only,
        transcribe_dir,
        brush_enabled,
        transcribe_enabled,
    ):
        if not brush_enabled and not transcribe_enabled:
            return "请至少开启刷课或语音转文字"
        if not username.strip():
            return "账号不能为空"
        if not password:
            return "密码不能为空"
        if not video_url.strip():
            return "课程视频 URL 不能为空"
        if login_method == "upc" and not logged_url.strip():
            return "数字石大登录需要填写登录跳转 URL"
        if transcribe_only and not transcribe_dir.strip():
            return "仅转录模式需要先设置保存路径"
        return ""

    @staticmethod
    def _keyring_get(key):
        try:
            import keyring
            return keyring.get_password(KEYRING_SERVICE, key) or ""
        except Exception:
            return ""

    @staticmethod
    def _keyring_set(key, value):
        try:
            import keyring
            keyring.set_password(KEYRING_SERVICE, key, value or "")
        except Exception:
            logger.exception("Failed to write keyring value for %s", key)
