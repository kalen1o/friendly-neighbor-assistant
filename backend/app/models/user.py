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
    oauth_provider: Mapped[Optional[str]] = mapped_column(String(20), default=None, nullable=True)
    oauth_id: Mapped[Optional[str]] = mapped_column(String(255), default=None, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
