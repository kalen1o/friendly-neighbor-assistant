"""Tests for memory extraction throttling.

The extraction call fires after every assistant turn. Two gates skip the
call when it would obviously be wasteful: a short minimum interval, and a
minimum user-message length below which there's no signal worth saving.
"""

import time
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent.memory import extract_memories
from app.config import Settings
from app.models.user import User


def _settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        memory_extraction_min_interval_s=60,
        memory_extraction_min_user_chars=30,
    )


@pytest.fixture
async def memory_session_factory(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


async def _create_user(session_factory) -> int:
    async with session_factory() as session:
        user = User(
            email="mem@example.com",
            password_hash="x",
            name="M",
            public_id="user-mem-throttle",
            memory_enabled=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


@pytest.mark.anyio
async def test_skips_when_last_run_is_recent(memory_session_factory):
    user_id = await _create_user(memory_session_factory)
    settings = _settings()

    # Last run was 10s ago — within the 60s interval, so we must skip.
    recent_ts = time.time() - 10
    cache_get = AsyncMock(return_value=recent_ts)
    cache_set = AsyncMock(return_value=True)
    llm = AsyncMock()

    with (
        patch("app.agent.memory.cache_get_json", cache_get),
        patch("app.agent.memory.cache_set_json", cache_set),
        patch("app.agent.memory.get_llm_response", llm),
    ):
        await extract_memories(
            user_id,
            [{"role": "user", "content": "I love spicy food, please remember that"}],
            settings,
            memory_session_factory,
        )

    llm.assert_not_called()
    cache_set.assert_not_called()


@pytest.mark.anyio
async def test_skips_when_latest_user_message_is_too_short(memory_session_factory):
    user_id = await _create_user(memory_session_factory)
    settings = _settings()

    cache_get = AsyncMock(return_value=None)  # no recent run
    cache_set = AsyncMock(return_value=True)
    llm = AsyncMock()

    with (
        patch("app.agent.memory.cache_get_json", cache_get),
        patch("app.agent.memory.cache_set_json", cache_set),
        patch("app.agent.memory.get_llm_response", llm),
    ):
        await extract_memories(
            user_id,
            [{"role": "user", "content": "thanks"}],  # 6 chars, well under 30
            settings,
            memory_session_factory,
        )

    llm.assert_not_called()
    cache_set.assert_not_called()


@pytest.mark.anyio
async def test_runs_when_both_gates_clear(memory_session_factory):
    user_id = await _create_user(memory_session_factory)
    settings = _settings()

    cache_get = AsyncMock(return_value=None)  # no recent run
    cache_set = AsyncMock(return_value=True)
    llm = AsyncMock(return_value="[]")  # empty actions list — still a real call

    with (
        patch("app.agent.memory.cache_get_json", cache_get),
        patch("app.agent.memory.cache_set_json", cache_set),
        patch("app.agent.memory.get_llm_response", llm),
    ):
        await extract_memories(
            user_id,
            [
                {
                    "role": "user",
                    "content": "I work as a senior data scientist building pipelines",
                }
            ],
            settings,
            memory_session_factory,
        )

    llm.assert_called_once()
    # last_run timestamp must be persisted even when no actions were extracted —
    # we paid for the call, so the next one should still respect the interval.
    cache_set.assert_called_once()
    call_args = cache_set.call_args
    assert call_args.args[0] == f"memories:last_run:{user_id}"
    assert isinstance(call_args.args[1], float)
