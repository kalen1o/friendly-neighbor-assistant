from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import String, func
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
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
