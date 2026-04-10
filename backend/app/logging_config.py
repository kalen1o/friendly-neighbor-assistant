"""Structured logging configuration.

- Production: JSON lines (machine-parseable)
- Development: human-readable with colors
- Request ID injected via contextvars into every log line
"""

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone

# ── Request context ──

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


# ── JSON formatter (production) ──


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get("-"),
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)


# ── Human-readable formatter (development) ──


class DevFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[36m",  # cyan
        "INFO": "\033[32m",  # green
        "WARNING": "\033[33m",  # yellow
        "ERROR": "\033[31m",  # red
        "CRITICAL": "\033[1;31m",  # bold red
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        rid = request_id_var.get("-")
        rid_short = rid[:8] if rid != "-" else "-"
        msg = record.getMessage()
        base = f"{color}{record.levelname:<7}{self.RESET} [{rid_short}] {record.name}: {msg}"
        if record.exc_info and record.exc_info[1]:
            base += "\n" + self.formatException(record.exc_info)
        return base


# ── Setup ──


def setup_logging(level: str = "INFO", environment: str = "development") -> None:
    """Configure root logger with appropriate formatter."""
    root = logging.getLogger()
    root.setLevel(level.upper())

    # Remove existing handlers (avoid duplicates on reload)
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level.upper())

    if environment == "production":
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(DevFormatter())

    root.addHandler(handler)

    # Quiet noisy third-party loggers
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
