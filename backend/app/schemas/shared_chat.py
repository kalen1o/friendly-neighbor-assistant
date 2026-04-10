from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ShareCreate(BaseModel):
    visibility: str = "public"


class ShareOut(BaseModel):
    id: str
    chat_id: str
    visibility: str
    active: bool
    title: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_shared(cls, shared) -> "ShareOut":
        return cls(
            id=shared.public_id,
            chat_id=str(shared.chat_id),
            visibility=shared.visibility,
            active=shared.active,
            title=shared.title,
            created_at=shared.created_at,
        )


class SharedMessage(BaseModel):
    role: str
    content: str
    created_at: datetime


class SharedChatView(BaseModel):
    id: str
    title: Optional[str]
    visibility: str
    created_at: datetime
    messages: List[SharedMessage]
