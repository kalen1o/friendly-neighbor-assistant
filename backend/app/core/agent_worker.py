from __future__ import annotations

import logging

from app.config import get_settings
from app.core.eventbus import EventBus
from app.core.events import InboundEvent, OutboundEvent
from app.core.worker import SubscriberWorker

logger = logging.getLogger(__name__)


class AgentWorker(SubscriberWorker):
    """Subscribes to InboundEvent and routes to the handler for each source.

    Deliberately a thin dispatcher — the existing handler functions
    (`_llm_background_task`, `_process_inbound_message`) stay unchanged.
    The value is the unified dispatch seam, not a rewrite of the agent path.
    """

    def __init__(self, bus: EventBus) -> None:
        super().__init__(bus)

    async def start(self) -> None:
        self._subscribe(InboundEvent, self._handle)

    async def _handle(self, event: InboundEvent) -> None:
        error: str | None = None
        try:
            if event.source == "chat":
                await self._handle_chat(event)
            elif event.source == "webhook":
                await self._handle_webhook(event)
            else:
                logger.warning("Unknown InboundEvent source: %s", event.source)
                error = f"unknown source: {event.source}"
        except Exception as e:
            logger.exception("AgentWorker handler failed for source=%s", event.source)
            error = str(e)
        finally:
            await self._bus.publish(
                OutboundEvent(
                    source=event.source,
                    session_id=event.session_id,
                    content="",
                    error=error,
                )
            )

    async def _handle_chat(self, event: InboundEvent) -> None:
        # Lazy import to avoid circular import with routers.
        from app.routers.chats import _llm_background_task

        settings = get_settings()
        p = event.payload
        await _llm_background_task(
            chat_id=p["chat_id"],
            chat_public_id=event.session_id,
            user_id=p["user_id"],
            user_msg_id=p["user_msg_id"],
            user_msg_content=event.content,
            mode=p["mode"],
            file_ids=p["file_ids"],
            user_memory_enabled=p["user_memory_enabled"],
            settings=settings,
            queue=event.reply_queue,
            artifact_context=p.get("artifact_context"),
        )

    async def _handle_webhook(self, event: InboundEvent) -> None:
        from app.routers.webhooks import _process_inbound_message

        settings = get_settings()
        p = event.payload
        await _process_inbound_message(
            integration_id=p["integration_id"],
            user_id=p["user_id"],
            text=event.content,
            settings=settings,
        )
