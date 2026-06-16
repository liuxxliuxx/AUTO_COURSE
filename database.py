"""
数据库访问层 —— 仅负责 SQLite 的 CRUD 操作，不包含业务逻辑或业务默认值。
"""

import sqlite3
import time

from config import DB_PATH
from src.constants import DEFAULT_LOGGED_URL


class Database:
    """SQLite 数据库封装，管理 URL 历史和键值设置。"""

    def __init__(self, db_path=None):
        self.db_path = db_path or DB_PATH
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._init_tables()

    def _init_tables(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS url_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url_type TEXT NOT NULL,
                url TEXT NOT NULL,
                note TEXT DEFAULT '',
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(url_type, url)
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_progress (
                date TEXT PRIMARY KEY,
                watched_seconds INTEGER NOT NULL DEFAULT 0
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS course_progress (
                course_note TEXT PRIMARY KEY,
                last_video_title TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        self.conn.commit()

        # 兼容旧库：补充可能缺失的字段和约束
        self._migrate_schema()

    def _migrate_schema(self):
        """兼容旧版本数据库的字段和约束迁移。"""
        try:
            self.conn.execute(
                "ALTER TABLE url_history ADD COLUMN note TEXT DEFAULT ''"
            )
        except Exception:
            pass  # 字段已存在
        self.conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_url_history_type_url "
            "ON url_history(url_type, url)"
        )
        self.conn.commit()
        self._ensure_default_url()

    def _ensure_default_url(self):
        """如果 logged 类型无历史记录，预填充默认课程中心 URL。"""
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM url_history WHERE url_type = 'logged'"
        )
        if cursor.fetchone()[0] == 0:
            self.conn.execute(
                "INSERT INTO url_history (url_type, url) VALUES (?, ?)",
                ("logged", DEFAULT_LOGGED_URL),
            )
            self.conn.commit()

    # ---------- app settings ----------

    def get_setting(self, key, default=""):
        cursor = self.conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        )
        row = cursor.fetchone()
        return row[0] if row else default

    def set_setting(self, key, value):
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        self.conn.commit()

    # ---------- URL history ----------

    def save_url_history(self, url_type, url, note=""):
        """记录 URL 使用历史。url_type: 'logged' 或 'video'。"""
        if not url:
            return
        self.conn.execute(
            "INSERT OR REPLACE INTO url_history (url_type, url, note, used_at) "
            "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            (url_type, url, note),
        )
        self.conn.commit()

    def get_url_history(self, url_type, limit=20):
        """获取指定类型的 URL 历史，按最近使用排序。"""
        cursor = self.conn.execute(
            "SELECT url, note FROM url_history WHERE url_type = ? "
            "GROUP BY url "
            "ORDER BY MAX(used_at) DESC LIMIT ?",
            (url_type, limit),
        )
        return [(row[0], row[1] or "") for row in cursor.fetchall()]

    def get_note_for_url(self, url):
        """根据视频 URL 查询备注，未找到返回空字符串。"""
        if not url:
            return ""
        cursor = self.conn.execute(
            "SELECT note FROM url_history WHERE url_type = 'video' AND url = ?",
            (url,),
        )
        row = cursor.fetchone()
        return row[0] if row else ""

    # ---------- daily progress ----------

    def get_daily_progress(self, date_str):
        """返回指定日期（YYYY-MM-DD）的已观看秒数，无记录返回 0。"""
        cursor = self.conn.execute(
            "SELECT watched_seconds FROM daily_progress WHERE date = ?",
            (date_str,),
        )
        row = cursor.fetchone()
        return row[0] if row else 0

    def add_daily_progress(self, date_str, seconds_delta):
        """原子递增指定日期的已观看秒数（UPSERT）。"""
        self.conn.execute(
            "INSERT INTO daily_progress (date, watched_seconds) VALUES (?, ?) "
            "ON CONFLICT(date) DO UPDATE SET watched_seconds = watched_seconds + ?",
            (date_str, seconds_delta, seconds_delta),
        )
        self.conn.commit()

    # ---------- course progress (per-course last completed video) ----------

    def get_course_progress(self, course_note):
        """获取指定课程的上次完成进度。

        Returns:
            (last_video_title, updated_at) 或 (None, None)
        """
        if not course_note:
            return None, None
        cursor = self.conn.execute(
            "SELECT last_video_title, updated_at FROM course_progress "
            "WHERE course_note = ?",
            (course_note,),
        )
        row = cursor.fetchone()
        return (row[0], row[1]) if row else (None, None)

    def save_course_progress(self, course_note, video_title):
        """保存课程的最后完成视频标题。"""
        if not course_note or not video_title:
            return
        self.conn.execute(
            "INSERT OR REPLACE INTO course_progress (course_note, last_video_title, updated_at) "
            "VALUES (?, ?, datetime('now'))",
            (course_note, video_title),
        )
        self.conn.commit()

    def close(self):
        self.conn.close()
