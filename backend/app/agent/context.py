"""Sliding window context management for chat history.

When conversation history exceeds the token budget:
1. Keep the most recent messages verbatim (at least N)
2. Summarize older messages via LLM
3. Store the summary on the Chat model for reuse
4. Send: [system summary] + [recent messages] to the LLM

The summary boundary moves in steps of N messages instead of every turn, so
the [summary] + [recent...] prefix stays byte-identical for several turns and
provider prompt caches (Anthropic, OpenAI, GLM) keep hitting.
"""

import logging
from typing import List

import tiktoken

from app.config import Settings
from app.llm.provider import get_llm_response
from app.models.chat import Chat

logger = logging.getLogger(__name__)

# Use cl100k_base (GPT-4/Claude approximate tokenizer)
_encoding = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """Approximate token count for a string."""
    return len(_encoding.encode(text))


def count_messages_tokens(messages: List[dict]) -> int:
    """Approximate total tokens across a list of messages."""
    total = 0
    for msg in messages:
        # ~4 tokens overhead per message (role, formatting)
        total += 4 + count_tokens(msg.get("content", ""))
    return total


async def build_context_messages(
    chat: Chat,
    settings: Settings,
) -> List[dict]:
    """Build the LLM message list with sliding window + summarization.

    Returns a list of message dicts ready to send to the LLM.
    If history fits within context_max_tokens, returns all messages.
    Otherwise, summarizes older messages and prepends the summary.
    """
    all_messages = [{"role": m.role, "content": m.content} for m in chat.messages]

    total_tokens = count_messages_tokens(all_messages)

    # If everything fits, return as-is
    if total_tokens <= settings.context_max_tokens:
        return all_messages

    logger.info(
        "Chat %s: %d tokens exceeds %d limit, applying sliding window",
        chat.public_id,
        total_tokens,
        settings.context_max_tokens,
    )

    # Split: keep recent messages verbatim, summarize the rest
    older_count = _summary_boundary(len(all_messages), settings.context_recent_messages)
    older = all_messages[:older_count]
    recent = all_messages[older_count:]

    if not older:
        # All messages are "recent" — just return them (edge case)
        return all_messages

    # Build or reuse summary
    summary = await _get_or_create_summary(chat, older, settings)

    # Prepend summary as a system-style user message
    summary_message = {
        "role": "user",
        "content": (
            f"[Previous conversation summary — use for context, do not repeat]\n"
            f"{summary}\n"
            f"[End of summary — continue the conversation naturally]"
        ),
    }

    return [summary_message] + recent


def _summary_boundary(total: int, recent_min: int) -> int:
    """Number of leading messages to summarize.

    Rounded down to a multiple of `recent_min`, so the boundary (and the
    summary) only changes once every `recent_min` messages; in between, the
    verbatim window grows from `recent_min` up to `2 * recent_min - 1`.
    Before the first full step, summarize everything beyond `recent_min`.
    """
    excess = total - recent_min
    if excess <= 0:
        return 0
    if recent_min <= 0:
        return excess
    return (excess // recent_min) * recent_min or excess


async def _get_or_create_summary(
    chat: Chat,
    older_messages: List[dict],
    settings: Settings,
) -> str:
    """Get existing summary or generate a new one.

    Reuses chat.context_summary if it covers exactly these older messages.
    Otherwise regenerates.
    """
    older_hash = len(older_messages)  # boundary marker; moves in fixed steps

    if chat.context_summary and _summary_is_fresh(chat.context_summary, older_hash):
        logger.debug("Reusing existing context summary for chat %s", chat.public_id)
        return _extract_summary_text(chat.context_summary)

    logger.info(
        "Generating new context summary for chat %s (%d older messages)",
        chat.public_id,
        len(older_messages),
    )
    summary = await _summarize_messages(older_messages, settings)

    # Store with message count marker for freshness check
    chat.context_summary = f"[n={older_hash}]\n{summary}"

    return summary


def _summary_is_fresh(stored_summary: str, current_count: int) -> bool:
    """Check if the stored summary covers exactly `current_count` messages.

    An exact match is required: a summary of fewer messages would silently
    drop the ones between it and the verbatim window.
    """
    try:
        # Extract stored count from "[n=42]\n..." format
        first_line = stored_summary.split("\n", 1)[0]
        stored_count = int(first_line.split("=")[1].rstrip("]"))
        return current_count == stored_count
    except (IndexError, ValueError):
        return False


def _extract_summary_text(stored_summary: str) -> str:
    """Extract the summary text, stripping the freshness marker."""
    parts = stored_summary.split("\n", 1)
    return parts[1] if len(parts) > 1 else stored_summary


async def _summarize_messages(
    messages: List[dict],
    settings: Settings,
) -> str:
    """Call LLM to summarize a block of messages."""
    conversation = "\n".join(f"{m['role'].title()}: {m['content']}" for m in messages)

    # Truncate if the conversation itself is huge (avoid sending 100k tokens to summarize)
    max_chars = 12000
    if len(conversation) > max_chars:
        conversation = conversation[:max_chars] + "\n[...truncated...]"

    prompt = [
        {
            "role": "user",
            "content": (
                "Summarize the following conversation in 200-300 words. "
                "Capture the key topics discussed, important facts mentioned, "
                "decisions made, and any user preferences expressed. "
                "Write in third person (e.g., 'The user asked about...'). "
                "Be factual and concise.\n\n"
                f"{conversation}"
            ),
        }
    ]

    summary = await get_llm_response(prompt, settings)
    return summary.strip()
