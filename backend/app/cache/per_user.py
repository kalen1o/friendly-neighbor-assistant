"""Simple per-user in-memory TTL cache.

Used for skill registries and hook registries so we avoid rebuilding
them on every request while still isolating data per user.
"""

import time
from typing import Dict, Generic, Optional, TypeVar

T = TypeVar("T")

_DEFAULT_TTL = 60  # seconds


class PerUserCache(Generic[T]):
    """Thread-safe-ish per-user cache with TTL expiration.

    Usage:
        cache = PerUserCache[SkillRegistry](ttl_seconds=60)
        registry = cache.get(user_id)
        if registry is None:
            registry = await build_registry(...)
            cache.set(user_id, registry)
    """

    def __init__(self, ttl_seconds: int = _DEFAULT_TTL):
        self._ttl = ttl_seconds
        self._entries: Dict[int, tuple[T, float]] = {}

    def get(self, user_id: int) -> Optional[T]:
        entry = self._entries.get(user_id)
        if entry is None:
            return None
        value, created_at = entry
        if time.monotonic() - created_at > self._ttl:
            del self._entries[user_id]
            return None
        return value

    def set(self, user_id: int, value: T) -> None:
        self._entries[user_id] = (value, time.monotonic())

    def invalidate(self, user_id: Optional[int] = None) -> None:
        """Clear cache for a specific user, or all users if None."""
        if user_id is not None:
            self._entries.pop(user_id, None)
        else:
            self._entries.clear()
