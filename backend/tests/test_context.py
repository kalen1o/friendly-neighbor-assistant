"""Tests for sliding window context management."""

from app.agent.context import (
    count_tokens,
    count_messages_tokens,
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
    # Small difference — still fresh
    assert _summary_is_fresh("[n=20]\nSome summary", 25) is True
    # Large difference — stale
    assert _summary_is_fresh("[n=20]\nSome summary", 35) is False
    # Invalid format — stale
    assert _summary_is_fresh("no marker", 10) is False


def test_extract_summary_text():
    assert _extract_summary_text("[n=20]\nThe actual summary") == "The actual summary"
    assert _extract_summary_text("[n=5]\nLine1\nLine2") == "Line1\nLine2"
    # No marker — returns as-is
    assert _extract_summary_text("plain text") == "plain text"
