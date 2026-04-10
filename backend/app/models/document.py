from datetime import datetime
from typing import List, Optional

from functools import partial

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id

try:
    from pgvector.sqlalchemy import Vector
except ImportError:
    Vector = None


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), default=None, nullable=True
    )
    public_id: Mapped[str] = mapped_column(
        String(20), unique=True, default=partial(generate_public_id, "doc")
    )
    filename: Mapped[str] = mapped_column()
    file_type: Mapped[str] = mapped_column()
    file_size: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(default="processing")
    error_message: Mapped[Optional[str]] = mapped_column(default=None)
    chunk_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chunks: Mapped[List["DocumentChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "chunk")
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE")
    )
    chunk_text: Mapped[str] = mapped_column(Text)
    chunk_index: Mapped[int] = mapped_column()
    embedding = (
        mapped_column(Vector(1536), nullable=True)
        if Vector
        else mapped_column(Text, nullable=True)
    )
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, default=None)

    document: Mapped["Document"] = relationship(back_populates="chunks")
