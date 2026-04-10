from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SkillCreate(BaseModel):
    name: str
    description: str
    skill_type: str  # "tool", "knowledge", "workflow"
    content: str  # full markdown


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    enabled: Optional[bool] = None


class SkillOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    name: str
    description: str
    skill_type: str
    content: str
    enabled: bool
    builtin: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True, "populate_by_name": True}
