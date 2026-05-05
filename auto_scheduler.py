from __future__ import annotations

import logging
from datetime import datetime, time
from threading import Lock

logger = logging.getLogger(__name__)

DB_KEY_AUTO_ENABLED = "auto_enabled"
DB_KEY_WINDOW_START = "auto_window_start"
DB_KEY_WINDOW_END = "auto_window_end"
DB_KEY_DAILY_TARGET = "auto_daily_target"
DB_KEY_BRUSH_DATE = "auto_brush_date"
DB_KEY_BRUSH_SECONDS = "auto_brush_seconds"

DEFAULT_WINDOW_START = "06:00"
DEFAULT_WINDOW_END = "23:00"
DEFAULT_DAILY_TARGET = 0


class AutoScheduler:
    """Time-window checks, daily counter persistence, start/stop decisions.

    Owned by the GUI thread.  The bot thread only calls ``add_watched_seconds``
    during video playback.
    """

    def __init__(self, db_proxy):
        self._db = db_proxy
        self._lock = Lock()
        self._today_date = ""
        self._daily_watched_seconds = 0
        self.enabled = False
        self.window_start = DEFAULT_WINDOW_START
        self.window_end = DEFAULT_WINDOW_END
        self.daily_target_minutes = DEFAULT_DAILY_TARGET
        self._load_from_db()

    # ------------------------------------------------------------------
    # Public API — GUI thread
    # ------------------------------------------------------------------

    def configure(self, *, enabled, window_start, window_end, daily_target_minutes):
        with self._lock:
            self.enabled = enabled
            self.window_start = window_start or DEFAULT_WINDOW_START
            self.window_end = window_end or DEFAULT_WINDOW_END
            self.daily_target_minutes = daily_target_minutes

    def should_auto_start(self, bot_is_running):
        if not self.enabled:
            return False
        if bot_is_running:
            return False
        if not self._is_in_time_window():
            return False
        self._ensure_day_rollover()
        target_seconds = self.daily_target_minutes * 60
        if target_seconds > 0 and self._daily_watched_seconds >= target_seconds:
            return False
        return True

    def should_auto_stop(self, bot_is_running, *, was_auto_started=False):
        if not bot_is_running:
            return False
        if not self.enabled and was_auto_started:
            return True
        if not self._is_in_time_window():
            return True
        self._ensure_day_rollover()
        target_seconds = self.daily_target_minutes * 60
        if target_seconds > 0 and self._daily_watched_seconds >= target_seconds:
            return True
        return False

    def get_daily_watched_minutes(self):
        self._ensure_day_rollover()
        with self._lock:
            return self._daily_watched_seconds / 60.0

    # ------------------------------------------------------------------
    # Public API — bot thread
    # ------------------------------------------------------------------

    def add_watched_seconds(self, seconds):
        with self._lock:
            self._daily_watched_seconds += seconds

    def on_video_completed(self, db_proxy=None):
        self._ensure_day_rollover()
        self._persist(db_proxy or self._db)

    def load_for_bot(self, db_proxy=None):
        self._load_from_db(db_proxy or self._db)
        return self._daily_watched_seconds

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _today_str():
        return datetime.now().strftime("%Y-%m-%d")

    @staticmethod
    def _now_time():
        return datetime.now().time()

    def _is_in_time_window(self):
        try:
            start_h, start_m = map(int, self.window_start.split(":"))
            end_h, end_m = map(int, self.window_end.split(":"))
        except (ValueError, AttributeError):
            return True

        start = time(start_h, start_m)
        end = time(end_h, end_m)
        now = self._now_time()

        if start <= end:
            return start <= now < end
        else:
            return now >= start or now < end

    def _ensure_day_rollover(self):
        today = self._today_str()
        if self._today_date != today:
            logger.info(
                "Day rollover: %s -> %s, resetting daily progress",
                self._today_date or "(none)",
                today,
            )
            with self._lock:
                self._today_date = today
                self._daily_watched_seconds = 0
            self._persist()

    def _load_from_db(self, db_proxy=None):
        db = db_proxy or self._db
        self._today_date = db.get_setting(DB_KEY_BRUSH_DATE, "")
        raw_seconds = db.get_setting(DB_KEY_BRUSH_SECONDS, "0")
        try:
            self._daily_watched_seconds = int(raw_seconds)
        except (ValueError, TypeError):
            self._daily_watched_seconds = 0

        self.enabled = db.get_setting(DB_KEY_AUTO_ENABLED, "") == "true"
        self.window_start = db.get_setting(DB_KEY_WINDOW_START, DEFAULT_WINDOW_START)
        self.window_end = db.get_setting(DB_KEY_WINDOW_END, DEFAULT_WINDOW_END)
        raw_target = db.get_setting(DB_KEY_DAILY_TARGET, str(DEFAULT_DAILY_TARGET))
        try:
            self.daily_target_minutes = int(raw_target)
        except (ValueError, TypeError):
            self.daily_target_minutes = DEFAULT_DAILY_TARGET

        self._ensure_day_rollover()

    def _persist(self, db_proxy=None):
        db = db_proxy or self._db
        try:
            db.set_setting(DB_KEY_BRUSH_DATE, self._today_date)
            db.set_setting(DB_KEY_BRUSH_SECONDS, str(self._daily_watched_seconds))
        except Exception:
            logger.warning("Failed to persist daily progress", exc_info=True)
