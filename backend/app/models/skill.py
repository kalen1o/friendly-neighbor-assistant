from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class Skill(Base):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_skills_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), default=None, nullable=True
    )
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "skill")
    )
    name: Mapped[str] = mapped_column()
    description: Mapped[str] = mapped_column()
    skill_type: Mapped[str] = mapped_column()  # "tool", "knowledge", "workflow"
    content: Mapped[str] = mapped_column(Text)  # full markdown
    enabled: Mapped[bool] = mapped_column(default=True)
    builtin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )
