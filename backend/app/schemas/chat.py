from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatCreate(BaseModel):
    title: Optional[str] = None


class ChatUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None
    model_id: Optional[str] = None


class MessageCreate(BaseModel):
    content: str
    mode: str = "balanced"  # "fast", "balanced", "thinking"
    file_ids: List[str] = []
    artifact_context: Optional[dict] = None


class MessageMetrics(BaseModel):
    latency: Optional[float] = None
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    tokens_total: Optional[int] = None
    # Agent-loop telemetry — populated from the message's extra_metrics
    # JSON column. All optional; non-tool-loop messages leave them None.
    rounds_used: Optional[int] = None
    tools_called: Optional[int] = None
    unique_tools: Optional[int] = None
    timeouts: Optional[int] = None
    truncations: Optional[int] = None
    stuck_triggered: Optional[bool] = None
    synthesis_fallback: Optional[bool] = None
    finished_normally: Optional[bool] = None
    max_rounds_hit: Optional[bool] = None
    slowest_tool_name: Optional[str] = None
    slowest_tool_ms: Optional[float] = None
    total_tool_ms: Optional[float] = None
    provider: Optional[str] = None


class MessageOut(BaseModel):
    id: str
    chat_id: str
    role: str
    content: str
    created_at: datetime
    sources: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[MessageMetrics] = None
    files: Optional[List[Dict[str, str]]] = None
    status: str = "completed"

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
        metrics = None
        extra = getattr(msg, "extra_metrics", None) or {}
        if msg.latency is not None or msg.tokens_total is not None or extra:
            # Filter extra_metrics to only the keys MessageMetrics declares so
            # unrelated content in the JSON column doesn't leak through.
            known_extra_keys = {
                "rounds_used",
                "tools_called",
                "unique_tools",
                "timeouts",
                "truncations",
                "stuck_triggered",
                "synthesis_fallback",
                "finished_normally",
                "max_rounds_hit",
                "slowest_tool_name",
                "slowest_tool_ms",
                "total_tool_ms",
                "provider",
            }
            filtered_extra = {k: v for k, v in extra.items() if k in known_extra_keys}
            metrics = MessageMetrics(
                latency=msg.latency,
                tokens_input=msg.tokens_input,
                tokens_output=msg.tokens_output,
                tokens_total=msg.tokens_total,
                **filtered_extra,
            )
        files = None
        if hasattr(msg, "files") and msg.files:
            files = [
                {"id": f.public_id, "name": f.filename, "type": f.file_type}
                for f in msg.files
            ]
        return cls(
            id=msg.public_id,
            chat_id=msg.chat.public_id
            if hasattr(msg, "chat") and msg.chat
            else str(msg.chat_id),
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at,
            sources=sources,
            metrics=metrics,
            files=files,
            status=getattr(msg, "status", "completed"),
        )


class ChatSummary(BaseModel):
    id: str = Field(validation_alias="public_id")
    title: Optional[str]
    updated_at: datetime
    folder_id: Optional[str] = None
    model_id: Optional[str] = None
    has_notification: bool = False
    is_generating: bool = False

    model_config = {"from_attributes": True, "populate_by_name": True}


class ChatListResponse(BaseModel):
    chats: List[ChatSummary]
    next_cursor: Optional[str] = None
    has_more: bool = False


class ChatDetail(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    messages: List[MessageOut] = []

    model_config = {"from_attributes": True}

    @classmethod
    def from_chat(cls, chat) -> "ChatDetail":
        return cls(
            id=chat.public_id,
            title=chat.title,
            created_at=chat.created_at,
            updated_at=chat.updated_at,
            messages=[MessageOut.from_message(m) for m in chat.messages],
        )


class SearchResult(BaseModel):
    chat_id: str
    chat_title: Optional[str]
    message_id: str
    role: str
    content: str
    created_at: datetime


class SearchResponse(BaseModel):
    results: List[SearchResult]
    total: int
