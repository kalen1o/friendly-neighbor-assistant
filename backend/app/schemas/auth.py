from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    email: str
    name: str
    role: str
    memory_enabled: bool
    preferred_model: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class UserUpdate(BaseModel):
    memory_enabled: Optional[bool] = None
    preferred_model: Optional[str] = None


class ProvidersResponse(BaseModel):
    google: bool
    github: bool
