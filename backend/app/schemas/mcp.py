from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class McpServerCreate(BaseModel):
    name: str
    url: str
    description: str = ""
    auth_type: str = "none"
    auth_token: Optional[str] = None


class McpServerOut(BaseModel):
    id: int
    name: str
    url: str
    description: Optional[str]
    auth_type: str
    enabled: bool
    tool_count: int = 0
    enabled_tool_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class McpToolOut(BaseModel):
    id: int
    server_id: int
    tool_name: str
    description: Optional[str]
    input_schema: Optional[str]
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class McpToolUpdate(BaseModel):
    enabled: Optional[bool] = None
