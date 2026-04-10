from datetime import datetime
from functools import partial
from typing import List, Optional

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id


class McpServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), default=None, nullable=True
    )
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "mcp")
    )
    name: Mapped[str] = mapped_column()
    url: Mapped[str] = mapped_column()
    description: Mapped[Optional[str]] = mapped_column(default=None)
    auth_type: Mapped[str] = mapped_column(default="none")  # "none", "bearer", "custom"
    auth_token: Mapped[Optional[str]] = mapped_column(Text, default=None)
    auth_header: Mapped[Optional[str]] = mapped_column(
        default=None
    )  # custom header name, e.g. "CONTEXT7_API_KEY"
    enabled: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    tools: Mapped[List["McpTool"]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
    )


class McpTool(Base):
    __tablename__ = "mcp_tools"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "tool")
    )
    server_id: Mapped[int] = mapped_column(
        ForeignKey("mcp_servers.id", ondelete="CASCADE")
    )
    tool_name: Mapped[str] = mapped_column()
    description: Mapped[Optional[str]] = mapped_column(default=None)
    input_schema: Mapped[Optional[str]] = mapped_column(
        Text, default=None
    )  # JSON string
    enabled: Mapped[bool] = mapped_column(
        default=False
    )  # disabled by default, user enables
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    server: Mapped["McpServer"] = relationship(back_populates="tools")
