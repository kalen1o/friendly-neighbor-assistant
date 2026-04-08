from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ChatCreate(BaseModel):
    title: Optional[str] = None


class ChatUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str


class MessageOut(BaseModel):
    id: int
    chat_id: int
    role: str
    content: str
    created_at: datetime
    sources: Optional[List[Dict[str, Any]]] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_message(cls, msg) -> "MessageOut":
        import json
        sources = None
        if msg.sources_json:
            try:
                sources = json.loads(msg.sources_json)
            except (json.JSONDecodeError, TypeError):
                pass
        return cls(
            id=msg.id,
            chat_id=msg.chat_id,
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at,
            sources=sources,
        )


class ChatSummary(BaseModel):
    id: int
    title: Optional[str]
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatDetail(BaseModel):
    id: int
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    messages: List[MessageOut] = []

    model_config = {"from_attributes": True}

    @classmethod
    def from_chat(cls, chat) -> "ChatDetail":
        return cls(
            id=chat.id,
            title=chat.title,
            created_at=chat.created_at,
            updated_at=chat.updated_at,
            messages=[MessageOut.from_message(m) for m in chat.messages],
        )
