"""Time helpers.

`datetime.utcnow()` is deprecated in Python 3.12 and becomes an error in
3.14. The non-deprecated spelling is `datetime.now(timezone.utc)` — but
that returns a *timezone-aware* value, which breaks inserts into the
codebase's existing `DateTime` columns (defined without `timezone=True`).

`utcnow_naive()` preserves the old behavior exactly: returns a naive
UTC datetime, compatible with existing columns and comparisons.
"""

from datetime import datetime, timezone


def utcnow_naive() -> datetime:
    """Naive UTC now — drop-in replacement for the deprecated `datetime.utcnow()`."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
