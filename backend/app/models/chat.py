from datetime import datetime, timezone
from functools import partial
from typing import List, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "chat")
    )
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), default=None, nullable=True)
    title: Mapped[Optional[str]] = mapped_column(default=None)
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

    chat: Mapped["Chat"] = relationship(back_populates="messages")
