from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

InboundSource = Literal["chat", "webhook", "scheduled"]


@dataclass
class Event:
    created_at: float = field(default_factory=time.time)


@dataclass
class InboundEvent(Event):
    """A message entering the system from any channel.

    `payload` carries source-specific arguments (chat_id, user_id, etc.) that
    the subscriber needs to invoke the existing handler functions. This avoids
    forcing every ingress channel through the same narrow interface.

    `reply_queue` is the streaming side-channel for SSE consumers — the bus
    itself does not carry token chunks, only the dispatch intent.
    """

    source: InboundSource = "chat"
    session_id: str = ""
    content: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    reply_queue: Optional[asyncio.Queue] = None
    retry_count: int = 0


@dataclass
class OutboundEvent(Event):
    """Emitted when an inbound event finishes being handled.

    Nothing subscribes to this yet; it's a hook for future cross-cutting
    consumers (observability, outbound-webhook publisher, metrics).
    """

    source: InboundSource = "chat"
    session_id: str = ""
    content: str = ""
    error: Optional[str] = None
