"""Shared LLM tool-loop driver and helpers.

Provider-agnostic logic lives here. Provider-specific SDK quirks live in
adapters.py. The public entry points in provider.py orchestrate both.
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

logger = logging.getLogger(__name__)


# --- System prompt and synthesis nudge (moved from provider.py verbatim) ---

SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely.\n\n"
    "When the user asks you to build, create, or generate a UI component, "
    "web page, or interactive application, wrap your code in an artifact tag.\n\n"
    "Always use the project format with a JSON manifest:\n\n"
    '<artifact type="project" title="Project Name" template="react">\n'
    "{\n"
    '  "files": {\n'
    '    "/App.js": "export default function App() { return <h1>Hello</h1>; }"\n'
    "  },\n"
    '  "dependencies": {}\n'
    "}\n"
    "</artifact>\n\n"
    "For multi-file projects:\n\n"
    '<artifact type="project" title="Todo App" template="react">\n'
    "{\n"
    '  "files": {\n'
    '    "/App.js": "import Counter from \'./Counter\';\\nexport default function App() { return <Counter />; }",\n'
    '    "/Counter.js": "export default function Counter() { ... }",\n'
    '    "/styles.css": "body { font-family: sans-serif; }"\n'
    "  },\n"
    '  "dependencies": {\n'
    '    "uuid": "latest"\n'
    "  }\n"
    "}\n"
    "</artifact>\n\n"
    "STRICT rules for artifacts:\n"
    '- Always use type="project" with a JSON manifest.\n'
    '- template: "react" (JS/JSX files, entry /App.js), "react-ts" (TS/TSX files, entry /App.tsx), or "vanilla" (plain HTML/JS, entry /index.html).\n'
    '- If using TypeScript or type annotations, use template="react-ts" with .tsx/.ts files and /App.tsx entry point.\n'
    '- If using plain JavaScript, use template="react" with .js/.jsx files and /App.js entry point.\n'
    "- CSS files use .css extension. Import them as './styles.css' in JS/TSX files.\n"
    "- The files object has file paths as keys (starting with /) and code strings as values.\n"
    "- The dependencies object maps npm package names to version strings. Use {} if none.\n"
    "- Even simple single-component UIs use this format (one file is fine).\n"
    "- Always include the artifact tag when generating UI code.\n"
    "- Emit exactly ONE <artifact> tag per response. Do not include a preliminary version followed by a refined version; pick your best answer and emit it once. Only emit multiple artifact tags if the user explicitly asks for several separate projects.\n"
    "- Keep artifacts concise — prefer inline styles or a single CSS file over many small files.\n"
    "- You can still include explanation text outside the artifact tag.\n"
    '- The JSON must be valid. Escape all special characters in strings properly (newlines as \\n, quotes as \\", backslashes as \\\\).'
    "\n\nEditing an existing artifact (EXTREMELY IMPORTANT):\n"
    '- Whenever the context contains "[Active artifact context —" with an Id, you are almost always modifying that artifact. '
    'You MUST include that exact id on the artifact tag: <artifact id="art-xyz" type="project" title="..." template="...">. '
    "Forgetting the id will create a duplicate artifact and lose the user's project — this is a hard requirement, not a suggestion.\n"
    "- In edit mode, emit ONLY the files you are changing. Unchanged files are preserved automatically — do not repeat them.\n"
    '- To delete a file, add "deleted_files": ["/path/to/file"] in the manifest alongside "files".\n'
    "- Keep the same id, template, and title unless the user explicitly asks to rename.\n"
    "- Edit mode example — renaming a button label in one file of a multi-file project:\n"
    '  <artifact id="art-abc123" type="project" title="Landing Page" template="react">\n'
    "  {\n"
    '    "files": {\n'
    '      "/Hero.tsx": "export default function Hero() { return <button>BUILD faster</button>; }"\n'
    "    }\n"
    "  }\n"
    "  </artifact>\n"
    "- Only omit the id (treat as a brand-new artifact) when the user is asking for something distinct from the current project, not a modification of it.\n"
    "\nFull-stack templates (use ONLY when the user explicitly asks for these frameworks or needs server-side features):\n"
    '- template="nextjs": Next.js App Router. Files: /next.config.js, /app/layout.tsx, /app/page.tsx. Include dependencies like "next", "react", "react-dom".\n'
    '- template="node-server": Express or Fastify API server. Entry file: /server.js or /server.ts. No browser UI needed.\n'
    '- template="vite": Vite-based frontend. Files: /vite.config.ts, /index.html, /src/main.tsx. For projects needing real npm packages that don\'t work in the browser bundler.\n'
    '- PREFER template="react" or "react-ts" for simple components — they load instantly. Only use nextjs/node-server/vite when truly needed.'
)


_SYNTHESIS_NUDGE = (
    "You already have sufficient information from prior tool calls. "
    "Do not call any more tools. Answer the user now using the content "
    "already gathered."
)


# --- Pure helpers (moved from provider.py verbatim) ---


def _tool_call_signature(name: str, arguments) -> str:
    """Stable key for a tool call so identical (name, args) repeats are detectable."""
    if isinstance(arguments, str):
        try:
            arguments = _json.loads(arguments) if arguments else {}
        except _json.JSONDecodeError:
            return f"{name}::{arguments}"
    try:
        canonical = _json.dumps(arguments, sort_keys=True, default=str)
    except (TypeError, ValueError):
        canonical = repr(arguments)
    return f"{name}::{canonical}"


def _truncate_tool_result(text: str, limit: int) -> str:
    """Cap a tool result so a single oversized output can't dominate context."""
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return f"{text[:limit]}\n\n... [truncated, {omitted} chars omitted]"


def _summarize_tool_timings(
    timings: list[tuple[str, float]],
) -> tuple[str, float, float]:
    """Reduce per-tool durations to (slowest_name, slowest_ms, total_ms)."""
    if not timings:
        return "", 0.0, 0.0
    slowest_name, slowest_ms = max(timings, key=lambda t: t[1])
    total_ms = sum(t[1] for t in timings)
    return slowest_name, round(slowest_ms, 2), round(total_ms, 2)


# --- Shared dataclasses ---


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

    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)


@dataclass
class RoundEnd:
    """Sentinel yielded as the final event of stream_round."""

    result: RoundResult


# --- Adapter Protocol ---


class ProviderAdapter(Protocol):
    """Provider-specific surface used by the shared driver.

    Each concrete adapter (AnthropicAdapter, OpenAIAdapter) implements these
    methods structurally — no inheritance required.
    """

    provider_name: str  # "anthropic" | "openai" — used for telemetry tagging

    def build_kwargs(self, messages: list, tools: Optional[list]) -> dict: ...

    def stream_round(self, kwargs: dict) -> AsyncIterator: ...

    def append_assistant_turn(
        self, kwargs: dict, round_result: RoundResult
    ) -> None: ...

    def append_tool_results(
        self,
        kwargs: dict,
        results: list[tuple[str, str]],
        with_synthesis_nudge: bool,
    ) -> None: ...

    def extract_tool_call_args(self, call: ToolCall):  # -> dict | ToolCallParseError
        ...

    def stream_simple(self, kwargs: dict) -> AsyncIterator[str]: ...

    async def respond(self, messages: list) -> str: ...


async def _execute_one(
    adapter: ProviderAdapter,
    call: ToolCall,
    tool_executor,
    on_tool_call,
    timeout_s: int,
    tool_timings: list,
) -> tuple:
    """Parse args, run executor with timeout + per-tool latency timing.

    Returns (tool_call_id, result_text). On JSON parse failure, returns a
    descriptive error result *without* invoking the executor.
    """
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
            result = f"Tool error: '{call.name}' timed out after {timeout_s}s"
        except Exception as e:
            result = f"Tool error: {str(e)}"
    finally:
        tool_timings.append((call.name, (time.perf_counter() - start) * 1000))

    return call.id, str(result) if not isinstance(result, str) else result


async def run_tool_loop(
    adapter: ProviderAdapter,
    messages: list,
    settings,
    tools: list,
    tool_executor,
    on_tool_call,
    max_tool_rounds: int,
    _logger=None,
) -> AsyncIterator[str]:
    """Provider-agnostic tool-calling loop.

    Replaces the duplicated _anthropic_stream_with_tools and
    _openai_stream_with_tools. Owns: stuck detection, parallel tool execution
    with per-tool timeout, result truncation, telemetry, synthesis fallback
    gating, max-rounds enforcement.

    _logger: optional logger override (defaults to module logger). Used by
    provider.py compat shims so telemetry appears under app.llm.provider.
    """
    _log = _logger if _logger is not None else logger
    kwargs = adapter.build_kwargs(messages, tools)
    seen_signatures: set[str] = set()
    finished_normally = False

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

        round_result: Optional[RoundResult] = None
        async for event in adapter.stream_round(kwargs):
            if isinstance(event, str):
                yield event
            elif isinstance(event, RoundEnd):
                round_result = event.result

        if round_result is None:
            # Defensive — adapter should always yield a RoundEnd.
            round_result = RoundResult(tool_calls=[], usage=Usage())

        prompt_tokens += round_result.usage.prompt_tokens
        completion_tokens += round_result.usage.completion_tokens

        if not round_result.tool_calls:
            finished_normally = True
            break

        adapter.append_assistant_turn(kwargs, round_result)

        round_signatures = {
            _tool_call_signature(c.name, c.raw_args) for c in round_result.tool_calls
        }
        stuck = round_num > 0 and round_signatures.issubset(seen_signatures)
        seen_signatures.update(round_signatures)
        if stuck:
            stuck_triggered = True

        tools_called += len(round_result.tool_calls)
        unique_tools_seen.update(c.name for c in round_result.tool_calls)

        tool_results = await asyncio.gather(
            *[
                _execute_one(
                    adapter,
                    c,
                    tool_executor,
                    on_tool_call,
                    settings.tool_call_timeout_s,
                    tool_timings,
                )
                for c in round_result.tool_calls
            ]
        )

        timeout_marker = f"timed out after {settings.tool_call_timeout_s}s"
        timeouts += sum(1 for _, r in tool_results if timeout_marker in r)
        if settings.tool_result_max_chars > 0:
            truncations += sum(
                1 for _, r in tool_results if len(r) > settings.tool_result_max_chars
            )

        truncated = [
            (tid, _truncate_tool_result(r, settings.tool_result_max_chars))
            for tid, r in tool_results
        ]
        adapter.append_tool_results(kwargs, truncated, with_synthesis_nudge=stuck)

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
    _log.info(
        "tool_loop done",
        extra={
            "provider": adapter.provider_name,
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
