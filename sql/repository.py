from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from sql.models import Base, Setting, URLHistory
from sql.orm import make_engine, make_session_factory


class SQLAlchemyRepository:
    DEFAULT_LOGGED_URL = "https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/ai-course-center"

    def __init__(self, db_path: str | None = None):
        self.engine = make_engine(db_path)
        self.Session = make_session_factory(self.engine)
        self._auto_migrate()
        self._ensure_default_url()

    def _auto_migrate(self):
        Base.metadata.create_all(self.engine)

    def _ensure_default_url(self):
        with self.Session() as session:
            exists = session.execute(
                select(URLHistory.id).where(URLHistory.url_type == "logged").limit(1)
            ).scalar_one_or_none()
            if exists is None:
                row = URLHistory(url_type="logged", url=self.DEFAULT_LOGGED_URL, note="")
                session.add(row)
                session.commit()

    def get_setting(self, key: str, default: str = "") -> str:
        with self.Session() as session:
            row = session.get(Setting, key)
            return row.value if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self.Session() as session:
            stmt = sqlite_insert(Setting).values(key=key, value=value)
            stmt = stmt.on_conflict_do_update(index_elements=[Setting.key], set_={"value": value})
            session.execute(stmt)
            session.commit()

    def save_url_history(self, url_type: str, url: str, note: str = "") -> None:
        if not url:
            return
        now = datetime.utcnow()
        with self.Session() as session:
            stmt = sqlite_insert(URLHistory).values(url_type=url_type, url=url, note=note, used_at=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=[URLHistory.url_type, URLHistory.url],
                set_={"note": note, "used_at": now},
            )
            session.execute(stmt)
            session.commit()

    def get_url_history(self, url_type: str, limit: int = 20):
        with self.Session() as session:
            rows = session.execute(
                select(URLHistory.url, URLHistory.note)
                .where(URLHistory.url_type == url_type)
                .order_by(URLHistory.used_at.desc())
            ).all()

        seen = set()
        result = []
        for url, note in rows:
            if url in seen:
                continue
            seen.add(url)
            result.append((url, note or ""))
            if len(result) >= limit:
                break
        return result

    def get_note_for_url(self, url: str) -> str:
        if not url:
            return ""
        with self.Session() as session:
            row = session.execute(
                select(URLHistory.note)
                .where(URLHistory.url_type == "video", URLHistory.url == url)
                .order_by(URLHistory.used_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            return row or ""

    def close(self) -> None:
        self.engine.dispose()
