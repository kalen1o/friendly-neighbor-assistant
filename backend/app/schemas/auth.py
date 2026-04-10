from datetime import datetime

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
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
