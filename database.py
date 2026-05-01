import sqlite3
from datetime import datetime
from config import DB_PATH


class Database:
    def __init__(self, db_path=None):
        self.db_path = db_path or DB_PATH
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._init_tables()

    def _init_tables(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS completed_courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_title TEXT UNIQUE NOT NULL,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS url_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url_type TEXT NOT NULL,
                url TEXT NOT NULL,
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
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

    def save_url_history(self, url_type, url):
        """Record a URL usage. url_type is 'logged' or 'video'."""
        if not url:
            return
        self.conn.execute(
            "INSERT INTO url_history (url_type, url) VALUES (?, ?)",
            (url_type, url),
        )
        self.conn.commit()

    def get_url_history(self, url_type, limit=20):
        """Return distinct recent URLs for a given type, newest first."""
        cursor = self.conn.execute(
            "SELECT url FROM url_history WHERE url_type = ? "
            "GROUP BY url "
            "ORDER BY MAX(used_at) DESC LIMIT ?",
            (url_type, limit),
        )
        return [row[0] for row in cursor.fetchall()]

    # ---------- course tracking ----------

    def is_completed(self, course_title):
        cursor = self.conn.execute(
            "SELECT 1 FROM completed_courses WHERE course_title = ?",
            (course_title,),
        )
        return cursor.fetchone() is not None

    def mark_completed(self, course_title):
        self.conn.execute(
            "INSERT OR IGNORE INTO completed_courses (course_title, completed_at) VALUES (?, ?)",
            (course_title, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        self.conn.commit()

    def close(self):
        self.conn.close()
