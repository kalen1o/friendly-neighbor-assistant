"""End-to-end test for POST /api/chats/{id}/messages through the EventBus.

Exercises the full path we built this session:
    route handler → publish InboundEvent → EventBus → AgentWorker
    → _llm_background_task → SSE queue → client

Every layer in between has unit tests. Nothing covers them stitched
together. If someone renames an InboundEvent payload key, drops the
reply_queue, or breaks the lifespan ordering, this test fails loudly
instead of letting a dead chat reach production.

The LLM provider is mocked (`stream_with_tools`, `get_llm_response`) —
everything else runs for real, including the bus, the agent worker,
and `_llm_background_task` itself.
"""

from __future__ import annotations

from typing import AsyncIterator
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import engine as db_engine_mod
from app.models.chat import Chat, Message

pytestmark = pytest.mark.asyncio


def _stream_factory(*pieces: str):
    """Build a side_effect for `stream_with_tools` that yields scripted chunks."""

    async def _gen(*_args, **_kwargs) -> AsyncIterator[str]:
        for piece in pieces:
            yield piece

    return _gen


async def _read_sse(response) -> list[dict]:
    """Parse an SSE response body into [{event, data}, ...] in arrival order."""
    events: list[dict] = []
    current: dict = {}
    async for raw in response.aiter_lines():
        line = raw
        if line == "":
            if current:
                events.append(current)
                current = {}
            continue
        if line.startswith(":"):
            continue  # SSE comment
        if ":" in line:
            key, _, value = line.partition(":")
            value = value.lstrip()
            if key == "event":
                current["event"] = value
            elif key == "data":
                # SSE allows multi-line data but our backend sends one line per event.
                current["data"] = value
    if current:
        events.append(current)
    return events


@pytest.fixture
async def bg_session_factory_override(db_engine):
    """Point `_llm_background_task`'s session factory at the test SQLite engine.

    The production lifespan initializes the module-level session factory
    against Postgres. Tests override the `get_db` dependency for route
    handlers, but the background task uses the module-level factory
    directly — so without this fixture it writes to Postgres while the
    test reads from SQLite, and assertions never see the same data.
    """
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    original = db_engine_mod._state.get("session_factory")
    db_engine_mod._state["session_factory"] = factory
    yield factory
    db_engine_mod._state["session_factory"] = original


@pytest.fixture
async def eventbus_and_worker():
    """Boot a real EventBus + AgentWorker for the test.

    httpx's `ASGITransport` doesn't trigger FastAPI's lifespan, so the
    production-startup that wires up the bus never runs here. Start them
    manually per-test and tear down cleanly.
    """
    from app.core.agent_worker import AgentWorker
    from app.core.eventbus import EventBus, set_eventbus

    bus = EventBus()
    await bus.start()
    set_eventbus(bus)
    worker = AgentWorker(bus)
    await worker.start()
    yield bus
    await worker.stop()
    await bus.stop()
    set_eventbus(None)


async def test_e2e_message_through_bus(
    client, db_engine, bg_session_factory_override, eventbus_and_worker
):
    """Full stack: POST streams tokens back and persists an assistant message."""
    # 1. Create a chat via the real API.
    r = await client.post("/api/chats", json={"title": "E2E"})
    assert r.status_code == 201
    chat_id = r.json()["id"]

    # 2. Mock only the LLM provider. Everything else (bus, worker, hooks,
    #    artifact parser, audit log, usage tracking) runs for real.
    with (
        patch(
            "app.llm.provider.stream_with_tools",
            side_effect=_stream_factory("Hello", ", ", "world", "!"),
        ),
        patch(
            # `get_llm_response` is imported at module level into routers.chats,
            # so patch the namespace the caller actually looks up.
            "app.routers.chats.get_llm_response",
            new=AsyncMock(return_value="ScriptedTitle"),
        ),
    ):
        async with client.stream(
            "POST",
            f"/api/chats/{chat_id}/messages",
            json={"content": "ping", "mode": "balanced", "file_ids": []},
        ) as response:
            assert response.status_code == 200
            events = await _read_sse(response)

    # 3. SSE stream carried message chunks in order.
    message_chunks = [e["data"] for e in events if e.get("event") == "message"]
    assert "".join(message_chunks) == "Hello, world!"

    # 4. Assistant message was persisted (proves: bus → worker → handler →
    #    DB commit all worked via the real execution path, not a mock).
    async with bg_session_factory_override() as db:
        result = await db.execute(select(Message).where(Message.role == "assistant"))
        msgs = result.scalars().all()
        assert len(msgs) == 1
        assert msgs[0].content == "Hello, world!"
        assert msgs[0].status == "completed"


async def test_e2e_stream_yields_done_event(
    client, db_engine, bg_session_factory_override, eventbus_and_worker
):
    """The SSE terminator event must fire at end-of-stream — without it the
    frontend event_generator hangs waiting for the queue sentinel."""
    r = await client.post("/api/chats", json={"title": "done-test"})
    chat_id = r.json()["id"]

    with (
        patch(
            "app.llm.provider.stream_with_tools",
            side_effect=_stream_factory("ok"),
        ),
        patch(
            "app.routers.chats.get_llm_response",
            new=AsyncMock(return_value="t"),
        ),
    ):
        async with client.stream(
            "POST",
            f"/api/chats/{chat_id}/messages",
            json={"content": "x", "mode": "balanced", "file_ids": []},
        ) as response:
            events = await _read_sse(response)

    event_types = [e.get("event") for e in events]
    assert "message" in event_types
    assert "done" in event_types
    # `done` lands after the message content, not before.
    assert event_types.index("done") > event_types.index("message")


async def test_e2e_auto_title_generation_uses_get_llm_response(
    client,
    db_engine,
    bg_session_factory_override,
    eventbus_and_worker,
):
    """Auto-title fires off get_llm_response; the chat row should carry the result."""
    # Auto-titling only runs when title is null — create without one.
    r = await client.post("/api/chats", json={})
    chat_id = r.json()["id"]

    with (
        patch(
            "app.llm.provider.stream_with_tools",
            side_effect=_stream_factory("hi"),
        ),
        patch(
            "app.routers.chats.get_llm_response",
            new=AsyncMock(return_value="Nice Auto Title"),
        ),
    ):
        async with client.stream(
            "POST",
            f"/api/chats/{chat_id}/messages",
            json={"content": "first message", "mode": "balanced", "file_ids": []},
        ) as response:
            await _read_sse(response)

    async with bg_session_factory_override() as db:
        result = await db.execute(select(Chat).where(Chat.public_id == chat_id))
        chat = result.scalar_one()
        assert chat.title == "Nice Auto Title"


async def test_e2e_rejects_unknown_chat(client):
    """Sanity check on the route-layer validation still standing after the bus split."""
    r = await client.post(
        "/api/chats/chat-does-not-exist/messages",
        json={"content": "x", "mode": "balanced", "file_ids": []},
    )
    assert r.status_code == 404
