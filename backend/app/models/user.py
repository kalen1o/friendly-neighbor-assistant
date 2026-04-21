from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "user")
    )
    email: Mapped[str] = mapped_column(unique=True, index=True)
    password_hash: Mapped[str] = mapped_column()
    name: Mapped[str] = mapped_column()
    is_active: Mapped[bool] = mapped_column(default=True)
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user")
    memory_enabled: Mapped[bool] = mapped_column(default=True)
    memories: Mapped[Optional[str]] = mapped_column(Text, default=None)
    preferred_model: Mapped[Optional[str]] = mapped_column(
        String(100), default=None, nullable=True
    )
    personalization_nickname: Mapped[Optional[str]] = mapped_column(
        String(100), default=None, nullable=True
    )
    personalization_role: Mapped[Optional[str]] = mapped_column(
        String(200), default=None, nullable=True
    )
    personalization_tone: Mapped[Optional[str]] = mapped_column(
        String(30), default=None, nullable=True
    )
    personalization_length: Mapped[Optional[str]] = mapped_column(
        String(20), default=None, nullable=True
    )
    personalization_language: Mapped[Optional[str]] = mapped_column(
        String(50), default=None, nullable=True
    )
    personalization_about: Mapped[Optional[str]] = mapped_column(
        Text, default=None, nullable=True
    )
    personalization_style: Mapped[Optional[str]] = mapped_column(
        Text, default=None, nullable=True
    )
    oauth_provider: Mapped[Optional[str]] = mapped_column(
        String(20), default=None, nullable=True
    )
    oauth_id: Mapped[Optional[str]] = mapped_column(
        String(255), default=None, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
