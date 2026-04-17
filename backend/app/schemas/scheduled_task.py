from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ScheduledTaskCreate(BaseModel):
    name: str
    prompt: str
    cron_expression: str
    webhook_url: Optional[str] = None


class ScheduledTaskUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    cron_expression: Optional[str] = None
    webhook_url: Optional[str] = None
    enabled: Optional[bool] = None


class ScheduledTaskOut(BaseModel):
    id: str
    name: str
    prompt: str
    cron_expression: str
    chat_id: Optional[str] = None
    webhook_url: Optional[str] = None
    enabled: bool
    last_run_at: Optional[datetime] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
