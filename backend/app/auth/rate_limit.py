import logging

from fastapi import HTTPException, Request, status

from app.cache.redis import get_redis

logger = logging.getLogger(__name__)


async def check_rate_limit(
    key: str,
    max_attempts: int,
    window_seconds: int,
) -> None:
    """Check rate limit using Redis sliding window. Raises 429 if exceeded."""
    client = get_redis()
    if not client:
        # Redis unavailable — allow request but log warning
        logger.warning("Redis unavailable, rate limiting disabled")
        return

    current = await client.get(key)
    if current and int(current) >= max_attempts:
        ttl = await client.ttl(key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {ttl} seconds.",
            headers={"Retry-After": str(ttl)},
        )

    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window_seconds, nx=True)
    await pipe.execute()


async def rate_limit_login(request: Request) -> None:
    """Rate limit login: 5 attempts per 60 seconds per IP."""
    ip = request.client.host if request.client else "unknown"
    await check_rate_limit(f"rl:login:{ip}", max_attempts=5, window_seconds=60)


async def rate_limit_register(request: Request) -> None:
    """Rate limit registration: 3 attempts per 60 seconds per IP."""
    ip = request.client.host if request.client else "unknown"
    await check_rate_limit(f"rl:register:{ip}", max_attempts=3, window_seconds=60)
