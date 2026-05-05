from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sql.config import DB_PATH


def make_engine(db_path: str | None = None):
    path = db_path or DB_PATH
    return create_engine(f"sqlite:///{path}", future=True)


def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
