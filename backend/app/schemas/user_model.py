from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ModelCreate(BaseModel):
    name: str = Field(max_length=100)
    provider: str = Field(pattern="^(openai|anthropic|openai_compatible)$")
    model_id: str = Field(max_length=100)
    api_key: str
    base_url: Optional[str] = Field(None, max_length=500)


class ModelUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    model_id: Optional[str] = Field(None, max_length=100)
    api_key: Optional[str] = None
    base_url: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None


class ModelOut(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    base_url: Optional[str]
    is_default: bool
    builtin: bool
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ModelTestResult(BaseModel):
    success: bool
    message: str
