# Agent Telemetry SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the agent loop's per-response telemetry (tokens, rounds, tool latency, diagnostic flags) into the chat UI as a hover-revealed footer with permanent warning chips, persisted across reloads.

**Architecture:** Typed event stream — `run_tool_loop` yields `TelemetryEnd(data)` after the text chunks; post-processing wrappers in `provider.py` gain a 3-line pass-through guard so non-string events flow through unchanged; router branches on event type to persist to message columns + a new `extra_metrics` JSON column and to emit an extended `metrics` SSE event; frontend adds a `MessageFooter` component with a shadcn-style tooltip built on `@base-ui/react/tooltip`.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 / Alembic / pytest. Next.js 15+ App Router / shadcn-style UI / `@base-ui/react` / `lucide-react` / Tailwind. Backend tests via `docker exec fn-backend python -m pytest tests/...`. Frontend type-check via `docker exec fn-frontend npx tsc --noEmit`.

**Reference spec:** `docs/superpowers/specs/2026-04-27-agent-telemetry-sse-design.md`

**Important deviation from the spec:** the spec proposed a new SSE event named `usage`, but a `metrics` SSE event already exists (chats.py:1735, api.ts:552). This plan extends the existing `metrics` event payload with the new fields rather than adding a parallel `usage` event. Simpler, reuses the existing handler.

---

## Pre-flight

- [ ] **Confirm clean baseline.**

Run: `docker exec fn-backend python -m pytest tests/ -q 2>&1 | tail -3`

Expected: ends with something like `253 passed` (or higher). Anything other than all green means investigate before continuing.

- [ ] **Confirm frontend container builds.**

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`.

---

## Task 1: Driver — `LoopEvent`, `TelemetryEnd`, yield from `run_tool_loop`

**Files:**
- Modify: `backend/app/llm/driver.py`
- Modify: `backend/tests/test_driver.py`

- [ ] **Step 1: Append failing test to `backend/tests/test_driver.py`**

Open `backend/tests/test_driver.py` and append this test at the end of the file:

```python
@pytest.mark.anyio
async def test_driver_yields_telemetry_end_as_final_event():
    """run_tool_loop must yield a TelemetryEnd dataclass as its very last
    item so the router can persist + stream the metrics."""
    from app.llm.driver import TelemetryEnd

    adapter = _FakeAdapter(
        rounds=[
            ([], [ToolCall(id="t1", name="search", raw_args={"q": "x"})]),
            (["done"], []),
        ]
    )

    async def fake_executor(name, args):
        return "result"

    events = []
    async for ev in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[{"type": "function", "function": {"name": "search", "parameters": {}}}],
        tool_executor=fake_executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        events.append(ev)

    assert isinstance(events[-1], TelemetryEnd), (
        f"expected TelemetryEnd as final event; got {type(events[-1]).__name__}"
    )
    data = events[-1].data
    assert data["provider"] == "fake"
    assert data["rounds_used"] == 2
    assert data["tools_called"] == 1
    assert data["finished_normally"] is True
    assert "prompt_tokens" in data
    assert "completion_tokens" in data
    assert "total_tokens" in data
    assert "slowest_tool_name" in data
    # Text events that came before TelemetryEnd are still strings.
    assert "done" in "".join(e for e in events if isinstance(e, str))
```

- [ ] **Step 2: Run the test — must fail (TelemetryEnd doesn't exist yet)**

Run: `docker exec fn-backend python -m pytest tests/test_driver.py::test_driver_yields_telemetry_end_as_final_event -v`

Expected: `ImportError: cannot import name 'TelemetryEnd' from 'app.llm.driver'`.

Do not skip this. The failing-first step proves the test exercises new code.

- [ ] **Step 3: Add the dataclasses to `driver.py`**

Open `backend/app/llm/driver.py`. Find the existing `RoundEnd` dataclass (around the section where `RoundResult`, `ToolCall`, etc. are defined). Add these two dataclasses immediately after `RoundEnd`:

```python
@dataclass
class LoopEvent:
    """Marker base for non-text events yielded by run_tool_loop.

    Strings continue to flow through the loop's output as before; LoopEvent
    subclasses are interleaved when the loop wants to communicate structured
    side-channel data to the consumer (router).
    """


@dataclass
class TelemetryEnd(LoopEvent):
    """Final event yielded by run_tool_loop after the streaming response
    completes, carrying the telemetry dict that previously was only logged.
    """

    data: dict
```

- [ ] **Step 4: Modify `run_tool_loop` to yield `TelemetryEnd` after the existing log line**

Still in `backend/app/llm/driver.py`. Find the `logger.info("tool_loop done", extra={...})` call at the end of `run_tool_loop`. The existing code looks roughly like:

```python
slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(tool_timings)
logger.info(
    "tool_loop done",
    extra={
        "provider": adapter.provider_name,
        "rounds_used": rounds_used,
        # ... many fields ...
    },
)
```

Replace that block with this version that builds the dict once, logs it, and then yields it as `TelemetryEnd`:

```python
slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(tool_timings)
telemetry = {
    "provider": adapter.provider_name,
    "rounds_used": rounds_used,
    "tools_called": tools_called,
    "unique_tools": len(unique_tools_seen),
    "timeouts": timeouts,
    "truncations": truncations,
    "stuck_triggered": stuck_triggered,
    "synthesis_fallback": synthesis_fallback_used,
    "finished_normally": finished_normally,
    "max_rounds_hit": rounds_used >= max_tool_rounds and not finished_normally,
    "prompt_tokens": prompt_tokens,
    "completion_tokens": completion_tokens,
    "total_tokens": prompt_tokens + completion_tokens,
    "slowest_tool_name": slowest_name,
    "slowest_tool_ms": slowest_ms,
    "total_tool_ms": total_tool_ms,
}
logger.info("tool_loop done", extra=telemetry)
yield TelemetryEnd(data=telemetry)
```

The existing `logger.info` is preserved exactly — production log observability is intact. The new `yield` is the only behavior change.

- [ ] **Step 5: Run the new driver test — must pass**

Run: `docker exec fn-backend python -m pytest tests/test_driver.py::test_driver_yields_telemetry_end_as_final_event -v`

Expected: PASS.

- [ ] **Step 6: Run the full driver test file — all driver tests still pass**

Run: `docker exec fn-backend python -m pytest tests/test_driver.py -v`

Expected: 4 tests pass (3 existing + 1 new).

The 3 existing driver tests already iterate `run_tool_loop` with `async for chunk in ...`. They handle whatever's yielded — they collect chunks but don't assert types. They'll pass because:
- `test_driver_runs_until_no_tool_calls_then_emits_telemetry` — only asserts on the log record + content text. Content text comes from string yields. The trailing `TelemetryEnd` doesn't disrupt either.
- `test_driver_detects_stuck_and_strips_tools` — only asserts on `append_tool_results_calls` count and content. Unaffected.
- `test_driver_skips_tool_executor_on_invalid_args` — only asserts the executor was not called and the appended tool result string contains `"invalid JSON arguments"`. Unaffected.

If any pre-existing driver test now fails, stop and investigate — you may have introduced an extra side effect.

- [ ] **Step 7: Run the full agent-path suite — must still pass**

Run: `docker exec fn-backend python -m pytest tests/ -q 2>&1 | tail -3`

Expected: still all green (count goes up by 1 for the new test).

If any other test fails, the most likely cause is a consumer of the loop that asserts strict-string typing somewhere. Trace and fix.

- [ ] **Step 8: Commit**

```bash
git add backend/app/llm/driver.py backend/tests/test_driver.py
git commit -m "$(cat <<'EOF'
feat(llm): yield TelemetryEnd from run_tool_loop

Adds LoopEvent base class and TelemetryEnd subclass to driver.py.
run_tool_loop now yields TelemetryEnd(data=telemetry_dict) after
its existing log line — same fields, same shape, just bubbled out
to consumers instead of only logged. Pre-existing logger.info
call preserved so observability stays intact.

New driver test verifies TelemetryEnd is the final yielded event
and carries the expected fields.
EOF
)"
```

If the commit is denied, stop and report.

---

## Task 2: Wrappers — pass-through guard for non-string events

**Files:**
- Modify: `backend/app/llm/provider.py`
- Modify: `backend/tests/test_llm_provider.py`

The three post-processing wrappers in `provider.py` (`_with_idle_timeout`, `_buffered_stream`, `_filter_tool_leaks`) currently assume `AsyncIterator[str]`. With `TelemetryEnd` events now flowing through, they need a 3-line guard at the top of their consume loop to pass non-strings through unchanged.

- [ ] **Step 1: Append failing test to `backend/tests/test_llm_provider.py`**

Open `backend/tests/test_llm_provider.py`. Append at the end:

```python
@pytest.mark.anyio
async def test_wrappers_pass_through_non_string_events():
    """The three post-processing wrappers (_filter_tool_leaks,
    _buffered_stream, _with_idle_timeout) must pass non-string LoopEvent
    items through unchanged so the router can see TelemetryEnd."""
    from app.llm.driver import TelemetryEnd
    from app.llm.provider import (
        _buffered_stream,
        _filter_tool_leaks,
        _with_idle_timeout,
    )

    sentinel = TelemetryEnd(data={"marker": True})

    async def source():
        yield "hello"
        yield " world"
        yield sentinel

    # _filter_tool_leaks
    out = []
    async for item in _filter_tool_leaks(source()):
        out.append(item)
    assert sentinel in out, "TelemetryEnd should pass through _filter_tool_leaks"

    # _buffered_stream
    out = []
    async for item in _buffered_stream(source(), flush_interval=0.0, min_chars=1):
        out.append(item)
    assert sentinel in out, "TelemetryEnd should pass through _buffered_stream"

    # _with_idle_timeout
    out = []
    async for item in _with_idle_timeout(source(), timeout_s=5):
        out.append(item)
    assert sentinel in out, "TelemetryEnd should pass through _with_idle_timeout"
```

- [ ] **Step 2: Run the new test — must fail (current wrappers crash or skip non-strings)**

Run: `docker exec fn-backend python -m pytest tests/test_llm_provider.py::test_wrappers_pass_through_non_string_events -v`

Expected: FAIL. The exact error depends on the wrapper — `_buffered_stream` will likely fail when it tries `buffer += token` with a non-string, `_filter_tool_leaks` with a `'in' requires string as left operand` or similar, `_with_idle_timeout` would actually pass (it doesn't touch chunk content) but the assertion still validates the contract.

- [ ] **Step 3: Add the pass-through guard to `_filter_tool_leaks`**

Open `backend/app/llm/provider.py`. Find `async def _filter_tool_leaks(...)`. Its body starts with `buffer = ""` and then `async for chunk in source:`. Add the guard as the first statement inside the `async for`:

Current:
```python
async for chunk in source:
    buffer += chunk
    # ... existing leak-detection logic ...
```

New:
```python
async for chunk in source:
    if not isinstance(chunk, str):
        yield chunk
        continue
    buffer += chunk
    # ... existing leak-detection logic unchanged ...
```

- [ ] **Step 4: Add the pass-through guard to `_buffered_stream`**

Same file. Find `async def _buffered_stream(...)`. Its body starts with imports and `buffer = ""`. Inside its `async for token in source:`, add the same guard:

Current:
```python
async for token in source:
    buffer += token
    now = time.monotonic()
    # ... existing buffering logic ...
```

New:
```python
async for token in source:
    if not isinstance(token, str):
        yield token
        continue
    buffer += token
    now = time.monotonic()
    # ... existing buffering logic unchanged ...
```

- [ ] **Step 5: Add the pass-through guard to `_with_idle_timeout`**

Same file. Find `async def _with_idle_timeout(...)`. Its body has a `while True:` loop. Inside, after `chunk = await asyncio.wait_for(...)`, add the guard before `yield chunk`:

Current:
```python
while True:
    try:
        chunk = await asyncio.wait_for(iterator.__anext__(), timeout=timeout_s)
    except StopAsyncIteration:
        return
    except asyncio.TimeoutError:
        raise TimeoutError(
            f"LLM stream idle for {timeout_s:.0f}s — provider stopped sending data."
        )
    yield chunk
```

New:
```python
while True:
    try:
        chunk = await asyncio.wait_for(iterator.__anext__(), timeout=timeout_s)
    except StopAsyncIteration:
        return
    except asyncio.TimeoutError:
        raise TimeoutError(
            f"LLM stream idle for {timeout_s:.0f}s — provider stopped sending data."
        )
    yield chunk
```

(Note: this wrapper already passes anything through — `_with_idle_timeout` doesn't inspect `chunk`'s type. The assertion in the test verifies this contract holds; no code change needed if the wrapper already passes non-strings. If it does need adjustment, add the guard right before `yield chunk`. Run Step 6 and check.)

- [ ] **Step 6: Run the new wrapper test — must pass**

Run: `docker exec fn-backend python -m pytest tests/test_llm_provider.py::test_wrappers_pass_through_non_string_events -v`

Expected: PASS.

- [ ] **Step 7: Run the full provider test file — all tests still pass**

Run: `docker exec fn-backend python -m pytest tests/test_llm_provider.py -q 2>&1 | tail -3`

Expected: All tests pass (count goes up by 1).

- [ ] **Step 8: Commit**

```bash
git add backend/app/llm/provider.py backend/tests/test_llm_provider.py
git commit -m "$(cat <<'EOF'
feat(llm): pass non-string LoopEvents through the post-processing wrappers

_filter_tool_leaks, _buffered_stream, and _with_idle_timeout now check
isinstance(chunk, str) and yield non-string events through untouched.
String chunks continue to flow through the existing logic unchanged.

Required so TelemetryEnd from run_tool_loop reaches the router intact.
EOF
)"
```

---

## Task 3: DB migration — `extra_metrics` JSON column on `messages`

**Files:**
- Create: `backend/alembic/versions/<auto-generated-rev>_add_extra_metrics_to_messages.py`

- [ ] **Step 1: Generate a new Alembic revision**

Run: `docker exec fn-backend alembic revision -m "add extra_metrics json column to messages"`

Expected: command prints something like `Generating /app/alembic/versions/abc1234567_add_extra_metrics_to_messages.py`. Note the revision id (the hex prefix of the filename).

- [ ] **Step 2: Edit the generated revision file**

Open the new file at `backend/alembic/versions/<rev>_add_extra_metrics_to_messages.py` and replace the auto-stubbed `upgrade()` and `downgrade()` with:

```python
def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("extra_metrics", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "extra_metrics")
```

Leave the `revision`, `down_revision`, `branch_labels`, `depends_on`, and import block at the top of the file untouched (Alembic generated them correctly).

- [ ] **Step 3: Run the migration**

Run: `docker exec fn-backend alembic upgrade head`

Expected: prints `Running upgrade <prev_rev> -> <new_rev>, add extra_metrics json column to messages`. Exit code 0.

- [ ] **Step 4: Verify the column exists**

Run: `docker exec fn-db psql -U fn -d fn -c "\d messages" 2>&1 | grep extra_metrics`

Expected: a row showing `extra_metrics | json |` (or similar based on PostgreSQL's representation).

If the database connection fails, the connection params may differ — try `docker exec fn-db psql -U postgres -d fn` or check `docker compose.yml` for the right user/db. The exact incantation matters less than confirming the column.

- [ ] **Step 5: Verify the rollback works**

Run: `docker exec fn-backend alembic downgrade -1`

Expected: prints the downgrade message. Confirm the column is gone:

```
docker exec fn-db psql -U fn -d fn -c "\d messages" 2>&1 | grep extra_metrics
```

Expected: no output (column absent).

- [ ] **Step 6: Re-apply the migration**

Run: `docker exec fn-backend alembic upgrade head`

Confirm the column is back:

```
docker exec fn-db psql -U fn -d fn -c "\d messages" 2>&1 | grep extra_metrics
```

Expected: column shows up again.

- [ ] **Step 7: Commit the migration**

```bash
git add backend/alembic/versions/<rev>_add_extra_metrics_to_messages.py
git commit -m "$(cat <<'EOF'
feat(db): add extra_metrics JSON column to messages

Nullable JSON column to store agent-loop telemetry fields that don't
warrant individual columns (rounds_used, tools_called, unique_tools,
timeouts, truncations, stuck_triggered, synthesis_fallback,
finished_normally, max_rounds_hit, slowest_tool_name, slowest_tool_ms,
total_tool_ms, provider). Token counts and latency continue to live
in their existing dedicated columns.
EOF
)"
```

---

## Task 4: Backend model + schema — add `extra_metrics` field, extend `MessageMetrics`

**Files:**
- Modify: `backend/app/models/message.py`
- Modify: `backend/app/schemas/chat.py`
- Test: `backend/tests/test_chat_models.py` (extend if exists, or skip — see Step 5)

- [ ] **Step 1: Append the `extra_metrics` mapped column to the `Message` model**

Open `backend/app/models/message.py`. Find the existing column definitions (`tokens_total`, `tokens_input`, etc.). Add a new line right after them:

```python
extra_metrics: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
```

If `JSON` and `Optional` are not yet imported in the file, add them. Most likely `Optional` already comes from `typing` and `JSON` may need to be imported from `sqlalchemy`:

```python
from sqlalchemy import JSON
from typing import Optional
```

Verify by reading the top of the file — only add imports that aren't already present.

- [ ] **Step 2: Extend `MessageMetrics` schema with the new fields**

Open `backend/app/schemas/chat.py`. Find the existing `MessageMetrics` class (around line 24). Replace it with the extended version:

```python
class MessageMetrics(BaseModel):
    latency: Optional[float] = None
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    tokens_total: Optional[int] = None
    # NEW — populated from msg.extra_metrics (a JSON dict on the message)
    rounds_used: Optional[int] = None
    tools_called: Optional[int] = None
    unique_tools: Optional[int] = None
    timeouts: Optional[int] = None
    truncations: Optional[int] = None
    stuck_triggered: Optional[bool] = None
    synthesis_fallback: Optional[bool] = None
    finished_normally: Optional[bool] = None
    max_rounds_hit: Optional[bool] = None
    slowest_tool_name: Optional[str] = None
    slowest_tool_ms: Optional[float] = None
    total_tool_ms: Optional[float] = None
    provider: Optional[str] = None
```

- [ ] **Step 3: Update `MessageOut.from_message` to spread `extra_metrics` into `MessageMetrics`**

Same file (`backend/app/schemas/chat.py`). Find the existing block that constructs `metrics`:

```python
metrics = None
if msg.latency is not None or msg.tokens_total is not None:
    metrics = MessageMetrics(
        latency=msg.latency,
        tokens_input=msg.tokens_input,
        tokens_output=msg.tokens_output,
        tokens_total=msg.tokens_total,
    )
```

Replace with this version that also reads `extra_metrics` and passes through known fields:

```python
metrics = None
extra = getattr(msg, "extra_metrics", None) or {}
if (
    msg.latency is not None
    or msg.tokens_total is not None
    or extra
):
    # Filter extra_metrics to only the keys MessageMetrics declares so
    # unrelated content in the JSON column doesn't leak through.
    known_extra_keys = {
        "rounds_used",
        "tools_called",
        "unique_tools",
        "timeouts",
        "truncations",
        "stuck_triggered",
        "synthesis_fallback",
        "finished_normally",
        "max_rounds_hit",
        "slowest_tool_name",
        "slowest_tool_ms",
        "total_tool_ms",
        "provider",
    }
    filtered_extra = {k: v for k, v in extra.items() if k in known_extra_keys}
    metrics = MessageMetrics(
        latency=msg.latency,
        tokens_input=msg.tokens_input,
        tokens_output=msg.tokens_output,
        tokens_total=msg.tokens_total,
        **filtered_extra,
    )
```

- [ ] **Step 4: Run the existing schema/model tests as a smoke check**

Run: `docker exec fn-backend python -m pytest tests/test_chat_models.py tests/test_chat_routes.py -q 2>&1 | tail -3`

Expected: all pass. The schema change adds optional fields, which is backward-compatible.

If `test_chat_models.py` doesn't exist in your tests directory, skip and run only the chat routes test.

- [ ] **Step 5: Add a focused test for the schema extension**

If `backend/tests/test_chat_models.py` exists, append the test there. Otherwise create the file:

```python
# backend/tests/test_chat_models.py — append this test

import pytest

from app.schemas.chat import MessageMetrics, MessageOut


class _FakeMessage:
    """Minimal stand-in for the Message ORM model used by from_message."""

    def __init__(
        self,
        public_id="msg-test-extra",
        chat_id=1,
        role="assistant",
        content="hi",
        latency=1.5,
        tokens_input=100,
        tokens_output=50,
        tokens_total=150,
        extra_metrics=None,
        sources_json=None,
        files=None,
        status="completed",
    ):
        from datetime import datetime, timezone

        self.public_id = public_id
        self.chat_id = chat_id
        self.role = role
        self.content = content
        self.created_at = datetime.now(timezone.utc)
        self.latency = latency
        self.tokens_input = tokens_input
        self.tokens_output = tokens_output
        self.tokens_total = tokens_total
        self.extra_metrics = extra_metrics
        self.sources_json = sources_json
        self.files = files or []
        self.status = status
        self.chat = None  # MessageOut.from_message handles missing chat


def test_message_out_spreads_extra_metrics_into_response():
    msg = _FakeMessage(
        extra_metrics={
            "provider": "openai",
            "rounds_used": 2,
            "tools_called": 1,
            "unique_tools": 1,
            "timeouts": 0,
            "truncations": 0,
            "stuck_triggered": False,
            "synthesis_fallback": False,
            "finished_normally": True,
            "max_rounds_hit": False,
            "slowest_tool_name": "web_search",
            "slowest_tool_ms": 412.5,
            "total_tool_ms": 893.4,
        }
    )

    out = MessageOut.from_message(msg)
    assert out.metrics is not None
    assert out.metrics.tokens_total == 150
    assert out.metrics.latency == 1.5
    # New fields flatten in.
    assert out.metrics.provider == "openai"
    assert out.metrics.rounds_used == 2
    assert out.metrics.slowest_tool_name == "web_search"
    assert out.metrics.synthesis_fallback is False


def test_message_out_filters_unknown_extra_metrics_keys():
    """extra_metrics may contain unrelated keys (e.g. from a future field
    rolled back). MessageOut should drop unknown keys, not raise."""
    msg = _FakeMessage(
        extra_metrics={
            "provider": "openai",
            "rounds_used": 1,
            "some_future_field_we_dont_know_about": "ignored",
        }
    )

    out = MessageOut.from_message(msg)
    assert out.metrics.provider == "openai"
    assert out.metrics.rounds_used == 1
    # Unknown keys silently dropped — no error.


def test_message_out_handles_null_extra_metrics():
    """Old messages have extra_metrics=None — must not crash."""
    msg = _FakeMessage(extra_metrics=None)
    out = MessageOut.from_message(msg)
    assert out.metrics is not None
    assert out.metrics.tokens_total == 150
    assert out.metrics.provider is None
```

Run: `docker exec fn-backend python -m pytest tests/test_chat_models.py -v`

Expected: 3 new tests pass.

- [ ] **Step 6: Run the full agent-path suite**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py tests/test_chat_e2e.py tests/test_chat_routes.py tests/test_agent_worker.py tests/test_workflows.py tests/test_search.py tests/test_config.py tests/test_auth.py tests/test_memory_throttle.py tests/test_adapters.py tests/test_driver.py tests/test_llm_provider.py tests/test_chat_models.py -q 2>&1 | tail -3`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/message.py backend/app/schemas/chat.py backend/tests/test_chat_models.py
git commit -m "$(cat <<'EOF'
feat(schema): extend MessageMetrics with agent-telemetry fields

Adds extra_metrics field on Message model (reads the new JSON column).
MessageMetrics schema gains optional fields for the agent loop's
diagnostic data (rounds_used, tools_called, unique_tools, timeouts,
truncations, stuck_triggered, synthesis_fallback, finished_normally,
max_rounds_hit, slowest_tool_name, slowest_tool_ms, total_tool_ms,
provider). MessageOut.from_message spreads filtered extra_metrics
into the response so only known keys leak through.

Tests verify: spread happens correctly, unknown keys are dropped,
null extra_metrics doesn't crash.
EOF
)"
```

---

## Task 5: Router — consume `TelemetryEnd`, persist, extend `metrics` SSE event

**Files:**
- Modify: `backend/app/routers/chats.py` (around lines 1530-1545 for stream consumption, around line 1735 for metrics SSE)

- [ ] **Step 1: Update the stream consumption block**

Open `backend/app/routers/chats.py`. Find the `async for chunk in stream_with_tools(...)` block (around line 1530). It currently treats every yielded item as a string and unconditionally appends to `full_response`, drains the action queue, and emits a `message` SSE event.

Add an import at the top of `chats.py` (next to other `from app.llm.driver import ...` imports if any, otherwise next to `from app.llm.provider import stream_with_tools`):

```python
from app.llm.driver import TelemetryEnd
```

Then replace the body of the `async for chunk in stream_with_tools(...)` loop with branching on event type. Find this:

```python
async for chunk in stream_with_tools(
    llm_messages,
    settings,
    tools=tool_defs if tool_defs and not has_vision else None,
    tool_executor=tool_executor if not has_vision else None,
    on_tool_call=on_tool_call_track,
    max_tool_rounds=tool_rounds,
    vision=has_vision,
    model_config=resolved_model_config,
):
    # Drain action queue — send immediately
    while not tool_action_queue.empty():
        action = await tool_action_queue.get()
        await queue.put({"event": "action", "data": action})
    full_response += chunk
    await queue.put({"event": "message", "data": chunk})

    # Stream artifact files as they complete
    for art_event in art_stream.feed(chunk):
        # ... existing artifact handling ...
```

Replace with:

```python
loop_telemetry: dict = {}
async for chunk in stream_with_tools(
    llm_messages,
    settings,
    tools=tool_defs if tool_defs and not has_vision else None,
    tool_executor=tool_executor if not has_vision else None,
    on_tool_call=on_tool_call_track,
    max_tool_rounds=tool_rounds,
    vision=has_vision,
    model_config=resolved_model_config,
):
    # Telemetry event: capture and skip — no text to append, no artifact parse.
    if isinstance(chunk, TelemetryEnd):
        loop_telemetry = chunk.data
        continue
    # Drain action queue — send immediately
    while not tool_action_queue.empty():
        action = await tool_action_queue.get()
        await queue.put({"event": "action", "data": action})
    full_response += chunk
    await queue.put({"event": "message", "data": chunk})

    # Stream artifact files as they complete
    for art_event in art_stream.feed(chunk):
        # ... existing artifact handling unchanged ...
```

The single `if isinstance(chunk, TelemetryEnd)` guard with `continue` keeps every existing line of artifact-streaming, action-queue-draining, and message-emitting logic intact for string chunks — they only run when chunk is not a TelemetryEnd. The `loop_telemetry` dict captures the data for use later in the same function.

- [ ] **Step 2: Persist loop telemetry + extend the metrics SSE event**

Same file. Find the existing `metrics = {}` / hooks block around line 1721:

```python
# 6. post_message hooks (latency calculated here)
hook_ctx = await run_post_message_hooks(...)

# Collect metrics from hooks and persist
metrics = {}
if "latency_seconds" in hook_ctx.metadata:
    metrics["latency"] = hook_ctx.metadata["latency_seconds"]
if "tokens_total" in hook_ctx.metadata:
    metrics["tokens_input"] = hook_ctx.metadata["tokens_input"]
    metrics["tokens_output"] = hook_ctx.metadata["tokens_output"]
    metrics["tokens_total"] = hook_ctx.metadata["tokens_total"]
if metrics:
    assistant_msg.latency = metrics.get("latency")
    assistant_msg.tokens_input = metrics.get("tokens_input")
    assistant_msg.tokens_output = metrics.get("tokens_output")
    assistant_msg.tokens_total = metrics.get("tokens_total")
    # ... persist + emit SSE
    await queue.put({"event": "metrics", "data": json.dumps(metrics)})
```

Replace with this version that seeds metrics from `loop_telemetry` first, then lets hooks override, then writes everything (including extra_metrics) and emits the combined dict:

```python
# 6. post_message hooks (latency calculated here)
hook_ctx = await run_post_message_hooks(...)

# Seed metrics from the agent loop's telemetry (SDK-accurate counts).
# Hooks may override token/latency below.
metrics = {}
extra_metrics_keys = {
    "rounds_used",
    "tools_called",
    "unique_tools",
    "timeouts",
    "truncations",
    "stuck_triggered",
    "synthesis_fallback",
    "finished_normally",
    "max_rounds_hit",
    "slowest_tool_name",
    "slowest_tool_ms",
    "total_tool_ms",
    "provider",
}
extra_metrics = {
    k: v for k, v in loop_telemetry.items() if k in extra_metrics_keys
}
if loop_telemetry.get("prompt_tokens") is not None:
    metrics["tokens_input"] = loop_telemetry["prompt_tokens"]
    metrics["tokens_output"] = loop_telemetry["completion_tokens"]
    metrics["tokens_total"] = loop_telemetry["total_tokens"]

# Hooks override (last-write-wins for token/latency).
if "latency_seconds" in hook_ctx.metadata:
    metrics["latency"] = hook_ctx.metadata["latency_seconds"]
if "tokens_total" in hook_ctx.metadata:
    metrics["tokens_input"] = hook_ctx.metadata["tokens_input"]
    metrics["tokens_output"] = hook_ctx.metadata["tokens_output"]
    metrics["tokens_total"] = hook_ctx.metadata["tokens_total"]

if metrics or extra_metrics:
    assistant_msg.latency = metrics.get("latency")
    assistant_msg.tokens_input = metrics.get("tokens_input")
    assistant_msg.tokens_output = metrics.get("tokens_output")
    assistant_msg.tokens_total = metrics.get("tokens_total")
    if extra_metrics:
        assistant_msg.extra_metrics = extra_metrics
    # Combined SSE payload includes both flat metrics and extra_metrics fields.
    sse_payload = {**metrics, **extra_metrics}
    await queue.put({"event": "metrics", "data": json.dumps(sse_payload)})
```

The behavior preservation invariants:
- If only hooks fire (non-tool-loop response), `loop_telemetry` is empty `{}`. `extra_metrics` is empty. The metrics dict comes purely from hooks. `assistant_msg.extra_metrics` is NOT written (stays NULL). Behavior matches today.
- If only the loop runs (no hooks override), metrics has tokens from loop, extra_metrics has the diagnostic fields, both persisted, both in SSE.
- If both fire, hooks override token/latency in metrics; extra_metrics is preserved.

- [ ] **Step 3: Find and update the existing usage-tracking calls that reference `metrics["tokens_input"]`**

Same file. There's a usage-tracking call near line 1740 that uses `metrics.get("tokens_input", 0)` — leave it alone; it reads from the same dict you just populated. Verify it still works by reading the code around it; do not edit unless something is obviously broken.

Also verify the quota-check call near line 1163 (`usage["tokens_total"] >= quota.tokens_hard`) is reading from a different dict (`usage`, not `metrics`); it's unrelated and unaffected.

- [ ] **Step 4: Smoke-check: run the chat routes / e2e tests**

Run: `docker exec fn-backend python -m pytest tests/test_chat_routes.py tests/test_chat_e2e.py -q 2>&1 | tail -3`

Expected: all pass. These test the chat router path directly, so they catch any obvious wiring break.

If a test fails with `NameError: name 'TelemetryEnd' is not defined` — your import at the top of chats.py is missing or in the wrong place. Fix and rerun.

If a test fails with `AttributeError: ... has no attribute 'extra_metrics'` — the model migration didn't apply, or the model file isn't picking up the new column. Confirm Task 3 + Task 4 Step 1 completed successfully.

- [ ] **Step 5: Run the full agent-path test suite**

Run: `docker exec fn-backend python -m pytest tests/ -q 2>&1 | tail -3`

Expected: still all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/chats.py
git commit -m "$(cat <<'EOF'
feat(chat): consume TelemetryEnd from stream, persist + emit metrics

Router now branches on stream event type — TelemetryEnd events
populate a loop_telemetry dict that's used to seed message
metrics and a new extra_metrics JSON column. Hooks still override
token/latency last-write-wins. The existing `metrics` SSE event
is now extended with the loop's diagnostic fields when present.

Non-tool-loop responses (no TelemetryEnd) keep prior behavior:
metrics from hooks only, extra_metrics stays NULL.
EOF
)"
```

---

## Task 6: Frontend types — extend `MessageMetrics` interface

**Files:**
- Modify: `frontend/src/lib/api.ts` (around line 158)

- [ ] **Step 1: Extend the `MessageMetrics` interface**

Open `frontend/src/lib/api.ts`. Find the existing `export interface MessageMetrics` (around line 158). Replace its body with:

```typescript
export interface MessageMetrics {
  latency?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  // NEW — agent-loop telemetry (matches backend MessageMetrics schema)
  rounds_used?: number;
  tools_called?: number;
  unique_tools?: number;
  timeouts?: number;
  truncations?: number;
  stuck_triggered?: boolean;
  synthesis_fallback?: boolean;
  finished_normally?: boolean;
  max_rounds_hit?: boolean;
  slowest_tool_name?: string;
  slowest_tool_ms?: number;
  total_tool_ms?: number;
  provider?: string;
}
```

The existing `metrics` SSE event handler at line 552-554 (`callbacks.onMetrics?.(JSON.parse(data))`) already handles the new fields — they'll be present on the parsed object.

- [ ] **Step 2: TypeScript compile-check**

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`. Adding optional fields to an interface doesn't break any existing consumer.

- [ ] **Step 3: Lint**

Run: `docker exec fn-frontend npm run lint; echo "lint=$?"`

Expected: `lint=0`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(api): extend MessageMetrics with agent-telemetry fields

Optional fields matching the backend MessageMetrics schema. The
existing `metrics` SSE event handler picks up the new fields
automatically since it's a JSON.parse pass-through.
EOF
)"
```

---

## Task 7: Frontend tooltip component — `tooltip.tsx` on `@base-ui/react/tooltip`

This codebase's shadcn UI is built on `@base-ui/react`, not Radix. There's no existing `Tooltip` component in `frontend/src/components/ui/`. We create a minimal one matching the existing `button.tsx` pattern.

**Files:**
- Create: `frontend/src/components/ui/tooltip.tsx`

- [ ] **Step 1: Verify `@base-ui/react` exposes a tooltip module**

Run: `docker exec fn-frontend node -e "console.log(Object.keys(require('@base-ui/react/tooltip')))"`

Expected: an array printed that includes at least `Provider`, `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`. If the import fails or the surface is different, fall back to a manual hover-popover (skip this task and set the `MessageFooter` to use a `title` attribute on its info button).

Assuming the surface matches Base UI's documented Tooltip, continue:

- [ ] **Step 2: Create `frontend/src/components/ui/tooltip.tsx`**

Create the file with this exact content:

```tsx
"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import * as React from "react"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup> {
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Popup>,
  TooltipContentProps
>(({ className, side = "top", align = "center", children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner side={side} align={align} sideOffset={6}>
      <TooltipPrimitive.Popup
        ref={ref}
        className={cn(
          "z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = "TooltipContent"

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
```

If `@base-ui/react/tooltip`'s actual API differs from what's used above (e.g., no `Positioner.sideOffset` prop, different child slot names), adapt the JSX to match the SDK's actual surface — refer to `@base-ui/react/tooltip`'s exports verified in Step 1. The principles (forwardRef, side/align, portal-mounted popup) carry over.

- [ ] **Step 3: TypeScript compile-check**

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`. If errors mention props or types that don't exist on `@base-ui/react/tooltip`, adjust the imports and types to match the actual SDK exports.

- [ ] **Step 4: Lint**

Run: `docker exec fn-frontend npm run lint; echo "lint=$?"`

Expected: `lint=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/tooltip.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add shadcn-style Tooltip component on @base-ui/react

Mirrors the existing button.tsx pattern (shadcn API surface, @base-ui
under the hood). Exposes Tooltip, TooltipTrigger, TooltipContent,
and TooltipProvider.

Used in the upcoming MessageFooter component (Task 8).
EOF
)"
```

---

## Task 8: `MessageFooter` component

**Files:**
- Create: `frontend/src/components/message-footer.tsx`
- Test: optional, see Step 4

- [ ] **Step 1: Create the component**

Create `frontend/src/components/message-footer.tsx` with this exact content:

```tsx
import { AlertTriangle, Info } from "lucide-react"
import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MessageMetrics } from "@/lib/api"

interface Props {
  metrics: MessageMetrics
}

interface Chip {
  label: string
  tone: "warn" | "info"
}

export function MessageFooter({ metrics }: Props) {
  const chips: Chip[] = []
  if ((metrics.timeouts ?? 0) > 0) {
    chips.push({
      label:
        metrics.timeouts === 1
          ? "1 tool timed out"
          : `${metrics.timeouts} tools timed out`,
      tone: "warn",
    })
  }
  if (metrics.stuck_triggered) {
    chips.push({ label: "Repeated tool calls", tone: "warn" })
  }
  if (metrics.synthesis_fallback) {
    chips.push({ label: "Forced synthesis", tone: "info" })
  }
  if (metrics.max_rounds_hit) {
    chips.push({ label: "Hit round limit", tone: "warn" })
  }

  const hasData =
    metrics.tokens_total != null ||
    metrics.latency != null ||
    chips.length > 0
  if (!hasData) return null

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs">
      {chips.map((c, i) => (
        <span
          key={i}
          className={
            c.tone === "warn"
              ? "inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
              : "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
          }
        >
          <AlertTriangle className="h-3 w-3" />
          {c.label}
        </span>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Show response details"
              className="rounded text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          }
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          <MetricsTable metrics={metrics} />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function MetricsTable({ metrics }: Props) {
  const rows: { k: string; v: string }[] = []

  if (metrics.provider) rows.push({ k: "Provider", v: metrics.provider })
  if (metrics.rounds_used != null) {
    rows.push({ k: "Rounds", v: String(metrics.rounds_used) })
  }
  if (metrics.tools_called != null) {
    rows.push({
      k: "Tools",
      v:
        metrics.unique_tools != null
          ? `${metrics.tools_called} (${metrics.unique_tools} unique)`
          : String(metrics.tools_called),
    })
  }
  if (
    metrics.tokens_input != null ||
    metrics.tokens_output != null ||
    metrics.tokens_total != null
  ) {
    const parts: string[] = []
    if (metrics.tokens_input != null) parts.push(`${metrics.tokens_input} in`)
    if (metrics.tokens_output != null) parts.push(`${metrics.tokens_output} out`)
    if (metrics.tokens_total != null) parts.push(`${metrics.tokens_total} total`)
    rows.push({ k: "Tokens", v: parts.join(" · ") })
  }
  if (metrics.latency != null) {
    rows.push({ k: "Latency", v: `${metrics.latency.toFixed(2)}s` })
  }
  if (metrics.total_tool_ms != null) {
    rows.push({
      k: "Tool time",
      v: `${(metrics.total_tool_ms / 1000).toFixed(2)}s`,
    })
  }
  if (metrics.slowest_tool_name) {
    rows.push({
      k: "Slowest",
      v:
        metrics.slowest_tool_ms != null
          ? `${metrics.slowest_tool_name} · ${Math.round(metrics.slowest_tool_ms)}ms`
          : metrics.slowest_tool_name,
    })
  }

  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map((r) => (
        <React.Fragment key={r.k}>
          <span className="text-muted-foreground">{r.k}</span>
          <span>{r.v}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
```

Note: the `TooltipTrigger` uses the `render` prop pattern (consistent with `@base-ui/react`'s polymorphism — same as the `Button asChild → render` adaptation we did in the earlier inline-PDF task). If the actual `@base-ui/react/tooltip` API for `TooltipTrigger` differs (e.g., it takes children directly and you need a different wrapping pattern), adapt to match the SDK as verified in Task 7 Step 1.

- [ ] **Step 2: TypeScript compile-check**

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`.

If TypeScript errors appear about `TooltipTrigger`'s render prop or about React.Fragment with a key, adjust:
- For Fragment + key: ensure the `import * as React from "react"` at the top is correct.
- For TooltipTrigger render: replace with whatever pattern the actual `@base-ui/react/tooltip` exposes (e.g., `<TooltipTrigger><button .../></TooltipTrigger>` with children).

- [ ] **Step 3: Lint**

Run: `docker exec fn-frontend npm run lint; echo "lint=$?"`

Expected: `lint=0`.

- [ ] **Step 4 (optional): Add a Vitest unit test**

If your project has Vitest set up (check `frontend/package.json` for `vitest` or `jest`), create `frontend/src/components/__tests__/message-footer.test.tsx`:

```tsx
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageFooter } from "@/components/message-footer"

describe("MessageFooter", () => {
  it("returns null when there's no useful data", () => {
    const { container } = render(<MessageFooter metrics={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders the info button when only basic counts are present", () => {
    const { getByLabelText, queryByText } = render(
      <MessageFooter metrics={{ tokens_total: 100, latency: 1.5 }} />,
    )
    expect(getByLabelText(/show response details/i)).toBeTruthy()
    expect(queryByText(/timed out/i)).toBeNull()
  })

  it("renders a warning chip when timeouts > 0", () => {
    const { getByText } = render(
      <MessageFooter metrics={{ timeouts: 1 }} />,
    )
    expect(getByText("1 tool timed out")).toBeTruthy()
  })

  it("renders multiple chips when multiple flags are set", () => {
    const { getByText } = render(
      <MessageFooter
        metrics={{ stuck_triggered: true, synthesis_fallback: true }}
      />,
    )
    expect(getByText("Repeated tool calls")).toBeTruthy()
    expect(getByText("Forced synthesis")).toBeTruthy()
  })
})
```

If your project doesn't have Vitest, skip this step — the manual smoke test in Task 9 Step 5 will catch UI regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/message-footer.tsx
# Add the test file too if you created it.
git commit -m "$(cat <<'EOF'
feat(chat): add MessageFooter component for agent telemetry

Renders permanent warning chips (timeouts, stuck loop, forced
synthesis, max rounds hit) and an Info icon that reveals a
tooltip with the full metrics table on hover/focus. Returns
null when there's no useful data, so non-tool-loop messages
stay visually clean.
EOF
)"
```

---

## Task 9: Integrate `MessageFooter` into `MessageBubble`

**Files:**
- Modify: `frontend/src/components/message-bubble.tsx`

- [ ] **Step 1: Import `MessageFooter`**

Open `frontend/src/components/message-bubble.tsx`. At the top of the file, alongside other component imports, add:

```tsx
import { MessageFooter } from "@/components/message-footer"
```

- [ ] **Step 2: Render `MessageFooter` after the message content for assistant messages**

Find the assistant-message branch in the JSX. The structure roughly looks like:

```tsx
) : isUser ? (
  // ... user message rendering ...
) : (
  // assistant message rendering — markdown content here
)
```

Inside the assistant branch, find where the markdown / message content is rendered (the closing of the markdown block). Add the footer **right after** the content ends, **before** any closing wrapper tags:

```tsx
{/* existing markdown render */}
<MessageMarkdown ... />
{/* NEW: render footer if metrics are present */}
{metrics && <MessageFooter metrics={metrics} />}
```

The `metrics` prop is already destructured by `MessageBubble` (per the existing signature near line 180). It's optional / nullable — when null/undefined, `MessageFooter` simply doesn't render.

- [ ] **Step 3: TypeScript compile-check**

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`.

- [ ] **Step 4: Lint**

Run: `docker exec fn-frontend npm run lint; echo "lint=$?"`

Expected: `lint=0`.

- [ ] **Step 5: Manual smoke test (only the user can do this)**

This step is the user's responsibility — the implementer just notes it as the verification step.

1. Start the local stack: `make local-db`, `make local-backend`, `make local-frontend`.
2. Sign in. Open or create a chat.
3. Ask the agent a question that uses tools (e.g., "what's the weather in Tokyo right now?" — triggers web_search).
4. Watch the message stream. After the response completes, an `Info` icon should appear at the end of the assistant message.
5. Hover the icon → tooltip appears with provider, rounds, tools, tokens, latency, slowest tool.
6. Reload the page. Confirm the icon and tooltip are still there (data persisted).
7. (Optional) Trigger a timeout: configure a tool that sleeps 60+ seconds with `tool_call_timeout_s=1` in `.env`. Send a message that uses that tool. Confirm a `1 tool timed out` chip appears next to the icon.
8. Send a casual "hello" (no tools). Confirm no footer renders (since there's no metrics data for non-tool-loop responses, unless hooks populate tokens — in which case the Info icon appears alone with token counts).

If the tooltip doesn't appear on hover, check that `TooltipProvider` wraps the chat tree somewhere (often added in the root layout). If not, wrap the chat container in `<TooltipProvider>` (one-line change in the layout component).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/message-bubble.tsx
git commit -m "$(cat <<'EOF'
feat(chat): render MessageFooter on assistant messages

Imports and conditionally renders the MessageFooter component
right after the message content for assistant messages with
populated metrics. User messages are unaffected.

Closes the agent-telemetry SSE feature: backend persists +
streams telemetry, frontend now displays it.
EOF
)"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the full backend test suite**

Run: `docker exec fn-backend python -m pytest tests/ -q 2>&1 | tail -3`

Expected: all tests pass. Count should be at least 4-5 higher than the baseline (1 driver test, 1 wrappers test, 3 schema tests).

- [ ] **Step 2: Run all CI checks**

Run: `docker exec fn-backend python -m ruff check .; echo "ruff_check=$?"`

Expected: `All checks passed!`, `ruff_check=0`.

Run: `docker exec fn-backend python -m ruff format --check .; echo "ruff_format=$?"`

Expected: `ruff_format=0` (no files would be reformatted).

If reformatting is suggested, run `docker exec fn-backend python -m ruff format .` and commit the result with message `style: ruff format`.

Run: `docker exec fn-frontend npm run lint; echo "lint=$?"`

Expected: `lint=0`.

Run: `docker exec fn-frontend npx tsc --noEmit; echo "tsc=$?"`

Expected: `tsc=0`.

Run: `docker exec -e NEXT_PUBLIC_API_URL=http://localhost:8000 fn-frontend npm run build; echo "build=$?"`

Expected: build succeeds, `build=0`.

- [ ] **Step 3: Confirm git history is clean and ordered**

Run: `git log --oneline -10`

Expected (top to bottom, most recent first):
```
<sha9> feat(chat): render MessageFooter on assistant messages
<sha8> feat(chat): add MessageFooter component for agent telemetry
<sha7> feat(ui): add shadcn-style Tooltip component on @base-ui/react
<sha6> feat(api): extend MessageMetrics with agent-telemetry fields
<sha5> feat(chat): consume TelemetryEnd from stream, persist + emit metrics
<sha4> feat(schema): extend MessageMetrics with agent-telemetry fields
<sha3> feat(db): add extra_metrics JSON column to messages
<sha2> feat(llm): pass non-string LoopEvents through the post-processing wrappers
<sha1> feat(llm): yield TelemetryEnd from run_tool_loop
<previous-commit>
```

- [ ] **Step 4: Final manual smoke test**

The user runs through Task 9 Step 5 again on a clean dev startup. If anything's off, file a fix as a follow-up; the feature is structurally complete.

---

## Done

The feature is shipped:

- The agent loop's per-response telemetry is captured at the SDK boundary, persisted to `messages.extra_metrics` (JSON) + the existing `tokens_*` and `latency` columns.
- The chat UI renders a footer on each assistant message: warning chips (rare, automatic) for diagnostic events; an `Info` icon that reveals the full metrics table on hover.
- Both reload safely from DB.
- The new SSE event reuses the existing `metrics` channel — no client-API breakage.
- The post-processing wrappers in `provider.py` are now type-stream-aware. Future `LoopEvent` subclasses (e.g., `ToolStarted`) drop in without further wrapper changes.

What's not in scope (per spec): per-message $cost, telemetry on non-tool-loop responses, retroactive backfill, aggregate views.
