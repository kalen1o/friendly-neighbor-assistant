"""Global error handlers for consistent API error responses.

Every error response follows the format:
{
    "error": {
        "code": "not_found",
        "message": "Chat not found",
        "request_id": "a1b2c3d4"
    }
}
"""

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_config import request_id_var

logger = logging.getLogger("app.errors")

# Map HTTP status codes to short error codes
_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
}


def _error_response(status_code: int, message: str) -> JSONResponse:
    code = _STATUS_CODES.get(status_code, "error")
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id_var.get("-"),
            }
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    """Register global exception handlers on the FastAPI app."""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        return _error_response(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Summarize validation errors into a readable message
        errors = exc.errors()
        if len(errors) == 1:
            err = errors[0]
            field = " -> ".join(str(loc) for loc in err.get("loc", []) if loc != "body")
            message = f"{field}: {err['msg']}" if field else err["msg"]
        else:
            parts = []
            for err in errors:
                field = " -> ".join(
                    str(loc) for loc in err.get("loc", []) if loc != "body"
                )
                parts.append(f"{field}: {err['msg']}" if field else err["msg"])
            message = "; ".join(parts)

        return _error_response(status.HTTP_422_UNPROCESSABLE_ENTITY, message)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception(
            "Unhandled exception on %s %s", request.method, request.url.path
        )
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "An unexpected error occurred",
        )
