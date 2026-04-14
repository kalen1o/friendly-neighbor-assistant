from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class WebhookCreate(BaseModel):
    name: str = Field(max_length=100)
    platform: str = Field(pattern="^(slack|discord|generic)$")
    direction: str = Field(pattern="^(outbound|inbound|both)$")
    webhook_url: Optional[str] = None
    subscribed_events: List[str] = []
    config_json: Optional[Dict] = None


class WebhookUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    webhook_url: Optional[str] = None
    subscribed_events: Optional[List[str]] = None
    config_json: Optional[Dict] = None
    enabled: Optional[bool] = None


class WebhookOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    name: str
    platform: str
    direction: str
    webhook_url: Optional[str] = None
    inbound_token: Optional[str] = None
    inbound_url: Optional[str] = None
    subscribed_events: List[str] = []
    config: Optional[Dict] = None
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
