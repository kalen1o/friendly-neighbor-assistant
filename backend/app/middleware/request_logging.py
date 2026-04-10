"""Request tracing middleware.

- Generates a unique request_id per request
- Sets it in contextvars so all logs include it
- Logs method, path, status code, and duration
- Adds X-Request-ID response header
"""

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.logging_config import request_id_var

logger = logging.getLogger("app.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        request_id_var.set(request_id)

        start = time.monotonic()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error(
                "%s %s 500 %.0fms",
                request.method,
                request.url.path,
                duration_ms,
            )
            raise

        duration_ms = (time.monotonic() - start) * 1000
        response.headers["X-Request-ID"] = request_id

        # Skip health check noise
        if request.url.path == "/api/health":
            return response

        log_level = logging.WARNING if response.status_code >= 400 else logging.INFO
        logger.log(
            log_level,
            "%s %s %d %.0fms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )

        return response
