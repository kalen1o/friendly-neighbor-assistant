from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Awaitable, Callable, Optional, TypeVar

from app.core.events import Event
from app.core.worker import Worker

logger = logging.getLogger(__name__)

E = TypeVar("E", bound=Event)
Handler = Callable[[Event], Awaitable[None]]


class EventBus(Worker):
    """In-process async event bus.

    `publish()` is non-blocking — it enqueues to an `asyncio.Queue`.
    `run()` drains the queue and dispatches each event to subscribers.

    Handlers are fired via `asyncio.create_task` so a slow handler (like
    running an LLM turn) does not block the bus.
    """

    def __init__(self) -> None:
        super().__init__()
        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subs: dict[type, list[Handler]] = defaultdict(list)

    def subscribe(
        self, event_class: type[E], handler: Callable[[E], Awaitable[None]]
    ) -> None:
        self._subs[event_class].append(handler)  # type: ignore[arg-type]
        logger.debug("Subscribed %s to %s", handler.__name__, event_class.__name__)

    def unsubscribe(self, handler: Handler) -> None:
        for subs in self._subs.values():
            try:
                subs.remove(handler)
            except ValueError:
                pass

    async def publish(self, event: Event) -> None:
        await self._queue.put(event)

    async def run(self) -> None:
        logger.info("EventBus started")
        try:
            while True:
                event = await self._queue.get()
                try:
                    self._dispatch(event)
                except Exception:
                    logger.exception("Error dispatching event")
                finally:
                    self._queue.task_done()
        except asyncio.CancelledError:
            logger.info("EventBus stopping")
            raise

    def _dispatch(self, event: Event) -> None:
        for event_class, handlers in self._subs.items():
            if isinstance(event, event_class):
                for h in handlers:
                    asyncio.create_task(
                        self._run_handler(h, event),
                        name=f"handler-{type(event).__name__}",
                    )

    async def _run_handler(self, handler: Handler, event: Event) -> None:
        try:
            await handler(event)
        except Exception:
            logger.exception(
                "Handler %s failed for %s", handler.__name__, type(event).__name__
            )


_bus: Optional[EventBus] = None


def set_eventbus(bus: EventBus | None) -> None:
    global _bus
    _bus = bus


def get_eventbus() -> EventBus:
    if _bus is None:
        raise RuntimeError("EventBus not initialized — check lifespan startup")
    return _bus
