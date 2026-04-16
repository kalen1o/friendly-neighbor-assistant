from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id

if TYPE_CHECKING:
    from app.models.chat import Chat


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "parent_id", "name", name="uq_folder_user_parent_name"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "fld")
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), default=None, nullable=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    icon: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    children: Mapped[List["Folder"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="Folder.position, Folder.name",
    )
    parent: Mapped[Optional["Folder"]] = relationship(
        back_populates="children", remote_side=[id]
    )
    chats: Mapped[List["Chat"]] = relationship(
        back_populates="folder", foreign_keys="Chat.folder_id"
    )
