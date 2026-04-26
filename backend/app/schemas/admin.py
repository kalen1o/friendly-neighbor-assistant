from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class UserAdmin(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    is_env_admin: bool
    created_at: datetime
    messages_this_month: int
    tokens_this_month: int


class UserAdminUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class SystemAnalytics(BaseModel):
    total_users: int
    active_users_30d: int
    total_messages: int
    total_tokens: int
    total_cost: float
    daily: List[dict]


class ArtifactEditPathStats(BaseModel):
    path: str  # "tool" or "whole_file_emission"
    edits: int
    avg_bytes_emitted: float
    total_bytes_emitted: int
    avg_files_changed: float


class ArtifactEditAnalytics(BaseModel):
    days: int
    total_edits: int
    tool_adoption_pct: float  # 0-100, 0 if no edits
    by_path: List[ArtifactEditPathStats]


class AuditEntry(BaseModel):
    id: int
    user_email: Optional[str]
    user_name: Optional[str]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: datetime


class AuditPage(BaseModel):
    entries: List[AuditEntry]
    next_cursor: Optional[str] = None
    has_more: bool = False


class UserQuotaOut(BaseModel):
    user_id: str
    user_email: str
    user_name: str
    messages_soft: Optional[int]
    messages_hard: Optional[int]
    tokens_soft: Optional[int]
    tokens_hard: Optional[int]
    messages_used: int
    tokens_used: int


class UserQuotaUpdate(BaseModel):
    messages_soft: Optional[int] = None
    messages_hard: Optional[int] = None
    tokens_soft: Optional[int] = None
    tokens_hard: Optional[int] = None
