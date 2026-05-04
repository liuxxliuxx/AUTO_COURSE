import sqlite3

from config import DB_PATH


class Database:
    def __init__(self, db_path=None):
        self.db_path = db_path or DB_PATH
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._init_tables()

    DEFAULT_LOGGED_URL = "https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/ai-course-center"

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
        self.conn.commit()
        # Migrate pre-existing databases: add note column if missing
        try:
            self.conn.execute(
                "ALTER TABLE url_history ADD COLUMN note TEXT DEFAULT ''"
            )
        except Exception:
            pass  # Column already exists
        # Ensure UNIQUE constraint exists even on pre-existing databases
        self.conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_url_history_type_url "
            "ON url_history(url_type, url)"
        )
        self.conn.commit()
        # Pre-populate default logged URL if no history exists
        self._ensure_default_url()

    def _ensure_default_url(self):
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM url_history WHERE url_type = 'logged'"
        )
        if cursor.fetchone()[0] == 0:
            self.conn.execute(
                "INSERT INTO url_history (url_type, url) VALUES (?, ?)",
                ("logged", self.DEFAULT_LOGGED_URL),
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
        """Record a URL usage. url_type is 'logged' or 'video'.
        If the (url_type, url) pair already exists, update used_at and note."""
        if not url:
            return
        self.conn.execute(
            "INSERT OR REPLACE INTO url_history (url_type, url, note, used_at) "
            "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            (url_type, url, note),
        )
        self.conn.commit()

    def get_url_history(self, url_type, limit=20):
        """Return distinct recent (url, note) tuples for a given type, newest first."""
        cursor = self.conn.execute(
            "SELECT url, note FROM url_history WHERE url_type = ? "
            "GROUP BY url "
            "ORDER BY MAX(used_at) DESC LIMIT ?",
            (url_type, limit),
        )
        return [(row[0], row[1] or "") for row in cursor.fetchall()]

    def get_note_for_url(self, url):
        """Look up the note for a specific video URL. Returns '' if not found."""
        if not url:
            return ""
        cursor = self.conn.execute(
            "SELECT note FROM url_history WHERE url_type = 'video' AND url = ?",
            (url,),
        )
        row = cursor.fetchone()
        return row[0] if row else ""

    def close(self):
        self.conn.close()
