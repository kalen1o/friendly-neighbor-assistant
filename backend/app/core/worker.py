from __future__ import annotations

import asyncio
import logging
from abc import ABC
from typing import Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.eventbus import EventBus

logger = logging.getLogger(__name__)


class Worker(ABC):
    """Background task with a managed lifecycle.

    Subclasses override `run()`. Call `start()` to launch and `stop()` to
    cancel cleanly.
    """
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run_safe(), name=type(self).__name__)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("%s crashed during shutdown", type(self).__name__)
        self._task = None

    async def _run_safe(self) -> None:
        try:
            await self.run()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("%s crashed", type(self).__name__)

    async def run(self) -> None:
        raise NotImplementedError


class SubscriberWorker:
    """Subscribes to events on an EventBus and cleans up on stop.

    Not a long-running task — the bus dispatches to our handlers directly.
    Subclasses register subscriptions in `start()` via `_subscribe()`.
    """
    def __init__(self, bus: "EventBus") -> None:
        self._bus = bus
        self._handlers: list[Callable] = []

    def _subscribe(self, event_class: type, handler: Callable) -> None:
        self._bus.subscribe(event_class, handler)
        self._handlers.append(handler)

    async def start(self) -> None:
        pass  # subclass registers subscriptions

    async def stop(self) -> None:
        for handler in self._handlers:
            self._bus.unsubscribe(handler)
        self._handlers.clear()
