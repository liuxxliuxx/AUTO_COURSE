from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class URLHistory(Base):
    __tablename__ = "url_history"
    __table_args__ = (UniqueConstraint("url_type", "url", name="uq_url_history_type_url"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    note: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    used_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(String(4096), nullable=False, default="")
