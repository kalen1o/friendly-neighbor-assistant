from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserQuota(Base):
    __tablename__ = "user_quotas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    messages_soft: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    messages_hard: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_soft: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_hard: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
