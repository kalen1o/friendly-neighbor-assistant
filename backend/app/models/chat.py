from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id

if TYPE_CHECKING:
    from app.models.chat_file import ChatFile
    from app.models.folder import Folder


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "chat")
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), default=None, nullable=True
    )
    title: Mapped[Optional[str]] = mapped_column(default=None)
    context_summary: Mapped[Optional[str]] = mapped_column(Text, default=None)
    folder_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), default=None, nullable=True
    )
    user_model_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("user_models.id", ondelete="SET NULL"), default=None, nullable=True
    )
    selected_model_slug: Mapped[Optional[str]] = mapped_column(
        String(200), default=None, nullable=True
    )
    has_notification: Mapped[bool] = mapped_column(
        Boolean, server_default="false", default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[List["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )
    folder: Mapped[Optional["Folder"]] = relationship(
        "Folder", back_populates="chats", foreign_keys=[folder_id]
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "msg")
    )
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column()
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    sources_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    latency: Mapped[Optional[float]] = mapped_column(Float, default=None)
    tokens_input: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_output: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_total: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    status: Mapped[str] = mapped_column(
        String(20), server_default="completed", default="completed"
    )

    chat: Mapped["Chat"] = relationship(back_populates="messages")
    files: Mapped[List["ChatFile"]] = relationship(
        "ChatFile", foreign_keys="ChatFile.message_id", lazy="selectin"
    )
