from __future__ import annotations

from sql.repository import SQLAlchemyRepository


class DatabaseProxy:
    """Proxy object to decouple callers from ORM details."""

    def __init__(self, repo: SQLAlchemyRepository | None = None, db_path: str | None = None):
        self._repo = repo or SQLAlchemyRepository(db_path=db_path)

    def get_setting(self, key, default=""):
        return self._repo.get_setting(key, default)

    def set_setting(self, key, value):
        self._repo.set_setting(key, value)

    def save_url_history(self, url_type, url, note=""):
        self._repo.save_url_history(url_type, url, note)

    def get_url_history(self, url_type, limit=20):
        return self._repo.get_url_history(url_type, limit)

    def get_note_for_url(self, url):
        return self._repo.get_note_for_url(url)

    def close(self):
        self._repo.close()
