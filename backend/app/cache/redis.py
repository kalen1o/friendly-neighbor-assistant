import json
import logging
from typing import Any, Optional

import redis.asyncio as redis

from app.config import Settings

logger = logging.getLogger(__name__)

_redis_client: Optional[redis.Redis] = None


async def init_redis(settings: Settings):
    """Initialize Redis connection."""
    global _redis_client
    _redis_client = redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    try:
        await _redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}. Cache disabled.")
        _redis_client = None


async def close_redis():
    """Close Redis connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


def get_redis() -> Optional[redis.Redis]:
    """Get the Redis client. Returns None if not connected."""
    return _redis_client


async def cache_get(key: str) -> Optional[str]:
    """Get a value from cache. Returns None on miss or error."""
    client = get_redis()
    if not client:
        return None
    try:
        return await client.get(key)
    except Exception:
        return None


async def cache_set(key: str, value: str, ttl_seconds: int = 3600) -> bool:
    """Set a value in cache with TTL. Returns False on error."""
    client = get_redis()
    if not client:
        return False
    try:
        await client.set(key, value, ex=ttl_seconds)
        return True
    except Exception:
        return False


async def cache_delete(key: str) -> bool:
    """Delete a key from cache."""
    client = get_redis()
    if not client:
        return False
    try:
        await client.delete(key)
        return True
    except Exception:
        return False


async def cache_get_json(key: str) -> Optional[Any]:
    """Get a JSON value from cache."""
    data = await cache_get(key)
    if data:
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return None
    return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int = 3600) -> bool:
    """Set a JSON value in cache."""
    return await cache_set(key, json.dumps(value), ttl_seconds)
