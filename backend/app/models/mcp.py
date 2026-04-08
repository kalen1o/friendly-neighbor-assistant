from datetime import datetime
from typing import List, Optional

from sqlalchemy import ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class McpServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column()
    url: Mapped[str] = mapped_column()
    description: Mapped[Optional[str]] = mapped_column(default=None)
    auth_type: Mapped[str] = mapped_column(default="none")  # "none", "bearer"
    auth_token: Mapped[Optional[str]] = mapped_column(Text, default=None)
    enabled: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    tools: Mapped[List["McpTool"]] = relationship(
        back_populates="server",
        cascade="all, delete-orphan",
    )


class McpTool(Base):
    __tablename__ = "mcp_tools"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    server_id: Mapped[int] = mapped_column(ForeignKey("mcp_servers.id", ondelete="CASCADE"))
    tool_name: Mapped[str] = mapped_column()
    description: Mapped[Optional[str]] = mapped_column(default=None)
    input_schema: Mapped[Optional[str]] = mapped_column(Text, default=None)  # JSON string
    enabled: Mapped[bool] = mapped_column(default=False)  # disabled by default, user enables
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    server: Mapped["McpServer"] = relationship(back_populates="tools")
