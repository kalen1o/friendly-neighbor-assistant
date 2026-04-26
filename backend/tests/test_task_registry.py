"""Tests for the in-flight generation task registry.

Proves POST /stop actually cancels the running `asyncio.Task` rather than
just flipping the DB status and letting the LLM keep streaming until
the 2-minute idle timeout.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.core import task_registry
from app.core.agent_worker import AgentWorker
from app.core.eventbus import EventBus
from app.core.events import InboundEvent

pytestmark = pytest.mark.asyncio


async def _drain(ticks: int = 5) -> None:
    for _ in range(ticks):
        await asyncio.sleep(0)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Ensure every test starts with an empty registry."""
    task_registry._active.clear()
    yield
    task_registry._active.clear()


async def test_register_and_cancel_marks_task_cancelled():
    """A registered task can be cancelled via task_registry.cancel()."""
    started = asyncio.Event()
    cancelled_flag = {"cancelled": False}

    async def long_running():
        started.set()
        try:
            await asyncio.sleep(10)  # would hang without cancel
        except asyncio.CancelledError:
            cancelled_flag["cancelled"] = True
            raise

    t = asyncio.create_task(long_running())
    await started.wait()
    task_registry.register("chat-x", t)
    assert task_registry.is_active("chat-x")

    assert task_registry.cancel("chat-x") is True

    with pytest.raises(asyncio.CancelledError):
        await t
    assert cancelled_flag["cancelled"] is True


async def test_cancel_unknown_chat_returns_false():
    assert task_registry.cancel("chat-does-not-exist") is False


async def test_cancel_completed_task_returns_false():
    async def quick():
        return "done"

    t = asyncio.create_task(quick())
    await t  # finish
    task_registry.register("chat-y", t)
    assert task_registry.cancel("chat-y") is False


async def test_agent_worker_registers_and_cleans_up_on_normal_completion():
    """Chat-source events register their task; registry is clean after the handler returns."""
    bus = EventBus()
    await bus.start()
    worker = AgentWorker(bus)
    await worker.start()
    try:
        captured = {"was_active_during_handler": False}

        async def fake_handler(**kwargs):
            captured["was_active_during_handler"] = task_registry.is_active("chat-a")

        with patch("app.routers.chats._llm_background_task", side_effect=fake_handler):
            await bus.publish(
                InboundEvent(
                    source="chat",
                    session_id="chat-a",
                    content="x",
                    reply_queue=asyncio.Queue(),
                    payload={
                        "chat_id": 1,
                        "user_id": 1,
                        "user_msg_id": 1,
                        "mode": "balanced",
                        "file_ids": [],
                        "user_memory_enabled": False,
                    },
                )
            )
            await _drain(ticks=10)

        assert captured["was_active_during_handler"] is True
        assert task_registry.is_active("chat-a") is False  # cleaned up
    finally:
        await worker.stop()
        await bus.stop()


async def test_stop_during_handler_cancels_the_task():
    """task_registry.cancel() interrupts a running AgentWorker handler."""
    bus = EventBus()
    await bus.start()
    worker = AgentWorker(bus)
    await worker.start()
    try:
        handler_reached = asyncio.Event()
        saw_cancel = {"cancelled": False}

        async def slow_handler(**kwargs):
            handler_reached.set()
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                saw_cancel["cancelled"] = True
                raise

        with patch("app.routers.chats._llm_background_task", side_effect=slow_handler):
            await bus.publish(
                InboundEvent(
                    source="chat",
                    session_id="chat-b",
                    content="x",
                    reply_queue=asyncio.Queue(),
                    payload={
                        "chat_id": 1,
                        "user_id": 1,
                        "user_msg_id": 1,
                        "mode": "balanced",
                        "file_ids": [],
                        "user_memory_enabled": False,
                    },
                )
            )
            await handler_reached.wait()

            assert task_registry.cancel("chat-b") is True
            await _drain(ticks=5)

        assert saw_cancel["cancelled"] is True
        assert task_registry.is_active("chat-b") is False
    finally:
        await worker.stop()
        await bus.stop()
