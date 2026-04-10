from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class HookCreate(BaseModel):
    name: str
    description: str
    hook_type: str
    hook_point: str
    priority: int = 100
    content: str


class HookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None


class HookOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    name: str
    description: str
    hook_type: str
    hook_point: str
    priority: int
    content: str
    enabled: bool
    builtin: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True, "populate_by_name": True}
