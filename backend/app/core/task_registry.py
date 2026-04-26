"""In-flight generation task registry.

Maps `chat_id` → the `asyncio.Task` currently running `_llm_background_task`
for that chat, so `POST /api/chats/{id}/stop` can actually cancel the work
instead of just flipping the DB status and letting the LLM keep streaming
into the void.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_active: dict[str, asyncio.Task] = {}


def register(chat_id: str, task: asyncio.Task) -> None:
    _active[chat_id] = task


def unregister(chat_id: str) -> None:
    _active.pop(chat_id, None)


def cancel(chat_id: str) -> bool:
    """Cancel the in-flight task for this chat. Returns True if one was cancelled."""
    task: Optional[asyncio.Task] = _active.get(chat_id)
    if task is None or task.done():
        return False
    task.cancel()
    logger.info("Cancelled in-flight generation task for chat=%s", chat_id)
    return True


def is_active(chat_id: str) -> bool:
    task = _active.get(chat_id)
    return task is not None and not task.done()
