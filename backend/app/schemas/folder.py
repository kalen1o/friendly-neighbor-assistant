from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FolderCreate(BaseModel):
    name: str = Field(max_length=100)
    parent_id: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    parent_id: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)
    position: Optional[int] = None


class FolderOut(BaseModel):
    id: str
    name: str
    parent_id: Optional[str]
    color: Optional[str]
    icon: Optional[str]
    position: int
    chat_count: int

    model_config = {"from_attributes": True}
