"""Tests for appending per-turn context to the last user message."""

from app.routers.chats import _append_to_last_user_message


def test_append_to_plain_text_message_keeps_history_untouched():
    history = {"role": "user", "content": "earlier"}
    messages = [history, {"role": "assistant", "content": "ok"}]
    messages.append({"role": "user", "content": "hi"})

    _append_to_last_user_message(messages, "\n\nmemories")

    assert messages[-1] == {"role": "user", "content": "hi\n\nmemories"}
    assert messages[0] == {"role": "user", "content": "earlier"}


def test_append_to_content_array_extends_first_text_block():
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {"type": "image_url", "image_url": {"url": "data:x"}},
            ],
        }
    ]

    _append_to_last_user_message(messages, "\n\nmemories")

    assert messages[-1]["content"][0]["text"] == "describe\n\nmemories"
    assert len(messages[-1]["content"]) == 2


def test_append_to_content_array_without_text_block_adds_one():
    messages = [
        {
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "data:x"}}],
        }
    ]

    _append_to_last_user_message(messages, "memories")

    assert messages[-1]["content"][-1] == {"type": "text", "text": "memories"}
