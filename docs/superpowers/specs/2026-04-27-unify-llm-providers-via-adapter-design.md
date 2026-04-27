# Unify LLM Providers via ProviderAdapter — Design Spec

## Problem

`backend/app/llm/provider.py` contains two near-identical streaming tool-calling loops — `_anthropic_stream_with_tools` and `_openai_stream_with_tools` — each ~300 lines. Plus mirrored simpler streaming functions and one-shot response functions for each provider. Over the last work session every tool-loop improvement (signature-based stuck detection, JSON-error feedback, per-tool timeout, response truncation, telemetry, token usage tracking, per-tool latency, trailing-call gating) had to be hand-mirrored across both. We caught the trailing-call bug in OpenAI first; an identical bug in Anthropic survived until the telemetry refactor surfaced it. This is the visible symptom of structural drift, and it will keep happening.

## Solution

Replace the per-provider loops with a single shared `run_tool_loop` function that delegates provider-specific concerns to a `ProviderAdapter` Protocol. Each provider implements seven methods — only what genuinely differs (SDK streaming shape, message format, tool extraction). Everything currently duplicated (stuck detection, timeouts, truncation, telemetry, synthesis fallback gating, parallel tool execution) lives in one place.

Also unify the simpler streaming and one-shot response paths through the same adapter, so every code path that talks to an LLM goes through one interface.

## Decisions Already Made

The brainstorm settled these axes:

- **Scope:** all model-touching paths — `stream_with_tools`, the simpler `_*_stream`, and `get_llm_response`.
- **Shape:** Protocol + driver-function. Pythonic, matches existing function-based codebase style, integrates cleanly with the existing test mocking style (patching `openai.AsyncOpenAI` at the module level).
- **Migration:** big-bang in one PR. The existing 87-test safety net makes this lower-risk than staged migration with two implementations live.
- **Layout:** three files — `provider.py` (entry points), `driver.py` (shared logic), `adapters.py` (both adapters).
- **Adapter granularity:** medium — abstract only what differs; share everything else.

## File Layout

```
backend/app/llm/
├── __init__.py
├── model_config.py     (unchanged)
├── provider.py         (~120 lines — entry points, dispatch, post-processing wrappers)
├── driver.py           (~280 lines — Protocol, dataclasses, run_tool_loop, helpers)
└── adapters.py         (~250 lines total — AnthropicAdapter, OpenAIAdapter)
```

Net: ~1100 lines today → ~650 lines after, with the duplicated logic eliminated.

## Public API (unchanged)

`provider.py` continues to export the same surface so callers (`routers/chats.py`, `agent/memory.py`, etc.) require no changes:

```python
async def get_llm_response(
    messages: list[dict],
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
) -> str: ...

async def stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = None,
    vision: bool = False,
    model_config: Optional[ModelConfig] = None,
) -> AsyncIterator[str]: ...

SYSTEM_PROMPT = "..."  # re-exported from driver.py
```

## Driver — Shared Types

In `driver.py`:

```python
@dataclass
class ToolCall:
    """Provider-neutral tool call after extraction from a stream."""
    id: str
    name: str
    raw_args: Any  # dict (Anthropic) or accumulated JSON string (OpenAI)


@dataclass
class ToolCallParseError:
    """Returned by extract_tool_call_args when args cannot be parsed."""
    raw_args: str
    reason: str


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class RoundResult:
    """What the adapter returns from one streaming round."""
    tool_calls: list[ToolCall]
    usage: Usage


@dataclass
class RoundEnd:
    """Sentinel yielded as the final event of stream_round."""
    result: RoundResult
```

## Driver — ProviderAdapter Protocol

```python
class ProviderAdapter(Protocol):
    provider_name: str  # "anthropic" | "openai" — class attribute, used only
                        # for tagging the telemetry log line.

    def build_kwargs(self, messages: list, tools: list | None) -> dict:
        """Build provider-specific kwargs for the SDK call. Includes model,
        system prompt, message conversion, tool conversion, vision handling.
        """

    def stream_round(self, kwargs: dict) -> AsyncIterator[str | RoundEnd]:
        """Stream one round. Implemented as an async generator on each adapter.

        Yields text chunks (str) as they arrive. Yields exactly one RoundEnd
        as the final event carrying tool_calls + usage. (The Protocol return
        type is the iterator; the concrete implementation is `async def` with
        `yield`.)
        """

    def append_assistant_turn(self, kwargs: dict, round_result: RoundResult) -> None:
        """Mutate kwargs['messages'] to append the assistant's turn in the
        provider's expected shape (Anthropic content-block list vs OpenAI
        tool_calls structure).
        """

    def append_tool_results(
        self,
        kwargs: dict,
        results: list[tuple[str, str]],   # (tool_call_id, result_text)
        with_synthesis_nudge: bool,
    ) -> None:
        """Append tool results in the provider's shape:
        - Anthropic: one user message with tool_result blocks (+ text block
          for nudge if with_synthesis_nudge).
        - OpenAI: one tool message per result, plus a separate user message
          for the nudge if with_synthesis_nudge.

        When with_synthesis_nudge=True, also pop 'tools' from kwargs.
        """

    def extract_tool_call_args(
        self, call: ToolCall
    ) -> dict | ToolCallParseError:
        """Parse raw_args into a dict, or return ToolCallParseError.
        OpenAI does the JSON parse; Anthropic returns the dict unchanged.
        """

    async def stream_simple(self, kwargs: dict) -> AsyncIterator[str]:
        """Stream text only — no tools, no rounds. Used by the non-tool path."""

    async def respond(self, messages: list) -> str:
        """One-shot non-streaming response. Used by get_llm_response."""
```

The Protocol is structural (Python `typing.Protocol`); each concrete adapter implements these methods without inheriting.

## Driver — `run_tool_loop`

The unified replacement for both `_*_stream_with_tools`. Owns: stuck detection, parallel tool execution with timeout, truncation, telemetry, synthesis fallback gating, max-rounds enforcement.

```python
async def run_tool_loop(
    adapter: ProviderAdapter,
    messages: list,
    settings: Settings,
    tools: list,
    tool_executor,
    on_tool_call,
    max_tool_rounds: int,
) -> AsyncIterator[str]:
    kwargs = adapter.build_kwargs(messages, tools)
    seen_signatures: set[str] = set()
    finished_normally = False

    # Telemetry counters (same fields we already log).
    rounds_used = 0
    tools_called = 0
    timeouts = 0
    truncations = 0
    stuck_triggered = False
    synthesis_fallback_used = False
    unique_tools_seen: set[str] = set()
    prompt_tokens = 0
    completion_tokens = 0
    tool_timings: list[tuple[str, float]] = []

    for round_num in range(max_tool_rounds):
        rounds_used = round_num + 1

        round_result: RoundResult | None = None
        async for event in adapter.stream_round(kwargs):
            if isinstance(event, str):
                yield event
            elif isinstance(event, RoundEnd):
                round_result = event.result

        prompt_tokens += round_result.usage.prompt_tokens
        completion_tokens += round_result.usage.completion_tokens

        if not round_result.tool_calls:
            finished_normally = True
            break

        adapter.append_assistant_turn(kwargs, round_result)

        # Stuck detection — every round's calls already requested before.
        round_signatures = {
            _tool_call_signature(c.name, c.raw_args)
            for c in round_result.tool_calls
        }
        stuck = round_num > 0 and round_signatures.issubset(seen_signatures)
        seen_signatures.update(round_signatures)
        if stuck:
            stuck_triggered = True

        tools_called += len(round_result.tool_calls)
        unique_tools_seen.update(c.name for c in round_result.tool_calls)

        # Parallel tool execution with timeout + JSON-error handling.
        tool_results = await asyncio.gather(
            *[_execute_one(adapter, c, tool_executor, on_tool_call,
                           settings.tool_call_timeout_s, tool_timings)
              for c in round_result.tool_calls]
        )

        timeout_marker = f"timed out after {settings.tool_call_timeout_s}s"
        timeouts += sum(1 for _, r in tool_results if timeout_marker in r)
        if settings.tool_result_max_chars > 0:
            truncations += sum(
                1 for _, r in tool_results
                if len(r) > settings.tool_result_max_chars
            )

        truncated = [
            (tid, _truncate_tool_result(r, settings.tool_result_max_chars))
            for tid, r in tool_results
        ]
        adapter.append_tool_results(
            kwargs, truncated, with_synthesis_nudge=stuck
        )

    # Synthesis fallback — runs ONLY when we genuinely exhausted rounds with
    # no clean stop. Provider-agnostic gating.
    if not finished_normally:
        synthesis_fallback_used = True
        kwargs.pop("tools", None)
        async for event in adapter.stream_round(kwargs):
            if isinstance(event, str):
                yield event
            elif isinstance(event, RoundEnd):
                prompt_tokens += event.result.usage.prompt_tokens
                completion_tokens += event.result.usage.completion_tokens

    slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(tool_timings)
    logger.info(
        "tool_loop done",
        extra={
            "provider": adapter.provider_name,  # "openai" | "anthropic"
            "rounds_used": rounds_used,
            "tools_called": tools_called,
            "unique_tools": len(unique_tools_seen),
            "timeouts": timeouts,
            "truncations": truncations,
            "stuck_triggered": stuck_triggered,
            "synthesis_fallback": synthesis_fallback_used,
            "finished_normally": finished_normally,
            "max_rounds_hit": (
                rounds_used >= max_tool_rounds and not finished_normally
            ),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "slowest_tool_name": slowest_name,
            "slowest_tool_ms": slowest_ms,
            "total_tool_ms": total_tool_ms,
        },
    )
```

`adapter.provider_name` is a string class attribute on each adapter (`"anthropic"` / `"openai"`) used only for telemetry tagging.

## Driver — `_execute_one`

Private helper handling one tool call's full lifecycle: arg parsing, on_tool_call notification, executor invocation with timeout, latency timing.

```python
async def _execute_one(
    adapter: ProviderAdapter,
    call: ToolCall,
    tool_executor,
    on_tool_call,
    timeout_s: int,
    tool_timings: list[tuple[str, float]],
) -> tuple[str, str]:
    parsed = adapter.extract_tool_call_args(call)
    if isinstance(parsed, ToolCallParseError):
        return call.id, (
            f"Tool error: invalid JSON arguments ({parsed.reason}). "
            f"Received: {parsed.raw_args[:200]}"
        )

    if on_tool_call:
        await on_tool_call(call.name, parsed)

    start = time.perf_counter()
    try:
        try:
            result = await asyncio.wait_for(
                tool_executor(call.name, parsed),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            result = (
                f"Tool error: '{call.name}' timed out after {timeout_s}s"
            )
        except Exception as e:
            result = f"Tool error: {str(e)}"
    finally:
        tool_timings.append(
            (call.name, (time.perf_counter() - start) * 1000)
        )

    return call.id, str(result) if not isinstance(result, str) else result
```

## Adapters

`adapters.py` contains both `AnthropicAdapter` and `OpenAIAdapter`. Each is a regular class (not inheriting from anything) that satisfies `ProviderAdapter` structurally.

### AnthropicAdapter

- Constructor takes `(settings, model_config)`. Builds the Anthropic client, picks the model (`model_config.model_id` or `ANTHROPIC_MODEL` default), stores them.
- `build_kwargs` runs `_convert_to_anthropic_format(messages)` and `_convert_tools_to_anthropic(tools)` (functions move from `provider.py`), assembles `{model, max_tokens, system, messages, tools}`.
- `stream_round` wraps `client.messages.stream(**kwargs) as stream`, yields `text` from `stream.text_stream`, then yields `RoundEnd(RoundResult(tool_calls=..., usage=...))` extracting from `stream.get_final_message()`.
- `append_assistant_turn` appends `{"role": "assistant", "content": response.content}` (the raw block list).
- `append_tool_results` appends one `user` message whose `content` is a list of `tool_result` blocks (and a `text` block with `_SYNTHESIS_NUDGE` if `with_synthesis_nudge=True`); pops `tools` from kwargs in that case.
- `extract_tool_call_args` returns `call.raw_args` unchanged (it's already a dict from the SDK).
- `stream_simple` reuses `client.messages.stream` without tools, just yields text.
- `respond` calls `client.messages.create` (non-streaming) and returns `response.content[0].text`.

### OpenAIAdapter

- Constructor takes `(settings, model_config, vision=False)`. Builds the OpenAI-compatible client, picks the model.
- `build_kwargs` prepends the system message, attaches `tools` (unless vision), sets `stream: True` and `stream_options: {"include_usage": True}`.
- `stream_round` iterates `await client.chat.completions.create(**kwargs)`, accumulates `delta.content` (yielded immediately as text), accumulates `delta.tool_calls` deltas keyed by `tc.index`, captures `chunk.usage` when the usage-only chunk arrives, then yields `RoundEnd(RoundResult(tool_calls=..., usage=...))`.
- `append_assistant_turn` appends `{"role": "assistant", "content": collected_text or None, "tool_calls": [...]}`.
- `append_tool_results` appends one `{"role": "tool", "tool_call_id": id, "content": text}` message per result; if `with_synthesis_nudge=True`, also appends `{"role": "user", "content": _SYNTHESIS_NUDGE}` and pops `tools`.
- `extract_tool_call_args` does `json.loads(call.raw_args)` — returns the dict on success or `ToolCallParseError(raw_args, reason)` on `JSONDecodeError`.
- `stream_simple` is the existing simple-stream logic (no tools, no usage chunk handling needed).
- `respond` calls `client.chat.completions.create` non-streaming and returns `response.choices[0].message.content`.

## `provider.py` After Refactor

```python
import logging
from collections.abc import AsyncIterator
from typing import Optional

from app.config import Settings
from app.llm.adapters import AnthropicAdapter, OpenAIAdapter
from app.llm.driver import (
    SYSTEM_PROMPT,
    _SYNTHESIS_NUDGE,
    _summarize_tool_timings,
    _tool_call_signature,
    _truncate_tool_result,
    run_tool_loop,
)
from app.llm.model_config import ModelConfig

logger = logging.getLogger(__name__)


def _get_adapter(
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
    vision: bool = False,
):
    provider = model_config.provider if model_config else settings.ai_provider
    if provider == "anthropic":
        return AnthropicAdapter(settings, model_config)
    if provider in ("openai", "openai_compatible"):
        return OpenAIAdapter(settings, model_config, vision=vision)
    raise ValueError(f"Unsupported AI provider: {provider}")


async def get_llm_response(
    messages: list[dict],
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
) -> str:
    adapter = _get_adapter(settings, model_config)
    return await adapter.respond(messages)


async def stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = None,
    vision: bool = False,
    model_config: Optional[ModelConfig] = None,
) -> AsyncIterator[str]:
    adapter = _get_adapter(settings, model_config, vision=vision)
    rounds = max_tool_rounds or settings.max_tool_rounds

    if tools and not vision:
        raw = run_tool_loop(
            adapter, messages, settings, tools, tool_executor,
            on_tool_call, rounds,
        )
    else:
        kwargs = adapter.build_kwargs(messages, tools=None)
        raw = adapter.stream_simple(kwargs)

    async for chunk in _filter_tool_leaks(
        _buffered_stream(_with_idle_timeout(raw, settings.llm_stream_idle_timeout))
    ):
        yield chunk


# Compat shims for tests that still import the old internal symbols. They
# are 4 lines each and exist solely to keep test imports green during the
# transition; new code should call stream_with_tools.

async def _openai_stream_with_tools(
    messages, settings, tools=None, tool_executor=None,
    on_tool_call=None, max_tool_rounds=5, vision=False, model_config=None,
):
    adapter = OpenAIAdapter(settings, model_config, vision=vision)
    async for chunk in run_tool_loop(
        adapter, messages, settings, tools, tool_executor,
        on_tool_call, max_tool_rounds,
    ):
        yield chunk


async def _anthropic_stream_with_tools(
    messages, settings, tools=None, tool_executor=None,
    on_tool_call=None, max_tool_rounds=5, model_config=None,
):
    adapter = AnthropicAdapter(settings, model_config)
    async for chunk in run_tool_loop(
        adapter, messages, settings, tools, tool_executor,
        on_tool_call, max_tool_rounds,
    ):
        yield chunk


# Post-processing wrappers stay here — provider-agnostic.
async def _with_idle_timeout(...): ...
async def _buffered_stream(...): ...
async def _filter_tool_leaks(...): ...
```

## Migration Plan

Big-bang in one PR, but ordered for review clarity. Each step ends with green tests.

1. **Scaffold `driver.py`** — move pure helpers (`_tool_call_signature`, `_truncate_tool_result`, `_summarize_tool_timings`, `_SYNTHESIS_NUDGE`, `SYSTEM_PROMPT`) verbatim from `provider.py`. Add dataclasses and Protocol. Re-export helpers from `provider.py` so existing `from app.llm.provider import _tool_call_signature` test imports keep working.

2. **Write `adapters.py`** — `AnthropicAdapter` and `OpenAIAdapter` implementing the Protocol. Move `_convert_to_anthropic_format`, `_convert_tools_to_anthropic`, the per-provider client caches (`_anthropic_clients`, `_openai_clients`), and the `_get_*_client` / `_build_openai_client` helpers into `adapters.py`.

3. **Write `driver.run_tool_loop` and `_execute_one`** — single function with the structure above. All telemetry counters and the final log line ported over.

4. **Rewrite `provider.py` entry points** — `stream_with_tools` and `get_llm_response` as shown above. Add the two compat shims for test stability. Keep post-processing wrappers in this file.

5. **Delete the old code** — remove `_anthropic_stream_with_tools`, `_anthropic_stream`, `_anthropic_response`, `_openai_stream_with_tools`, `_openai_stream`, `_openai_response`, the format conversion helpers (now in `adapters.py`), and any other now-dead code from `provider.py`.

6. **Run the full agent-path test suite** — all 87 existing tests pass with no test-file changes.

7. **Add new tests** (Tiers 2 and 3 below).

8. **Commit** — one commit, message: `refactor(llm): unify Anthropic and OpenAI tool loops behind ProviderAdapter`.

## Testing Strategy

### Tier 1 — existing 87 tests, untouched

The 79 non-`test_llm_provider` tests exercise the public surface; they're unaffected. The 28 in `test_llm_provider.py` keep working because:

- Pure helpers are re-exported from `provider.py`.
- The two `_*_stream_with_tools` functions exist as 4-line compat shims dispatching to `run_tool_loop` with the right adapter.
- Provider behavior is preserved — same telemetry fields, same SSE event shapes, same error message strings, same synthesis-nudge content.

If any existing test fails, that's a regression to fix in the refactor — never in the test.

### Tier 2 — new adapter unit tests (~6 cases, ~80 lines)

In a new file `backend/tests/test_adapters.py`:

- `test_anthropic_adapter_build_kwargs_converts_image_blocks_and_tools` — verifies `_convert_to_anthropic_format` and `_convert_tools_to_anthropic` are correctly invoked; output has `system`, `model`, `max_tokens`, `tools`, message-shape conversion.
- `test_openai_adapter_build_kwargs_includes_usage_options` — verifies `stream_options.include_usage`, `stream: True`, system message prepended, tools attached when not vision, tools omitted when vision.
- `test_anthropic_adapter_append_tool_results_with_nudge_appends_text_block` — passes results + `with_synthesis_nudge=True`, checks that the appended user message has `tool_result` blocks AND a `text` block whose `text == _SYNTHESIS_NUDGE`, and that `kwargs.pop("tools")` happened.
- `test_openai_adapter_append_tool_results_with_nudge_appends_user_message` — checks separate `tool` messages plus a `user` message whose content equals `_SYNTHESIS_NUDGE`, and tools popped.
- `test_openai_adapter_extract_tool_call_args_handles_invalid_json` — bad JSON returns `ToolCallParseError` with the raw args and a reason; valid JSON returns the parsed dict.
- `test_anthropic_adapter_extract_tool_call_args_returns_dict_unchanged` — input is already a dict, returned identical.

These are pure unit tests. No I/O, no SDK mocking required.

### Tier 3 — new driver-level tests (~3 cases, ~80 lines)

In a new file `backend/tests/test_driver.py`. These use a tiny `_FakeAdapter` that satisfies the Protocol but bypasses any SDK — much simpler than the streaming-chunk fakes in `test_llm_provider.py`.

- `test_driver_runs_until_no_tool_calls_then_emits_telemetry` — adapter scripted to return one round with tool_calls then one round with empty tool_calls. Asserts `rounds_used == 2`, `tools_called == 1`, `finished_normally == True`.
- `test_driver_detects_stuck_and_strips_tools` — adapter scripted to return identical tool_calls in rounds 0 and 1. Asserts `stuck_triggered == True`, the third call to `append_tool_results` had `with_synthesis_nudge=True`.
- `test_driver_skips_tool_executor_on_invalid_args` — adapter's `extract_tool_call_args` returns `ToolCallParseError`; `tool_executor` mock asserts `assert_not_called()`; the result string starts with `"Tool error: invalid JSON arguments"`.

This tier is the long-term payoff: future driver changes can be tested against the driver directly without faking either provider's SDK.

### Test-driven order during implementation

- Write Tier 2 adapter tests *before* extracting each provider's logic (true TDD).
- Run the existing 28 `test_llm_provider.py` tests after each migration step — never let them stay red across more than one edit.
- Tier 3 driver tests last, after the refactor settles.

## Behavior Preservation Audit

Every behavior we hardened this session must survive the refactor. Each row maps an existing behavior to where it lives after the refactor.

| Behavior | Current location | New location |
|---|---|---|
| Signature-based stuck detection | both loops, duplicated | `run_tool_loop` |
| JSON-parse-error feedback | OpenAI loop only | `_execute_one` (provider-agnostic via adapter) |
| Per-tool wait_for timeout | both loops | `_execute_one` |
| Tool result truncation | both loops | `run_tool_loop` |
| Synthesis nudge text content | `_SYNTHESIS_NUDGE` constant | `driver.py` |
| Synthesis nudge shape | adapter-specific append_tool_results | `AnthropicAdapter.append_tool_results` / `OpenAIAdapter.append_tool_results` |
| Trailing-call gating (`finished_normally`) | both loops | `run_tool_loop` |
| Telemetry log fields | both loops | `run_tool_loop` (one log line) |
| Token usage extraction | both loops | adapter `stream_round` returns `Usage`; driver sums |
| Per-tool latency tracking | both loops | `_execute_one` populates shared `tool_timings` list |

If any row fails to map cleanly during implementation, the refactor stops and we discuss before proceeding.

## Risk & Rollback

**Biggest risk:** behavioral regression in something the tests don't cover.

**Mitigations:**
- Behavior preservation audit table above — each row is an explicit checkpoint.
- Compat shims for `_*_stream_with_tools` keep test files unchanged — if a test fails it's a real regression, not test churn.
- Single commit, single PR — easy to revert.

**Rollback:** `git revert` the unification commit. Pre-refactor code is recovered exactly. No DB migration, no settings changes, no API changes — nothing else needs to roll back.

## Out of Scope

- Adding a new provider (Gemini, local models). Refactor enables this; actually doing it is a separate task.
- Cost-per-response calculation (token × per-model rate). The tokens are now centrally tracked, so adding this later is a one-place edit.
- Streaming the telemetry as an SSE `usage` event to the frontend. Separate task.
- Refactor of `agent/memory.py` or other consumers of `get_llm_response`. The public surface is unchanged; consumers are unaffected.
- Routing memory extraction through a cheaper model. Was on the candidate list but not in this scope.
