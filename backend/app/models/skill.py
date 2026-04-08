from datetime import datetime
from typing import Optional

from sqlalchemy import Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(unique=True)
    description: Mapped[str] = mapped_column()
    skill_type: Mapped[str] = mapped_column()  # "tool", "knowledge", "workflow"
    content: Mapped[str] = mapped_column(Text)  # full markdown
    enabled: Mapped[bool] = mapped_column(default=True)
    builtin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
