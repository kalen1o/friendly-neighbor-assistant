"""Tests for sliding window context management."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.agent.context import (
    build_context_messages,
    count_tokens,
    count_messages_tokens,
    _summary_boundary,
    _summary_is_fresh,
    _extract_summary_text,
)


def test_count_tokens():
    assert count_tokens("hello world") > 0
    assert count_tokens("") == 0
    # Longer text should have more tokens
    assert count_tokens("a " * 100) > count_tokens("a " * 10)


def test_count_messages_tokens():
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]
    total = count_messages_tokens(messages)
    assert total > 0
    # Should be more than just the content tokens (role overhead)
    content_only = count_tokens("Hello") + count_tokens("Hi there!")
    assert total > content_only


def test_summary_is_fresh():
    # Same count — fresh
    assert _summary_is_fresh("[n=20]\nSome summary", 20) is True
    # Any difference — stale (would drop messages between summary and window)
    assert _summary_is_fresh("[n=20]\nSome summary", 25) is False
    assert _summary_is_fresh("[n=20]\nSome summary", 35) is False
    # Invalid format — stale
    assert _summary_is_fresh("no marker", 10) is False


def test_extract_summary_text():
    assert _extract_summary_text("[n=20]\nThe actual summary") == "The actual summary"
    assert _extract_summary_text("[n=5]\nLine1\nLine2") == "Line1\nLine2"
    # No marker — returns as-is
    assert _extract_summary_text("plain text") == "plain text"


def test_summary_boundary_moves_in_steps():
    # Fits in the verbatim window — nothing to summarize.
    assert _summary_boundary(8, 10) == 0
    assert _summary_boundary(10, 10) == 0
    # Before the first full step: summarize everything beyond the window.
    assert _summary_boundary(13, 10) == 3
    # Afterwards the boundary only moves every 10 messages.
    assert [_summary_boundary(n, 10) for n in range(20, 30)] == [10] * 10
    assert _summary_boundary(30, 10) == 20


def _chat(n_messages, context_summary=None):
    messages = [
        SimpleNamespace(
            role="user" if i % 2 == 0 else "assistant",
            content="message {} ".format(i) + "word " * 50,
        )
        for i in range(n_messages)
    ]
    return SimpleNamespace(
        public_id="c1", messages=messages, context_summary=context_summary
    )


def _settings():
    return SimpleNamespace(context_max_tokens=100, context_recent_messages=10)


@pytest.mark.anyio
async def test_build_context_keeps_prefix_stable_across_turns():
    """Adding a turn inside a step keeps [summary] + earlier messages identical."""
    summarize = AsyncMock(return_value="SUMMARY")
    with patch("app.agent.context._summarize_messages", summarize):
        chat = _chat(22)
        first = await build_context_messages(chat, _settings())

        # Next turn: two more messages, same summary boundary.
        chat.messages += _chat(24).messages[22:]
        second = await build_context_messages(chat, _settings())

    assert summarize.await_count == 1  # summary reused, not regenerated
    assert second[: len(first)] == first
    assert len(second) == len(first) + 2
    assert "SUMMARY" in first[0]["content"]


@pytest.mark.anyio
async def test_build_context_regenerates_summary_when_boundary_moves():
    summarize = AsyncMock(return_value="SUMMARY")
    with patch("app.agent.context._summarize_messages", summarize):
        chat = _chat(28)
        await build_context_messages(chat, _settings())
        chat.messages += _chat(30).messages[28:]
        result = await build_context_messages(chat, _settings())

    assert summarize.await_count == 2
    # 30 messages: 20 summarized, 10 verbatim.
    assert len(summarize.await_args_list[-1].args[0]) == 20
    assert len(result) == 1 + 10
