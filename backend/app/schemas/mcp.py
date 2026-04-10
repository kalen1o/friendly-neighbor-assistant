from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class McpServerCreate(BaseModel):
    name: str
    url: str
    description: str = ""
    auth_type: str = "none"  # "none", "bearer", "custom"
    auth_token: Optional[str] = None
    auth_header: Optional[str] = None  # custom header name, e.g. "CONTEXT7_API_KEY"


class McpServerOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    name: str
    url: str
    description: Optional[str]
    auth_type: str
    enabled: bool
    tool_count: int = 0
    enabled_tool_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class McpToolOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    server_id: str
    tool_name: str
    description: Optional[str]
    input_schema: Optional[str]
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @classmethod
    def from_tool(cls, tool) -> "McpToolOut":
        return cls(
            id=tool.public_id,
            server_id=tool.server.public_id if tool.server else str(tool.server_id),
            tool_name=tool.tool_name,
            description=tool.description,
            input_schema=tool.input_schema,
            enabled=tool.enabled,
            created_at=tool.created_at,
        )


class McpServerUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    auth_type: Optional[str] = None
    auth_token: Optional[str] = None
    auth_header: Optional[str] = None
    enabled: Optional[bool] = None


class McpToolUpdate(BaseModel):
    enabled: Optional[bool] = None
