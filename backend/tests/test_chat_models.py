from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.chat import Chat, Message
from app.schemas.chat import MessageOut


@pytest.mark.anyio
async def test_create_chat(db):
    chat = Chat(title="Test Chat")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title == "Test Chat"
    assert chat.created_at is not None
    assert chat.updated_at is not None


@pytest.mark.anyio
async def test_create_chat_without_title(db):
    chat = Chat()
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title is None


@pytest.mark.anyio
async def test_create_message(db):
    chat = Chat(title="Test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Hello!")
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    assert msg.id is not None
    assert msg.chat_id == chat.id
    assert msg.role == "user"
    assert msg.content == "Hello!"
    assert msg.created_at is not None


@pytest.mark.anyio
async def test_chat_messages_relationship(db):
    chat = Chat(title="Relationship test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg1 = Message(chat_id=chat.id, role="user", content="Hi")
    msg2 = Message(chat_id=chat.id, role="assistant", content="Hello!")
    db.add_all([msg1, msg2])
    await db.commit()

    result = await db.execute(select(Chat).where(Chat.id == chat.id))
    loaded_chat = result.scalar_one()
    await db.refresh(loaded_chat, ["messages"])

    assert len(loaded_chat.messages) == 2
    assert loaded_chat.messages[0].role == "user"
    assert loaded_chat.messages[1].role == "assistant"


@pytest.mark.anyio
async def test_cascade_delete(db):
    chat = Chat(title="Delete test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Bye")
    db.add(msg)
    await db.commit()

    await db.delete(chat)
    await db.commit()

    result = await db.execute(select(Message))
    remaining = result.scalars().all()
    assert len(remaining) == 0


# --- MessageOut.from_message — extra_metrics spread + filtering ---


class _FakeMessage:
    """Minimal stand-in for the Message ORM model used by from_message."""

    def __init__(
        self,
        public_id="msg-test-extra",
        chat_id=1,
        role="assistant",
        content="hi",
        latency=1.5,
        tokens_input=100,
        tokens_output=50,
        tokens_total=150,
        extra_metrics=None,
        sources_json=None,
        files=None,
        status="completed",
    ):
        self.public_id = public_id
        self.chat_id = chat_id
        self.role = role
        self.content = content
        self.created_at = datetime.now(timezone.utc)
        self.latency = latency
        self.tokens_input = tokens_input
        self.tokens_output = tokens_output
        self.tokens_total = tokens_total
        self.extra_metrics = extra_metrics
        self.sources_json = sources_json
        self.files = files or []
        self.status = status
        self.chat = None


def test_message_out_spreads_extra_metrics_into_response():
    msg = _FakeMessage(
        extra_metrics={
            "provider": "openai",
            "rounds_used": 2,
            "tools_called": 1,
            "unique_tools": 1,
            "timeouts": 0,
            "truncations": 0,
            "stuck_triggered": False,
            "synthesis_fallback": False,
            "finished_normally": True,
            "max_rounds_hit": False,
            "slowest_tool_name": "web_search",
            "slowest_tool_ms": 412.5,
            "total_tool_ms": 893.4,
        }
    )

    out = MessageOut.from_message(msg)
    assert out.metrics is not None
    assert out.metrics.tokens_total == 150
    assert out.metrics.latency == 1.5
    assert out.metrics.provider == "openai"
    assert out.metrics.rounds_used == 2
    assert out.metrics.slowest_tool_name == "web_search"
    assert out.metrics.synthesis_fallback is False


def test_message_out_filters_unknown_extra_metrics_keys():
    """extra_metrics may contain unrelated keys (e.g. from a future field
    rolled back). MessageOut should drop unknown keys, not raise."""
    msg = _FakeMessage(
        extra_metrics={
            "provider": "openai",
            "rounds_used": 1,
            "some_future_field_we_dont_know_about": "ignored",
        }
    )

    out = MessageOut.from_message(msg)
    assert out.metrics.provider == "openai"
    assert out.metrics.rounds_used == 1


def test_message_out_handles_null_extra_metrics():
    """Old messages have extra_metrics=None — must not crash."""
    msg = _FakeMessage(extra_metrics=None)
    out = MessageOut.from_message(msg)
    assert out.metrics is not None
    assert out.metrics.tokens_total == 150
    assert out.metrics.provider is None
