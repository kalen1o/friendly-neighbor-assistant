from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.core import task_registry
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
        cancelled = False
        try:
            if event.source == "chat":
                await self._handle_chat(event)
            elif event.source == "webhook":
                await self._handle_webhook(event)
            else:
                logger.warning("Unknown InboundEvent source: %s", event.source)
                error = f"unknown source: {event.source}"
        except asyncio.CancelledError:
            # POST /stop cancelled our task. Let it propagate so the task
            # actually terminates, but don't emit an OutboundEvent — the
            # reply_queue's consumer already bailed out.
            cancelled = True
            logger.info(
                "InboundEvent cancelled: source=%s session=%s",
                event.source,
                event.session_id,
            )
            raise
        except Exception as e:
            logger.exception("AgentWorker handler failed for source=%s", event.source)
            error = str(e)
        finally:
            if not cancelled:
                try:
                    await self._bus.publish(
                        OutboundEvent(
                            source=event.source,
                            session_id=event.session_id,
                            content="",
                            error=error,
                        )
                    )
                except Exception:
                    logger.exception("Failed to publish OutboundEvent")

    async def _handle_chat(self, event: InboundEvent) -> None:
        # Lazy import to avoid circular import with routers.
        from app.routers.chats import _llm_background_task

        # Register this task so POST /stop can cancel it. Cleanup in finally
        # runs on both normal completion and cancellation.
        current = asyncio.current_task()
        if current is not None:
            task_registry.register(event.session_id, current)
        try:
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
        finally:
            task_registry.unregister(event.session_id)

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
