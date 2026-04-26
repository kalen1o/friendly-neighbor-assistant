"""Usage analytics — Redis-backed per-user counters.

Tracks messages sent, tokens consumed, and tool calls per user per month.
Counters auto-expire after 90 days.
"""

import logging

from app.cache.redis import get_redis
from app.utils.time import utcnow_naive

logger = logging.getLogger(__name__)

COUNTER_TTL = 90 * 86400  # 90 days


def _month_key(user_id: int) -> str:
    return f"usage:{user_id}:{utcnow_naive().strftime('%Y-%m')}"


async def track_message(
    user_id: int, tokens_input: int = 0, tokens_output: int = 0
) -> None:
    """Increment usage counters after a message exchange."""
    client = get_redis()
    if not client:
        return

    try:
        key = _month_key(user_id)
        pipe = client.pipeline()
        pipe.hincrby(key, "messages", 1)
        pipe.hincrby(key, "tokens_input", tokens_input)
        pipe.hincrby(key, "tokens_output", tokens_output)
        pipe.hincrby(key, "tokens_total", tokens_input + tokens_output)
        pipe.expire(key, COUNTER_TTL, nx=True)
        await pipe.execute()
    except Exception:
        logger.warning("Failed to track usage for user %s", user_id)


async def track_tool_call(user_id: int) -> None:
    """Increment tool call counter."""
    client = get_redis()
    if not client:
        return

    try:
        key = _month_key(user_id)
        pipe = client.pipeline()
        pipe.hincrby(key, "tool_calls", 1)
        pipe.expire(key, COUNTER_TTL, nx=True)
        await pipe.execute()
    except Exception:
        logger.warning("Failed to track tool call for user %s", user_id)


async def get_usage(user_id: int) -> dict:
    """Get usage stats for the current month."""
    client = get_redis()
    if not client:
        return _empty_usage()

    try:
        key = _month_key(user_id)
        data = await client.hgetall(key)
        return {
            "period": utcnow_naive().strftime("%Y-%m"),
            "messages": int(data.get("messages", 0)),
            "tokens_input": int(data.get("tokens_input", 0)),
            "tokens_output": int(data.get("tokens_output", 0)),
            "tokens_total": int(data.get("tokens_total", 0)),
            "tool_calls": int(data.get("tool_calls", 0)),
        }
    except Exception:
        logger.warning("Failed to get usage for user %s", user_id)
        return _empty_usage()


def _empty_usage() -> dict:
    return {
        "period": utcnow_naive().strftime("%Y-%m"),
        "messages": 0,
        "tokens_input": 0,
        "tokens_output": 0,
        "tokens_total": 0,
        "tool_calls": 0,
    }
