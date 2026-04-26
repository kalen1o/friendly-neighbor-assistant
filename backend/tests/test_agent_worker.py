"""Integration test for the EventBus → AgentWorker → handler wiring.

Rather than booting the whole LLM + DB stack, we mock the two downstream
handlers and assert the worker routes each InboundEvent source correctly
with the expected payload fields. If someone silently breaks the dispatch
seam (e.g. renames a payload key, drops reply_queue, or forgets to
publish from a router), this test fails.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.core.agent_worker import AgentWorker
from app.core.eventbus import EventBus
from app.core.events import InboundEvent, OutboundEvent

pytestmark = pytest.mark.asyncio


async def _drain(bus: EventBus, ticks: int = 5) -> None:
    for _ in range(ticks):
        await asyncio.sleep(0)


@pytest.fixture
async def bus_with_worker():
    bus = EventBus()
    await bus.start()
    worker = AgentWorker(bus)
    await worker.start()
    yield bus, worker
    await worker.stop()
    await bus.stop()


async def test_chat_event_routes_to_llm_background_task(bus_with_worker):
    """Publishing InboundEvent(source='chat') must call _llm_background_task
    with all payload fields + the reply_queue for SSE streaming."""
    bus, _ = bus_with_worker
    reply_queue: asyncio.Queue = asyncio.Queue()

    mock = AsyncMock()
    with patch("app.routers.chats._llm_background_task", mock):
        await bus.publish(
            InboundEvent(
                source="chat",
                session_id="chat-abc",
                content="hello world",
                reply_queue=reply_queue,
                payload={
                    "chat_id": 42,
                    "user_id": 7,
                    "user_msg_id": 100,
                    "mode": "balanced",
                    "file_ids": ["f1", "f2"],
                    "user_memory_enabled": True,
                    "artifact_context": {"id": "art-1"},
                },
            )
        )
        await _drain(bus)

    mock.assert_awaited_once()
    kwargs = mock.await_args.kwargs
    assert kwargs["chat_id"] == 42
    assert kwargs["chat_public_id"] == "chat-abc"
    assert kwargs["user_id"] == 7
    assert kwargs["user_msg_id"] == 100
    assert kwargs["user_msg_content"] == "hello world"
    assert kwargs["mode"] == "balanced"
    assert kwargs["file_ids"] == ["f1", "f2"]
    assert kwargs["user_memory_enabled"] is True
    assert kwargs["artifact_context"] == {"id": "art-1"}
    # Critical: SSE queue must be threaded through so tokens can stream back.
    assert kwargs["queue"] is reply_queue


async def test_webhook_event_routes_to_process_inbound_message(bus_with_worker):
    """source='webhook' must call _process_inbound_message with integration_id + user_id."""
    bus, _ = bus_with_worker
    mock = AsyncMock()
    with patch("app.routers.webhooks._process_inbound_message", mock):
        await bus.publish(
            InboundEvent(
                source="webhook",
                session_id="5",
                content="from slack",
                payload={"integration_id": 5, "user_id": 3},
            )
        )
        await _drain(bus)

    mock.assert_awaited_once()
    kwargs = mock.await_args.kwargs
    assert kwargs["integration_id"] == 5
    assert kwargs["user_id"] == 3
    assert kwargs["text"] == "from slack"


async def test_chat_handler_receives_streaming_tokens_via_reply_queue(bus_with_worker):
    """Tokens written to reply_queue by the mocked handler must be readable
    by the publisher — this is the contract SSE streaming depends on."""
    bus, _ = bus_with_worker
    reply_queue: asyncio.Queue = asyncio.Queue()

    async def fake_handler(**kwargs):
        q = kwargs["queue"]
        await q.put({"event": "message", "data": "chunk-1"})
        await q.put({"event": "message", "data": "chunk-2"})
        await q.put({"event": "done", "data": ""})
        await q.put(None)  # sentinel — matches real handler

    with patch("app.routers.chats._llm_background_task", side_effect=fake_handler):
        await bus.publish(
            InboundEvent(
                source="chat",
                session_id="c",
                content="x",
                reply_queue=reply_queue,
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
        await _drain(bus)

    received = []
    while True:
        item = await asyncio.wait_for(reply_queue.get(), timeout=0.5)
        if item is None:
            break
        received.append(item)

    assert len(received) == 3
    assert received[0] == {"event": "message", "data": "chunk-1"}
    assert received[1] == {"event": "message", "data": "chunk-2"}
    assert received[2]["event"] == "done"


async def test_handler_exception_emits_outbound_event_with_error(bus_with_worker):
    """When the chat handler raises, an OutboundEvent carrying the error
    must be published so observability consumers can see the failure."""
    bus, _ = bus_with_worker
    outbound: list[OutboundEvent] = []

    async def on_outbound(ev: OutboundEvent) -> None:
        outbound.append(ev)

    bus.subscribe(OutboundEvent, on_outbound)

    async def fail(**kwargs):
        raise RuntimeError("downstream blew up")

    with patch("app.routers.chats._llm_background_task", side_effect=fail):
        await bus.publish(
            InboundEvent(
                source="chat",
                session_id="c",
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
        await _drain(bus, ticks=10)

    assert len(outbound) == 1
    assert outbound[0].source == "chat"
    assert outbound[0].session_id == "c"
    assert outbound[0].error is not None
    assert "downstream blew up" in outbound[0].error


async def test_unknown_source_does_not_crash_worker(bus_with_worker):
    """An unknown source should log + emit OutboundEvent(error=...) without
    taking the worker or bus down. Subsequent events must still dispatch."""
    bus, _ = bus_with_worker
    outbound: list[OutboundEvent] = []

    async def on_outbound(ev: OutboundEvent) -> None:
        outbound.append(ev)

    bus.subscribe(OutboundEvent, on_outbound)

    # Bypass the dataclass Literal to simulate a malformed event.
    bogus = InboundEvent.__new__(InboundEvent)
    bogus.created_at = 0.0
    bogus.source = "bogus"  # type: ignore[assignment]
    bogus.session_id = "s"
    bogus.content = "c"
    bogus.payload = {}
    bogus.reply_queue = None
    bogus.retry_count = 0
    await bus.publish(bogus)
    await _drain(bus)

    assert len(outbound) == 1
    assert outbound[0].error is not None

    # Bus still alive — webhook event should still route normally.
    mock = AsyncMock()
    with patch("app.routers.webhooks._process_inbound_message", mock):
        await bus.publish(
            InboundEvent(
                source="webhook",
                session_id="1",
                content="t",
                payload={"integration_id": 1, "user_id": 1},
            )
        )
        await _drain(bus)

    mock.assert_awaited_once()
