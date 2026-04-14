from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class WebhookIntegration(Base):
    __tablename__ = "webhook_integrations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(24), unique=True, default=partial(generate_public_id, "wh")
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    platform: Mapped[str] = mapped_column(String(20))
    direction: Mapped[str] = mapped_column(String(10))
    webhook_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    inbound_token: Mapped[Optional[str]] = mapped_column(String(64), default=None, unique=True)
    subscribed_events: Mapped[Optional[str]] = mapped_column(Text, default="[]")
    config_json: Mapped[Optional[str]] = mapped_column(Text, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
