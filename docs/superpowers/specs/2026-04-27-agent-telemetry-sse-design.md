# Agent Telemetry SSE — Design Spec

## Problem

The agent loop in `backend/app/llm/driver.py` (`run_tool_loop`) builds a rich per-response telemetry dict at the end of every streaming response — `provider`, `rounds_used`, `tools_called`, `unique_tools`, `timeouts`, `truncations`, `stuck_triggered`, `synthesis_fallback`, `finished_normally`, `max_rounds_hit`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `slowest_tool_name`, `slowest_tool_ms`, `total_tool_ms`. Today this lives only in a structured log line. Users and operators can't see it from the chat UI.

Today's chat already has a `MessageMetrics` schema (`latency`, `tokens_input/output/total`) but the values come from user-defined `post_message` hooks (manually counted), not from the SDK-reported usage the loop already has. So even the basic numbers shown in the UI are estimates, not ground truth.

## Solution

Bubble the loop's telemetry from `run_tool_loop` through `stream_with_tools` and the post-processing wrappers up to the chat router, persist it to the message, and stream it as an SSE `usage` event so the frontend can render a small footer (with warning chips) on the assistant message.

Use a typed event-stream pattern — the loop's yield type changes from `AsyncIterator[str]` to `AsyncIterator[str | LoopEvent]`, where `LoopEvent` is a marker base class with `TelemetryEnd` as the first concrete subtype. The pattern accommodates future event types (e.g., per-tool start/end) without further wrapper refactors.

## Decisions Already Made

The brainstorm settled these axes:

- **Footer content (Q1):** counts (tokens, latency) plus diagnostic chips when something went sideways (`timeouts > 0`, `stuck_triggered`, `synthesis_fallback`, `max_rounds_hit`). No per-message $cost — out of scope.
- **Persistence (Q2):** fully persistent. Token counts go in existing `messages` columns; the rest goes in a new nullable `extra_metrics` JSON column. Survives reload.
- **Visibility (Q3):** hover-only details, permanent warning chips. Default state shows chips (rare) plus a small `Info` icon hover-target; tooltip reveals the full metrics table. No always-visible muted footer.
- **Telemetry-bubbling mechanism:** typed event stream (option B from the architecture question). The pattern is more upfront refactor work but extends cleanly. The post-processing wrappers gain a 3-line pass-through guard each.

## Architecture & Data Flow

**End-to-end:**

1. `run_tool_loop` yields text chunks during streaming (unchanged), then yields a final `TelemetryEnd(data=dict)` event before exiting.
2. Post-processing wrappers in `provider.py` (`_filter_tool_leaks`, `_buffered_stream`, `_with_idle_timeout`) pass non-string events through untouched and continue to operate on strings as before.
3. `stream_with_tools` propagates the combined stream to the router.
4. `chats.py` SSE handler branches on event type:
   - `str` → existing `message` SSE event (one chunk).
   - `TelemetryEnd` → persist to DB (token columns + new `extra_metrics` JSON), then emit a new `usage` SSE event with the full payload.
5. Frontend SSE consumer recognises `usage`, hydrates the in-flight message's `metrics` field; `MessageBubble` renders `<MessageFooter />`.
6. On page reload, `MessageOut.from_message` reads from the persisted DB columns + `extra_metrics`; the footer renders identically.

**Hook compatibility:** post-message hooks still run *after* the telemetry persist step. If a hook explicitly sets `tokens_input/output/total` or `latency`, it overrides. This preserves existing user customization.

## Backend — Driver

`backend/app/llm/driver.py` adds two dataclasses:

```python
@dataclass
class LoopEvent:
    """Marker base for non-text events in the loop's output stream."""


@dataclass
class TelemetryEnd(LoopEvent):
    """Final event yielded by run_tool_loop after streaming completes."""

    data: dict
```

`run_tool_loop` change at the end of the function (after the existing `logger.info("tool_loop done", extra=...)` line):

```python
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

The `logger.info` call stays — production log observability isn't lost.

The yield type signature becomes `AsyncIterator[str | LoopEvent]` (or its `Union[str, LoopEvent]` 3.9-compat form — but the codebase is 3.12).

## Backend — Wrappers

`backend/app/llm/provider.py` — `_filter_tool_leaks`, `_buffered_stream`, `_with_idle_timeout` each get the same three-line guard at the top of their async-for loop:

```python
async for chunk in source:
    if not isinstance(chunk, str):
        yield chunk
        continue
    # ... existing string-handling logic unchanged ...
```

No other change to the wrappers. Their behavior on string chunks is identical.

`stream_with_tools` itself doesn't change — it still wraps the loop, still yields whatever flows through. Its return type annotation updates to `AsyncIterator[str | LoopEvent]` for type-correctness.

## Backend — Schema, DB, Migration

**DB column** — `backend/alembic/versions/<rev>_add_extra_metrics_to_messages.py`:

```python
def upgrade():
    op.add_column(
        "messages",
        sa.Column("extra_metrics", sa.JSON(), nullable=True),
    )

def downgrade():
    op.drop_column("messages", "extra_metrics")
```

**Model** — `backend/app/models/message.py`:

```python
extra_metrics: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
```

**Schema** — `backend/app/schemas/chat.py`:

`MessageMetrics` extends with optional fields. Existing token/latency fields stay in their dedicated columns; new fields read from `msg.extra_metrics`:

```python
class MessageMetrics(BaseModel):
    latency: Optional[float] = None
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    tokens_total: Optional[int] = None
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

`MessageOut.from_message` updates: continue reading the existing token/latency columns; additionally spread `msg.extra_metrics` (when not null) into the metrics object. Use a helper that filters keys to known field names so unrelated content in the JSON column doesn't leak through.

## Backend — Router

`backend/app/routers/chats.py` — the streaming consumer changes:

```python
async for event in stream_with_tools(...):
    if isinstance(event, str):
        yield sse_message(event)            # existing behavior
    elif isinstance(event, TelemetryEnd):
        await _save_telemetry(assistant_msg, event.data, db)
        yield sse_event("usage", event.data)
```

`_save_telemetry` extracts:
- `prompt_tokens` → `assistant_msg.tokens_input`
- `completion_tokens` → `assistant_msg.tokens_output`
- `total_tokens` → `assistant_msg.tokens_total`
- Wallclock-since-stream-start → `assistant_msg.latency` (existing latency calc applies)
- Everything else (the diagnostic fields, `slowest_tool_*`, `total_tool_ms`, `provider`, `rounds_used`, `tools_called`, `unique_tools`) → `assistant_msg.extra_metrics` (dict)

Then `await db.commit()`.

The existing post-message hooks (around `chats.py:1716+`) run *after* this. They can override any field; last write wins. This preserves the existing hook customization surface.

The `sse_event("usage", ...)` helper — if no SSE event helper exists for arbitrary event names, use the same shape as the existing event emitters: `f"event: usage\ndata: {json.dumps(payload)}\n\n"`.

## Frontend — Types & SSE

`frontend/src/lib/api.ts`:

`MessageMetrics` extends with the new optional fields verbatim from the backend schema. (Same fields, same names, same types — strict alignment.)

`streamChat` (or whichever function consumes the chat SSE stream) gets one new branch in its event-name switch:

```typescript
case "usage":
  onMetrics?.(JSON.parse(data) as MessageMetrics)
  break
```

`onMetrics` already exists in the callback set (`api.ts:436`). The chat-store consumer of `onMetrics` updates the in-flight assistant message's `metrics` field and triggers a re-render.

## Frontend — `<MessageFooter />` Component

New file `frontend/src/components/message-footer.tsx`:

```tsx
import { AlertTriangle, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import type { MessageMetrics } from "@/lib/api"

interface Props {
  metrics: MessageMetrics
}

export function MessageFooter({ metrics }: Props) {
  const chips: { label: string; tone: "warn" | "info" }[] = []
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
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Show response details"
            className="rounded text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-xs">
          <MetricsTable metrics={metrics} />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function MetricsTable({ metrics }: Props) {
  const rows: { k: string; v: string }[] = []
  if (metrics.provider) rows.push({ k: "Provider", v: metrics.provider })
  if (metrics.rounds_used != null)
    rows.push({ k: "Rounds", v: String(metrics.rounds_used) })
  if (metrics.tools_called != null)
    rows.push({
      k: "Tools",
      v:
        metrics.unique_tools != null
          ? `${metrics.tools_called} (${metrics.unique_tools} unique)`
          : String(metrics.tools_called),
    })
  if (
    metrics.tokens_input != null ||
    metrics.tokens_output != null ||
    metrics.tokens_total != null
  ) {
    const parts: string[] = []
    if (metrics.tokens_input != null) parts.push(`${metrics.tokens_input} in`)
    if (metrics.tokens_output != null)
      parts.push(`${metrics.tokens_output} out`)
    if (metrics.tokens_total != null)
      parts.push(`${metrics.tokens_total} total`)
    rows.push({ k: "Tokens", v: parts.join(" · ") })
  }
  if (metrics.latency != null)
    rows.push({ k: "Latency", v: `${metrics.latency.toFixed(2)}s` })
  if (metrics.total_tool_ms != null)
    rows.push({ k: "Tool time", v: `${(metrics.total_tool_ms / 1000).toFixed(2)}s` })
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
        <>
          <span className="text-muted-foreground">{r.k}</span>
          <span>{r.v}</span>
        </>
      ))}
    </div>
  )
}
```

**Tooltip note:** `@/components/ui/tooltip` may need verification at implementation time. If the project's shadcn variant is `@base-ui/react`-based (consistent with the `Button` we adapted earlier), the API may differ slightly. The implementer checks at task time.

## Frontend — `MessageBubble` Integration

`frontend/src/components/message-bubble.tsx` — single new line. Right after the existing message-content render (the markdown block), within the assistant-message branch:

```tsx
{!isUser && metrics && <MessageFooter metrics={metrics} />}
```

Import:

```tsx
import { MessageFooter } from "@/components/message-footer"
```

The user-message branch (with file attachments) is unchanged.

## Out of Scope

- **Per-message $cost.** The token counts unlock this; multiplying by per-model rates and showing `$0.0042` is a follow-up. Spec explicitly stayed at C (counts + chips, no cost).
- **Telemetry on non-tool-loop responses.** The simpler `stream_simple` path and one-shot `respond` path don't go through `run_tool_loop`. Their messages get whatever metrics existing post-message hooks compute (unchanged). Adding telemetry to these paths would require similar treatment in each adapter and is out of scope.
- **Per-tool start/end events.** The `LoopEvent` discriminated union is designed to accommodate `ToolStartedEvent` / `ToolEndedEvent` etc., but adding them is a separate feature.
- **Editing or filtering historical metrics from the UI.** Users can't currently revisit and "clear" metrics on old messages. Out of scope.
- **Retroactive backfill.** Existing messages without `extra_metrics` show no chips/tooltip — they pre-date this feature. No data migration to populate them.
- **Aggregate views** (e.g., "show me total tokens used this week"). Per-response data only. Aggregation could come from log mining or a future analytics view.
- **Streaming of intermediate metrics.** Telemetry arrives once at the end, not progressively. Acceptable because tool loops are short (<5s typical).

## Behavior Preservation

- **Existing metrics path** (post-message hooks computing tokens/latency): unchanged. Hooks still run, still write to message columns, still override telemetry's values when set explicitly.
- **`MessageOut.from_message`**: continues to populate the existing token/latency fields from columns. Adds reading of `extra_metrics` for the new fields.
- **Existing SSE events** (`action`, `message`, `sources`, `title`, `done`, `error`): unchanged. New `usage` event added alongside.
- **Existing chat history endpoint**: unchanged response shape except for the new optional fields on `MessageMetrics`. Old clients ignore unknown fields.
- **Non-tool-loop messages** (greetings, vision, simple-stream): no `usage` event emitted, no footer rendered. Existing behavior intact.
- **Page reload**: assistant messages with stored `extra_metrics` render with footer + chips immediately, identical to the live-streamed appearance.

## Risk & Rollback

**Surface:** one DB column added, one driver type-signature change, three wrappers each gaining a 3-line guard, router gains an event-type branch, schema extends with optional fields, frontend adds one component + one new SSE event handler.

**Failure modes:**
- DB migration failure on prod: rollback via `alembic downgrade`.
- Existing test suite picking up the new yield type and breaking: tests should still pass because the wrappers are the only consumers of the pre-`stream_with_tools` stream and they pass through non-strings. End-to-end consumers (`chats.py`) already use `async for` and just need the type branching.
- Frontend tooltip component missing or behaving differently: the spec implementer checks at task time; fallback options (native `<title>` attribute, click-popover) exist.
- A hook overrides telemetry's accurate values with worse estimates: not a regression, that's hook behavior. User can audit their hooks.

**Rollback:** revert the feature branch; `alembic downgrade` removes the column. No data lost (all existing messages have `extra_metrics = NULL`). Frontend renders without footer because `metrics.tokens_total` etc. become null; no errors.
