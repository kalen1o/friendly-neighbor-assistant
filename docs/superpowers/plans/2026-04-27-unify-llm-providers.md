# Unify LLM Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two near-identical streaming tool-calling loops (`_anthropic_stream_with_tools`, `_openai_stream_with_tools`) and their simpler streaming/response siblings with a single shared `run_tool_loop` driver that delegates provider-specific concerns to a `ProviderAdapter` Protocol. Eliminates the structural drift that caused us to hand-mirror every tool-loop fix this session.

**Architecture:** Three files under `backend/app/llm/`. `provider.py` shrinks to entry-points + post-processing wrappers + dispatch. `driver.py` owns the shared loop, helpers, dataclasses, Protocol. `adapters.py` holds two concrete adapter classes. Public API (`get_llm_response`, `stream_with_tools`, `SYSTEM_PROMPT`) unchanged so all 79 non-provider tests are unaffected and the 28 provider tests keep working via re-exports + 4-line compat shims.

**Tech Stack:** Python 3.12, FastAPI async, `anthropic` SDK, `openai` SDK, pytest with anyio. Tests run inside the `fn-backend` Docker container: `docker exec fn-backend python -m pytest ...`.

**Reference spec:** `docs/superpowers/specs/2026-04-27-unify-llm-providers-via-adapter-design.md`

---

## Pre-flight

Before starting, confirm baseline state. The plan assumes the spec's behavior preservation table — if any of the existing tests is already red, fix that first before refactoring.

- [ ] **Verify clean baseline**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py -q`

Expected output ends with: `87 passed`

If anything other than 87 passed, stop and investigate before continuing.

---

## Task 1: Scaffold `driver.py` with helpers, dataclasses, Protocol

**Goal of this task:** Create the new `driver.py` file containing every shared piece that's currently in `provider.py` plus the new dataclasses and Protocol. `provider.py` re-imports/re-exports everything so existing test imports keep working unchanged. Zero behavior change.

**Files:**
- Create: `backend/app/llm/driver.py`
- Modify: `backend/app/llm/provider.py` (remove definitions of helpers; replace with imports from driver)
- Test: `backend/tests/test_llm_provider.py` (no changes to test code; existing imports must keep working)

- [ ] **Step 1: Create `backend/app/llm/driver.py` with full contents**

Create `backend/app/llm/driver.py` with this complete file:

```python
"""Shared LLM tool-loop driver and helpers.

Provider-agnostic logic lives here. Provider-specific SDK quirks live in
adapters.py. The public entry points in provider.py orchestrate both.
"""

from __future__ import annotations

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

    def build_kwargs(self, messages: list, tools: Optional[list]) -> dict:
        ...

    def stream_round(self, kwargs: dict) -> AsyncIterator:
        ...

    def append_assistant_turn(
        self, kwargs: dict, round_result: RoundResult
    ) -> None:
        ...

    def append_tool_results(
        self,
        kwargs: dict,
        results: list[tuple[str, str]],
        with_synthesis_nudge: bool,
    ) -> None:
        ...

    def extract_tool_call_args(
        self, call: ToolCall
    ):  # -> dict | ToolCallParseError
        ...

    def stream_simple(self, kwargs: dict) -> AsyncIterator[str]:
        ...

    async def respond(self, messages: list) -> str:
        ...
```

- [ ] **Step 2: Modify `backend/app/llm/provider.py` to import the moved symbols from driver.py**

In `backend/app/llm/provider.py`, find the existing definitions of `SYSTEM_PROMPT`, `_SYNTHESIS_NUDGE`, `_tool_call_signature`, `_truncate_tool_result`, `_summarize_tool_timings`. Delete those definitions. Add this import block immediately after the existing imports (right after `from app.llm.model_config import ModelConfig`):

```python
# Re-export shared symbols so existing imports
# (`from app.llm.provider import _tool_call_signature`, etc.) keep working.
from app.llm.driver import (  # noqa: F401
    SYSTEM_PROMPT,
    _SYNTHESIS_NUDGE,
    _summarize_tool_timings,
    _tool_call_signature,
    _truncate_tool_result,
)
```

The `# noqa: F401` suppresses linter warnings about unused imports — these are deliberate re-exports.

Important: provider.py still contains its existing `_anthropic_*`, `_openai_*`, `_convert_*`, `_with_idle_timeout`, `_buffered_stream`, `_filter_tool_leaks`, `stream_with_tools`, `get_llm_response`, etc. functions. **Don't touch those yet** — they still use the helpers via the re-import. They will be removed in later tasks.

- [ ] **Step 3: Verify all 87 existing tests still pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py -q`

Expected: `87 passed`

If anything fails, the most likely cause is a missing re-export in provider.py — check that the `from app.llm.driver import ...` block lists every symbol that test code or other modules import from provider.

- [ ] **Step 4: Commit**

```bash
git add backend/app/llm/driver.py backend/app/llm/provider.py
git commit -m "$(cat <<'EOF'
refactor(llm): scaffold driver.py with shared helpers and Protocol

Moves SYSTEM_PROMPT, _SYNTHESIS_NUDGE, _tool_call_signature,
_truncate_tool_result, _summarize_tool_timings into driver.py verbatim.
Adds ToolCall, ToolCallParseError, Usage, RoundResult, RoundEnd
dataclasses and the ProviderAdapter Protocol. provider.py re-exports
the symbols so test imports keep working unchanged.

No behavior change. All 87 existing tests pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build `AnthropicAdapter` with TDD

**Goal of this task:** Implement the Anthropic adapter as a class satisfying `ProviderAdapter`. Move the existing Anthropic-specific helpers (`_get_anthropic_client`, `_convert_to_anthropic_format`, `_convert_tools_to_anthropic`, the client cache `_anthropic_clients`, `ANTHROPIC_MODEL` default) from `provider.py` into `adapters.py`. Tests are written first against the unit-testable methods.

**Files:**
- Create: `backend/app/llm/adapters.py`
- Create: `backend/tests/test_adapters.py`
- Modify: `backend/app/llm/provider.py` (delete moved-out helpers — but only after the new ones are in place; provider.py still works because nothing else imports those helpers)

- [ ] **Step 1: Create `backend/tests/test_adapters.py` with the AnthropicAdapter unit tests (failing — module doesn't exist yet)**

Create `backend/tests/test_adapters.py`:

```python
"""Tests for ProviderAdapter implementations.

Covers the unit-testable methods on each adapter (build_kwargs,
append_tool_results, extract_tool_call_args). The streaming and one-shot
methods (stream_round, stream_simple, respond) are exercised end-to-end via
the existing test_llm_provider.py tests using SDK-level mocks.
"""

from app.config import Settings
from app.llm.adapters import AnthropicAdapter
from app.llm.driver import _SYNTHESIS_NUDGE, ToolCall, ToolCallParseError


def _settings() -> Settings:
    return Settings(
        ai_provider="anthropic",
        anthropic_api_key="sk-ant-test",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


# --- AnthropicAdapter ---


def test_anthropic_adapter_build_kwargs_converts_image_blocks_and_tools():
    adapter = AnthropicAdapter(_settings(), model_config=None)
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,iVBORw0KGgoAAAA="
                    },
                },
                {"type": "text", "text": "describe this"},
            ],
        }
    ]
    tools = [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                },
            },
        }
    ]

    kwargs = adapter.build_kwargs(messages, tools)

    assert kwargs["model"]
    assert kwargs["max_tokens"] > 0
    assert kwargs["system"]  # SYSTEM_PROMPT injected
    assert kwargs["tools"] == [
        {
            "name": "web_search",
            "description": "Search the web",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
            },
        }
    ]
    # Image data:url converted to Anthropic image block format.
    user_blocks = kwargs["messages"][0]["content"]
    assert any(b.get("type") == "image" for b in user_blocks)
    img = next(b for b in user_blocks if b.get("type") == "image")
    assert img["source"]["type"] == "base64"
    assert img["source"]["media_type"] == "image/png"


def test_anthropic_adapter_build_kwargs_omits_tools_key_when_none():
    adapter = AnthropicAdapter(_settings(), model_config=None)
    kwargs = adapter.build_kwargs(
        [{"role": "user", "content": "hi"}], tools=None
    )
    assert "tools" not in kwargs


def test_anthropic_adapter_append_tool_results_with_nudge_appends_text_block():
    adapter = AnthropicAdapter(_settings(), model_config=None)
    kwargs = {
        "model": "claude-sonnet-4-20250514",
        "messages": [],
        "tools": [{"name": "web_search"}],
    }
    results = [("tu_abc", "found 3 articles"), ("tu_def", "stock price: $42")]

    adapter.append_tool_results(kwargs, results, with_synthesis_nudge=True)

    # tools key was popped because of the nudge.
    assert "tools" not in kwargs
    # One user message appended with mixed tool_result + text blocks.
    assert len(kwargs["messages"]) == 1
    msg = kwargs["messages"][0]
    assert msg["role"] == "user"
    blocks = msg["content"]
    tool_results = [b for b in blocks if b["type"] == "tool_result"]
    text_blocks = [b for b in blocks if b["type"] == "text"]
    assert len(tool_results) == 2
    assert tool_results[0]["tool_use_id"] == "tu_abc"
    assert tool_results[0]["content"] == "found 3 articles"
    assert len(text_blocks) == 1
    assert text_blocks[0]["text"] == _SYNTHESIS_NUDGE


def test_anthropic_adapter_append_tool_results_without_nudge_keeps_tools():
    adapter = AnthropicAdapter(_settings(), model_config=None)
    kwargs = {
        "model": "claude-sonnet-4-20250514",
        "messages": [],
        "tools": [{"name": "web_search"}],
    }
    adapter.append_tool_results(
        kwargs, [("tu_x", "result")], with_synthesis_nudge=False
    )
    # tools preserved.
    assert kwargs["tools"] == [{"name": "web_search"}]
    blocks = kwargs["messages"][0]["content"]
    assert all(b["type"] == "tool_result" for b in blocks)


def test_anthropic_adapter_extract_tool_call_args_returns_dict_unchanged():
    adapter = AnthropicAdapter(_settings(), model_config=None)
    call = ToolCall(id="tu_1", name="web_search", raw_args={"query": "hi"})
    parsed = adapter.extract_tool_call_args(call)
    assert parsed == {"query": "hi"}
    assert not isinstance(parsed, ToolCallParseError)
```

- [ ] **Step 2: Run the new test file, verify it fails because `app.llm.adapters` doesn't exist**

Run: `docker exec fn-backend python -m pytest backend/tests/test_adapters.py -q`

Expected: `ImportError: cannot import name 'AnthropicAdapter' from 'app.llm.adapters'` (or `ModuleNotFoundError: No module named 'app.llm.adapters'`)

This is the failing-first step of TDD. Do not skip it — confirm the failure before writing code.

- [ ] **Step 3: Create `backend/app/llm/adapters.py` with `AnthropicAdapter`**

Create `backend/app/llm/adapters.py`:

```python
"""Provider adapters implementing the ProviderAdapter Protocol."""

from __future__ import annotations

import json as _json
from collections.abc import AsyncIterator
from typing import Optional

import anthropic

from app.config import Settings
from app.llm.driver import (
    SYSTEM_PROMPT,
    _SYNTHESIS_NUDGE,
    RoundEnd,
    RoundResult,
    ToolCall,
    ToolCallParseError,
    Usage,
)
from app.llm.model_config import ModelConfig

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"

# Module-level client caches (moved verbatim from provider.py — same identity).
_anthropic_clients: dict[str, anthropic.AsyncAnthropic] = {}


def _get_anthropic_client(api_key: str) -> anthropic.AsyncAnthropic:
    if api_key not in _anthropic_clients:
        _anthropic_clients[api_key] = anthropic.AsyncAnthropic(api_key=api_key)
    return _anthropic_clients[api_key]


def _convert_to_anthropic_format(messages: list) -> list:
    """Convert OpenAI-style image_url content blocks to Anthropic format."""
    converted = []
    for msg in messages:
        if isinstance(msg.get("content"), list):
            new_content = []
            for block in msg["content"]:
                if block.get("type") == "image_url":
                    url = block["image_url"]["url"]
                    if url.startswith("data:"):
                        parts = url.split(";base64,", 1)
                        media_type = parts[0].replace("data:", "")
                        data = parts[1]
                        new_content.append(
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": data,
                                },
                            }
                        )
                    else:
                        new_content.append(block)
                else:
                    new_content.append(block)
            converted.append({**msg, "content": new_content})
        else:
            converted.append(msg)
    return converted


def _convert_tools_to_anthropic(tools: list) -> list:
    """Convert OpenAI function-calling tool defs to Anthropic format."""
    out = []
    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool["function"]
        out.append(
            {
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
        )
    return out


class AnthropicAdapter:
    """ProviderAdapter for the Anthropic SDK."""

    provider_name = "anthropic"

    def __init__(
        self, settings: Settings, model_config: Optional[ModelConfig] = None
    ):
        self._settings = settings
        api_key = (
            model_config.api_key if model_config else settings.anthropic_api_key
        )
        self._client = _get_anthropic_client(api_key)
        self._model = (
            model_config.model_id if model_config else ANTHROPIC_MODEL
        )

    def build_kwargs(self, messages: list, tools: Optional[list]) -> dict:
        converted_messages = _convert_to_anthropic_format(messages)
        kwargs: dict = {
            "model": self._model,
            "max_tokens": self._settings.max_output_tokens,
            "system": SYSTEM_PROMPT,
            "messages": converted_messages,
        }
        if tools:
            kwargs["tools"] = _convert_tools_to_anthropic(tools)
        return kwargs

    async def stream_round(
        self, kwargs: dict
    ) -> AsyncIterator:  # yields str | RoundEnd
        async with self._client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
            response = await stream.get_final_message()

        tool_calls: list[ToolCall] = []
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                tool_calls.append(
                    ToolCall(id=block.id, name=block.name, raw_args=block.input)
                )

        usage_obj = getattr(response, "usage", None)
        usage = Usage(
            prompt_tokens=getattr(usage_obj, "input_tokens", 0) or 0,
            completion_tokens=getattr(usage_obj, "output_tokens", 0) or 0,
        )

        # Stash the raw assistant content so append_assistant_turn can use it
        # without re-parsing. Set on kwargs so the driver doesn't need to know.
        kwargs["_last_assistant_content"] = response.content

        yield RoundEnd(result=RoundResult(tool_calls=tool_calls, usage=usage))

    def append_assistant_turn(
        self, kwargs: dict, round_result: RoundResult
    ) -> None:
        # Anthropic requires the assistant turn to carry the original block
        # list (text + tool_use blocks). stream_round stashed it on kwargs.
        content = kwargs.pop("_last_assistant_content", [])
        kwargs["messages"].append({"role": "assistant", "content": content})

    def append_tool_results(
        self,
        kwargs: dict,
        results: list[tuple[str, str]],
        with_synthesis_nudge: bool,
    ) -> None:
        content: list = [
            {"type": "tool_result", "tool_use_id": tid, "content": text}
            for tid, text in results
        ]
        if with_synthesis_nudge:
            # Anthropic requires alternating user/assistant; nudge text rides
            # along inside the same user message as the tool_result blocks.
            content.append({"type": "text", "text": _SYNTHESIS_NUDGE})
            kwargs.pop("tools", None)
        kwargs["messages"].append({"role": "user", "content": content})

    def extract_tool_call_args(self, call: ToolCall):
        # Anthropic SDK delivers parsed dicts; nothing to do.
        if isinstance(call.raw_args, dict):
            return call.raw_args
        # Defensive: if for some reason raw_args is a string, try to parse.
        try:
            parsed = _json.loads(call.raw_args) if call.raw_args else {}
            return parsed if isinstance(parsed, dict) else {}
        except _json.JSONDecodeError as e:
            return ToolCallParseError(
                raw_args=str(call.raw_args), reason=e.msg
            )

    async def stream_simple(self, kwargs: dict) -> AsyncIterator[str]:
        async with self._client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    async def respond(self, messages: list) -> str:
        kwargs = self.build_kwargs(messages, tools=None)
        response = await self._client.messages.create(**kwargs)
        return response.content[0].text
```

- [ ] **Step 4: Run the AnthropicAdapter tests, verify they pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_adapters.py -v`

Expected: 5 tests pass.

If `test_anthropic_adapter_build_kwargs_converts_image_blocks_and_tools` fails on the model assertion, double-check that `ANTHROPIC_MODEL` constant is defined in `adapters.py` (it should be; it was moved from `provider.py`).

- [ ] **Step 5: Verify the existing 87 tests still pass**

The existing provider.py code still defines its own `_get_anthropic_client`, `_convert_to_anthropic_format`, `_convert_tools_to_anthropic`, `_anthropic_clients`, and `ANTHROPIC_MODEL` — they're not deleted yet. So provider.py and adapters.py have temporarily-duplicate definitions. That's fine: they're independent module-level names; nobody re-imports them between the modules.

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py -q`

Expected: `87 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/adapters.py backend/tests/test_adapters.py
git commit -m "$(cat <<'EOF'
refactor(llm): add AnthropicAdapter implementing ProviderAdapter

Implements all seven Protocol methods. Reuses _convert_to_anthropic_format
and _convert_tools_to_anthropic logic (now defined in adapters.py;
provider.py still has its own copies — those will be deleted in a
later task). Adds 5 unit tests covering build_kwargs (with image and
tool conversion), append_tool_results (with and without nudge), and
extract_tool_call_args.

87 existing tests still pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `OpenAIAdapter` with TDD

**Goal of this task:** Implement the OpenAI adapter as a class satisfying `ProviderAdapter`. Add the existing OpenAI-specific helpers (`_get_openai_client`, `_build_openai_client`, `_build_vision_client`, `_openai_clients`, `_llm_retry`, retryable error tuples) into `adapters.py`. The implementation is the OpenAI streaming logic from `provider.py` reorganized into adapter methods.

**Files:**
- Modify: `backend/app/llm/adapters.py`
- Modify: `backend/tests/test_adapters.py`

- [ ] **Step 1: Add OpenAIAdapter unit tests to `backend/tests/test_adapters.py`**

Append to `backend/tests/test_adapters.py`:

```python
# --- OpenAIAdapter ---


from app.llm.adapters import OpenAIAdapter  # noqa: E402


def _openai_settings() -> Settings:
    return Settings(
        ai_provider="openai",
        openai_api_key="sk-test",
        openai_model="gpt-4o-mini",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


def test_openai_adapter_build_kwargs_streams_with_usage_and_tools():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    tools = [
        {"type": "function", "function": {"name": "web_search", "parameters": {}}}
    ]
    kwargs = adapter.build_kwargs(
        [{"role": "user", "content": "hi"}], tools=tools
    )
    assert kwargs["stream"] is True
    assert kwargs["stream_options"] == {"include_usage": True}
    assert kwargs["tools"] == tools
    # System message prepended.
    assert kwargs["messages"][0]["role"] == "system"
    assert kwargs["messages"][1]["role"] == "user"


def test_openai_adapter_build_kwargs_omits_tools_in_vision_mode():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=True)
    tools = [
        {"type": "function", "function": {"name": "web_search", "parameters": {}}}
    ]
    kwargs = adapter.build_kwargs(
        [{"role": "user", "content": "hi"}], tools=tools
    )
    assert "tools" not in kwargs


def test_openai_adapter_append_tool_results_with_nudge_appends_user_message():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    kwargs = {
        "model": "gpt-4o",
        "messages": [],
        "tools": [
            {
                "type": "function",
                "function": {"name": "web_search", "parameters": {}},
            }
        ],
    }
    results = [("call_a", "result A"), ("call_b", "result B")]

    adapter.append_tool_results(kwargs, results, with_synthesis_nudge=True)

    assert "tools" not in kwargs
    # One tool message per result + one user message for the nudge.
    msgs = kwargs["messages"]
    tool_msgs = [m for m in msgs if m.get("role") == "tool"]
    user_msgs = [m for m in msgs if m.get("role") == "user"]
    assert len(tool_msgs) == 2
    assert tool_msgs[0]["tool_call_id"] == "call_a"
    assert tool_msgs[0]["content"] == "result A"
    assert len(user_msgs) == 1
    assert user_msgs[0]["content"] == _SYNTHESIS_NUDGE


def test_openai_adapter_append_tool_results_without_nudge_keeps_tools():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    kwargs = {
        "model": "gpt-4o",
        "messages": [],
        "tools": [
            {
                "type": "function",
                "function": {"name": "web_search", "parameters": {}},
            }
        ],
    }
    adapter.append_tool_results(
        kwargs, [("call_x", "ok")], with_synthesis_nudge=False
    )
    assert kwargs["tools"]
    msgs = kwargs["messages"]
    assert all(m["role"] == "tool" for m in msgs)


def test_openai_adapter_extract_tool_call_args_handles_invalid_json():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    call = ToolCall(id="call_x", name="web_search", raw_args="{not valid json")
    parsed = adapter.extract_tool_call_args(call)
    assert isinstance(parsed, ToolCallParseError)
    assert parsed.raw_args == "{not valid json"
    assert parsed.reason  # non-empty


def test_openai_adapter_extract_tool_call_args_parses_valid_json():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    call = ToolCall(id="call_x", name="web_search", raw_args='{"query":"hi"}')
    parsed = adapter.extract_tool_call_args(call)
    assert parsed == {"query": "hi"}


def test_openai_adapter_extract_tool_call_args_empty_string_returns_empty_dict():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=False)
    call = ToolCall(id="call_x", name="datetime_info", raw_args="")
    parsed = adapter.extract_tool_call_args(call)
    assert parsed == {}
```

- [ ] **Step 2: Run the new tests, confirm they fail because OpenAIAdapter doesn't exist yet**

Run: `docker exec fn-backend python -m pytest backend/tests/test_adapters.py -q`

Expected: `ImportError: cannot import name 'OpenAIAdapter' from 'app.llm.adapters'`

- [ ] **Step 3: Append OpenAIAdapter and supporting helpers to `backend/app/llm/adapters.py`**

Append to `backend/app/llm/adapters.py` (after the AnthropicAdapter class):

```python
import openai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
import logging

logger = logging.getLogger(__name__)

# OpenAI client cache + retry decorator (moved verbatim from provider.py).
_openai_clients: dict[str, openai.AsyncOpenAI] = {}

_RETRYABLE_OPENAI = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.InternalServerError,
    openai.APIConnectionError,
)
_RETRYABLE_ANTHROPIC = (
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
)

_llm_retry = retry(
    retry=retry_if_exception_type(_RETRYABLE_OPENAI + _RETRYABLE_ANTHROPIC),
    wait=wait_exponential(multiplier=1, min=1, max=15),
    stop=stop_after_attempt(3),
    before_sleep=lambda rs: logger.warning(
        "LLM call failed (%s), retrying in %.1fs...",
        rs.outcome.exception().__class__.__name__,
        rs.next_action.sleep,
    ),
    reraise=True,
)


def _get_openai_client(api_key: str, base_url: Optional[str] = None) -> openai.AsyncOpenAI:
    cache_key = f"{api_key}:{base_url or ''}"
    if cache_key not in _openai_clients:
        kwargs: dict = {"api_key": api_key, "timeout": 300.0}
        if base_url:
            kwargs["base_url"] = base_url
        _openai_clients[cache_key] = openai.AsyncOpenAI(**kwargs)
    return _openai_clients[cache_key]


def _build_openai_client(
    settings: Settings, model_config: Optional[ModelConfig] = None
) -> openai.AsyncOpenAI:
    if model_config:
        return _get_openai_client(model_config.api_key, model_config.base_url)
    return _get_openai_client(
        settings.openai_api_key, settings.openai_base_url or None
    )


def _build_vision_client(settings: Settings) -> openai.AsyncOpenAI:
    api_key = settings.vision_api_key or settings.openai_api_key
    base_url = settings.vision_base_url or settings.openai_base_url or None
    return _get_openai_client(api_key, base_url)


class OpenAIAdapter:
    """ProviderAdapter for OpenAI / OpenAI-compatible endpoints."""

    provider_name = "openai"

    def __init__(
        self,
        settings: Settings,
        model_config: Optional[ModelConfig] = None,
        vision: bool = False,
    ):
        self._settings = settings
        self._vision = vision
        if model_config:
            self._client = _build_openai_client(settings, model_config)
            self._model = model_config.model_id
        elif vision:
            self._client = _build_vision_client(settings)
            self._model = settings.vision_model or settings.openai_model
        else:
            self._client = _build_openai_client(settings)
            self._model = settings.openai_model

    def build_kwargs(self, messages: list, tools: Optional[list]) -> dict:
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
        kwargs: dict = {
            "model": self._model,
            "messages": full_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools and not self._vision:
            kwargs["tools"] = tools
        return kwargs

    async def stream_round(
        self, kwargs: dict
    ) -> AsyncIterator:  # yields str | RoundEnd
        @_llm_retry
        async def _create_stream(**kw):
            return await self._client.chat.completions.create(**kw)

        stream = await _create_stream(**kwargs)

        collected_text = ""
        tool_calls_in_progress: dict = {}
        prompt_tokens = 0
        completion_tokens = 0

        async for chunk in stream:
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                prompt_tokens += getattr(chunk_usage, "prompt_tokens", 0) or 0
                completion_tokens += (
                    getattr(chunk_usage, "completion_tokens", 0) or 0
                )
            if not chunk.choices:
                continue

            delta = chunk.choices[0].delta

            if delta.content:
                collected_text += delta.content
                yield delta.content

            if delta.tool_calls:
                for tc in delta.tool_calls:
                    tc_id = tc.index
                    if tc_id not in tool_calls_in_progress:
                        tool_calls_in_progress[tc_id] = {
                            "id": tc.id or f"call_{tc_id}",
                            "name": "",
                            "arguments": "",
                        }
                    if tc.function:
                        if tc.function.name:
                            tool_calls_in_progress[tc_id]["name"] = (
                                tc.function.name
                            )
                            tool_calls_in_progress[tc_id]["id"] = (
                                tc.id or tool_calls_in_progress[tc_id]["id"]
                            )
                        if tc.function.arguments:
                            tool_calls_in_progress[tc_id]["arguments"] += (
                                tc.function.arguments
                            )

        # Stash the assistant turn pieces so append_assistant_turn can rebuild
        # the `assistant` message without re-parsing.
        kwargs["_last_assistant_text"] = collected_text
        kwargs["_last_tool_calls_struct"] = list(tool_calls_in_progress.values())

        tool_calls = [
            ToolCall(id=tc["id"], name=tc["name"], raw_args=tc["arguments"])
            for tc in tool_calls_in_progress.values()
        ]
        usage = Usage(
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )
        yield RoundEnd(result=RoundResult(tool_calls=tool_calls, usage=usage))

    def append_assistant_turn(
        self, kwargs: dict, round_result: RoundResult
    ) -> None:
        text = kwargs.pop("_last_assistant_text", "")
        tc_struct = kwargs.pop("_last_tool_calls_struct", [])
        assistant_tool_calls = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["name"], "arguments": tc["arguments"]},
            }
            for tc in tc_struct
        ]
        kwargs["messages"].append(
            {
                "role": "assistant",
                "content": text or None,
                "tool_calls": assistant_tool_calls,
            }
        )

    def append_tool_results(
        self,
        kwargs: dict,
        results: list[tuple[str, str]],
        with_synthesis_nudge: bool,
    ) -> None:
        for tid, text in results:
            kwargs["messages"].append(
                {"role": "tool", "tool_call_id": tid, "content": text}
            )
        if with_synthesis_nudge:
            kwargs["messages"].append(
                {"role": "user", "content": _SYNTHESIS_NUDGE}
            )
            kwargs.pop("tools", None)

    def extract_tool_call_args(self, call: ToolCall):
        raw = call.raw_args
        if isinstance(raw, dict):
            return raw
        if not raw:
            return {}
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError as e:
            return ToolCallParseError(raw_args=raw, reason=e.msg)

    async def stream_simple(self, kwargs: dict) -> AsyncIterator[str]:
        # Simple streaming: no tools, no usage chunk handling needed.
        # Strip stream_options if the caller doesn't want usage chunks.
        kwargs = {k: v for k, v in kwargs.items() if k != "tools"}

        @_llm_retry
        async def _create_stream(**kw):
            return await self._client.chat.completions.create(**kw)

        stream = await _create_stream(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    async def respond(self, messages: list) -> str:
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
        response = await self._client.chat.completions.create(
            model=self._model, messages=full_messages
        )
        return response.choices[0].message.content
```

- [ ] **Step 4: Run all adapter tests, verify pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_adapters.py -v`

Expected: 12 tests pass (5 from Anthropic + 7 from OpenAI).

- [ ] **Step 5: Verify the existing 87 tests still pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py -q`

Expected: `87 passed`. (Existing code in provider.py still works because its own helpers are untouched.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/adapters.py backend/tests/test_adapters.py
git commit -m "$(cat <<'EOF'
refactor(llm): add OpenAIAdapter implementing ProviderAdapter

Adds OpenAIAdapter with all seven Protocol methods, plus the OpenAI
client cache, _llm_retry decorator, and _build_openai_client helpers
moved from provider.py (provider.py still has its own copies which will
be deleted later). 7 new unit tests cover build_kwargs in vision and
non-vision modes, append_tool_results with and without synthesis nudge,
and extract_tool_call_args for valid JSON, invalid JSON, and empty.

87 existing tests still pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `run_tool_loop` and `_execute_one` to `driver.py` with TDD

**Goal of this task:** Implement the unified driver function and its private helper. Write driver tests first using a `_FakeAdapter` that satisfies the Protocol but bypasses any SDK. End: 3 new driver tests pass; existing tests still pass.

**Files:**
- Modify: `backend/app/llm/driver.py`
- Create: `backend/tests/test_driver.py`

- [ ] **Step 1: Create `backend/tests/test_driver.py` with the FakeAdapter and 3 tests (failing — driver functions don't exist)**

Create `backend/tests/test_driver.py`:

```python
"""Driver-level tests using a fake adapter that satisfies the Protocol.

Bypasses any SDK so we can exercise the driver's logic — stuck detection,
JSON-error handling, max-rounds behavior, telemetry — without provider
mocks.
"""

import logging
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.llm.driver import (
    RoundEnd,
    RoundResult,
    ToolCall,
    ToolCallParseError,
    Usage,
    run_tool_loop,
)


def _settings() -> Settings:
    return Settings(
        ai_provider="openai",
        openai_api_key="sk-test",
        openai_model="gpt-4o-mini",
        database_url="postgresql+asyncpg://x:x@localhost/x",
        max_tool_rounds=5,
        tool_call_timeout_s=60,
        tool_result_max_chars=12000,
    )


class _FakeAdapter:
    """Minimal ProviderAdapter implementation for driver-level tests.

    Scripts a sequence of (text_chunks, tool_calls) per round. extract_args
    behavior is configurable per call.
    """

    provider_name = "fake"

    def __init__(
        self,
        rounds: list[tuple[list[str], list[ToolCall]]],
        extract_args=None,
    ):
        self._rounds = list(rounds)
        self._extract_args = extract_args
        self.append_tool_results_calls: list[tuple] = []  # captured for asserts

    def build_kwargs(self, messages, tools):
        return {"messages": list(messages), "tools": tools}

    async def stream_round(self, kwargs):
        if self._rounds:
            text_chunks, tool_calls = self._rounds.pop(0)
        else:
            text_chunks, tool_calls = [], []
        for t in text_chunks:
            yield t
        yield RoundEnd(
            result=RoundResult(tool_calls=tool_calls, usage=Usage(1, 1))
        )

    def append_assistant_turn(self, kwargs, round_result):
        kwargs["messages"].append({"role": "assistant", "content": "..."})

    def append_tool_results(self, kwargs, results, with_synthesis_nudge):
        self.append_tool_results_calls.append(
            (list(results), with_synthesis_nudge)
        )
        for tid, text in results:
            kwargs["messages"].append(
                {"role": "tool", "tool_call_id": tid, "content": text}
            )
        if with_synthesis_nudge:
            kwargs.pop("tools", None)

    def extract_tool_call_args(self, call: ToolCall):
        if self._extract_args is not None:
            return self._extract_args(call)
        return call.raw_args if isinstance(call.raw_args, dict) else {}


@pytest.mark.anyio
async def test_driver_runs_until_no_tool_calls_then_emits_telemetry(caplog):
    """Round 1 returns one tool call, round 2 returns none → loop exits cleanly."""
    adapter = _FakeAdapter(
        rounds=[
            ([], [ToolCall(id="t1", name="search", raw_args={"q": "x"})]),
            (["done"], []),
        ]
    )

    async def fake_executor(name, args):
        return "result"

    caplog.set_level(logging.INFO, logger="app.llm.driver")

    chunks = []
    async for chunk in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=fake_executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        chunks.append(chunk)

    assert "done" in "".join(chunks)

    records = [r for r in caplog.records if r.message == "tool_loop done"]
    assert len(records) == 1
    record = records[0]
    assert record.provider == "fake"
    assert record.rounds_used == 2
    assert record.tools_called == 1
    assert record.unique_tools == 1
    assert record.finished_normally is True
    assert record.stuck_triggered is False
    assert record.synthesis_fallback is False


@pytest.mark.anyio
async def test_driver_detects_stuck_and_strips_tools():
    """Same (tool, args) in rounds 0 and 1 → append_tool_results called with
    with_synthesis_nudge=True on the second tool round."""
    same_call = lambda i: ToolCall(id=f"t{i}", name="search", raw_args={"q": "x"})
    adapter = _FakeAdapter(
        rounds=[
            ([], [same_call(1)]),
            ([], [same_call(2)]),
            (["answer"], []),
        ]
    )

    async def fake_executor(name, args):
        return "result"

    chunks = []
    async for chunk in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=fake_executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        chunks.append(chunk)

    # Two append_tool_results calls happened (one per tool round).
    assert len(adapter.append_tool_results_calls) == 2
    # Round 0 was not stuck (first time we see this signature).
    assert adapter.append_tool_results_calls[0][1] is False
    # Round 1 was stuck (signature already seen).
    assert adapter.append_tool_results_calls[1][1] is True
    assert "answer" in "".join(chunks)


@pytest.mark.anyio
async def test_driver_skips_tool_executor_on_invalid_args():
    """When extract_tool_call_args returns ToolCallParseError, the tool is
    NOT executed and the result string describes the parse failure."""
    bad_call = ToolCall(id="t1", name="search", raw_args="{not valid json")
    adapter = _FakeAdapter(
        rounds=[
            ([], [bad_call]),
            (["recovered"], []),
        ],
        extract_args=lambda c: ToolCallParseError(
            raw_args="{not valid json", reason="Expecting property name"
        ),
    )

    executor = AsyncMock()

    async for _ in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        pass

    executor.assert_not_called()
    # The tool result fed back into messages should describe the error.
    results_call = adapter.append_tool_results_calls[0]
    results, _stuck = results_call
    assert len(results) == 1
    tid, content = results[0]
    assert tid == "t1"
    assert "invalid JSON arguments" in content
```

- [ ] **Step 2: Run the new tests, confirm they fail**

Run: `docker exec fn-backend python -m pytest backend/tests/test_driver.py -q`

Expected: `ImportError: cannot import name 'run_tool_loop' from 'app.llm.driver'`

- [ ] **Step 3: Append `run_tool_loop` and `_execute_one` to `backend/app/llm/driver.py`**

Add to the **end** of `backend/app/llm/driver.py`:

```python
import asyncio


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


async def run_tool_loop(
    adapter: ProviderAdapter,
    messages: list,
    settings,
    tools: list,
    tool_executor,
    on_tool_call,
    max_tool_rounds: int,
) -> AsyncIterator[str]:
    """Provider-agnostic tool-calling loop.

    Replaces the duplicated _anthropic_stream_with_tools and
    _openai_stream_with_tools. Owns: stuck detection, parallel tool execution
    with per-tool timeout, result truncation, telemetry, synthesis fallback
    gating, max-rounds enforcement.
    """
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
            _tool_call_signature(c.name, c.raw_args)
            for c in round_result.tool_calls
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
                1
                for _, r in tool_results
                if len(r) > settings.tool_result_max_chars
            )

        truncated = [
            (tid, _truncate_tool_result(r, settings.tool_result_max_chars))
            for tid, r in tool_results
        ]
        adapter.append_tool_results(
            kwargs, truncated, with_synthesis_nudge=stuck
        )

    if not finished_normally:
        synthesis_fallback_used = True
        kwargs.pop("tools", None)
        async for event in adapter.stream_round(kwargs):
            if isinstance(event, str):
                yield event
            elif isinstance(event, RoundEnd):
                prompt_tokens += event.result.usage.prompt_tokens
                completion_tokens += event.result.usage.completion_tokens

    slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(
        tool_timings
    )
    logger.info(
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
```

- [ ] **Step 4: Run driver tests, verify pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_driver.py -v`

Expected: 3 tests pass.

- [ ] **Step 5: Verify all 87 + 12 + 3 = 102 tests pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py backend/tests/test_adapters.py backend/tests/test_driver.py -q`

Expected: `102 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/driver.py backend/tests/test_driver.py
git commit -m "$(cat <<'EOF'
refactor(llm): add run_tool_loop and _execute_one to driver

Implements the provider-agnostic tool-calling loop. Owns: stuck
detection, parallel tool execution with timeout, result truncation,
telemetry log, synthesis fallback gating, max-rounds enforcement.
_execute_one handles per-call lifecycle (arg parse, on_tool_call,
wait_for + timeout, latency timing). 3 new driver tests via FakeAdapter
verify the no-tools exit path, stuck detection, and JSON-error path
without any SDK mocks.

102 tests passing (87 existing + 12 adapter + 3 driver).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Switch `provider.py` entry points to use the driver + adapters

**Goal of this task:** Rewrite `stream_with_tools` and `get_llm_response` to dispatch through `_get_adapter` + `run_tool_loop` / `adapter.respond`. Add 4-line compat shims for `_anthropic_stream_with_tools` and `_openai_stream_with_tools` so the existing `test_llm_provider.py` tests that import them continue to work without any test-file changes.

**Files:**
- Modify: `backend/app/llm/provider.py`

- [ ] **Step 1: Rewrite `provider.py` entry points**

Replace the existing `get_llm_response` and `stream_with_tools` functions in `backend/app/llm/provider.py` with these versions. **Do not delete the old `_anthropic_*`, `_openai_*`, `_convert_*`, `_get_*_client` helpers yet** — they'll be removed in Task 6 once tests are confirmed green.

Find the existing `async def get_llm_response(...)`. Replace its body with:

```python
async def get_llm_response(
    messages: list[dict],
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
) -> str:
    adapter = _get_adapter(settings, model_config)
    return await adapter.respond(messages)
```

Find the existing `async def stream_with_tools(...)`. Replace its body with:

```python
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
    """Stream LLM response with native tool calling support."""
    adapter = _get_adapter(settings, model_config, vision=vision)
    rounds = max_tool_rounds or settings.max_tool_rounds

    if tools and not vision:
        raw = run_tool_loop(
            adapter,
            messages,
            settings,
            tools,
            tool_executor,
            on_tool_call,
            rounds,
        )
    else:
        kwargs = adapter.build_kwargs(messages, tools=None)
        raw = adapter.stream_simple(kwargs)

    async for chunk in _filter_tool_leaks(
        _buffered_stream(_with_idle_timeout(raw, settings.llm_stream_idle_timeout))
    ):
        yield chunk
```

Add `_get_adapter` near the top of the file (after the imports):

```python
def _get_adapter(
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
    vision: bool = False,
):
    """Provider dispatch. The only place provider strings are matched."""
    provider = (
        model_config.provider if model_config else settings.ai_provider
    )
    if provider == "anthropic":
        return AnthropicAdapter(settings, model_config)
    if provider in ("openai", "openai_compatible"):
        return OpenAIAdapter(settings, model_config, vision=vision)
    raise ValueError(f"Unsupported AI provider: {provider}")
```

Add the necessary imports at the top of provider.py (alongside the existing `from app.llm.driver import ...` block):

```python
from app.llm.adapters import AnthropicAdapter, OpenAIAdapter
from app.llm.driver import run_tool_loop
```

- [ ] **Step 2: Replace the old `_anthropic_stream_with_tools` and `_openai_stream_with_tools` with compat shims**

In `backend/app/llm/provider.py`, find the existing `async def _anthropic_stream_with_tools(...)` definition (around line 320). Delete the entire function body and replace with this compat shim (preserves the same signature for any test that imports it):

```python
async def _anthropic_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    model_config: Optional[ModelConfig] = None,
) -> AsyncIterator[str]:
    """Compat shim — tests import this name. Dispatches to run_tool_loop."""
    adapter = AnthropicAdapter(settings, model_config)
    async for chunk in run_tool_loop(
        adapter,
        messages,
        settings,
        tools,
        tool_executor,
        on_tool_call,
        max_tool_rounds,
    ):
        yield chunk
```

Find the existing `async def _openai_stream_with_tools(...)` definition. Delete the entire function body and replace with:

```python
async def _openai_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    vision: bool = False,
    model_config: Optional[ModelConfig] = None,
) -> AsyncIterator[str]:
    """Compat shim — tests import this name. Dispatches to run_tool_loop."""
    adapter = OpenAIAdapter(settings, model_config, vision=vision)
    async for chunk in run_tool_loop(
        adapter,
        messages,
        settings,
        tools,
        tool_executor,
        on_tool_call,
        max_tool_rounds,
    ):
        yield chunk
```

- [ ] **Step 3: Run the 28 `test_llm_provider.py` tests — they must all still pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py -v`

Expected: 28 tests pass.

This is the most important checkpoint of the refactor: every behavior we hardened this session — JSON-error feedback, per-tool timeout, signature-based stuck detection, telemetry fields, token usage, per-tool latency, trailing-call gating — is now flowing through the new code path via the compat shims, and the tests verify it.

**If any test fails:**
- Re-check that the compat shim signatures exactly match the old function signatures.
- Re-check that `_get_adapter` returns the right adapter for the test's `ai_provider` setting.
- Compare the failing assertion against the corresponding row in the spec's "Behavior Preservation Audit" table — that row identifies which method needs to match the old behavior.

- [ ] **Step 4: Run the full agent-path suite — 102 tests must pass**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py backend/tests/test_adapters.py backend/tests/test_driver.py -q`

Expected: `102 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/provider.py
git commit -m "$(cat <<'EOF'
refactor(llm): switch provider entry points to use adapter + driver

stream_with_tools and get_llm_response now dispatch through _get_adapter
and run_tool_loop. _anthropic_stream_with_tools / _openai_stream_with_tools
become 4-line compat shims for test stability — tests in test_llm_provider.py
that import them continue to pass without modification, exercising the new
code path. Old per-provider streaming/response functions still live in
provider.py temporarily and will be deleted in the next task.

102 tests passing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Delete the now-dead per-provider code from `provider.py`

**Goal of this task:** Now that all 102 tests pass via the new code path, remove the duplicate definitions that still exist in `provider.py` (the original `_anthropic_stream_with_tools` body has been replaced by the shim, but the simpler streaming functions, the response functions, the per-provider clients, and the format conversion helpers are still there as orphans). End: `provider.py` contains only entry points, dispatch, post-processing wrappers, and compat shims.

**Files:**
- Modify: `backend/app/llm/provider.py`

- [ ] **Step 1: Delete dead functions and module-level state from `provider.py`**

Remove the following from `backend/app/llm/provider.py`. These have all been replaced by adapter methods and live in `adapters.py` now. **Verify each deletion** — only delete the listed names; the post-processing wrappers (`_with_idle_timeout`, `_buffered_stream`, `_filter_tool_leaks`) and the entry points (`get_llm_response`, `stream_with_tools`) and the compat shims (`_anthropic_stream_with_tools`, `_openai_stream_with_tools`) MUST remain.

Symbols to delete:
- `def _get_anthropic_client(...)`
- `def _get_openai_client(...)`
- `def _build_openai_client(...)`
- `def _build_vision_client(...)` (if present in provider.py)
- `_RETRYABLE_OPENAI = (...)` (module-level tuple)
- `_RETRYABLE_ANTHROPIC = (...)` (module-level tuple)
- `_llm_retry = retry(...)` (module-level decorator)
- `ANTHROPIC_MODEL = "..."` (module-level constant)
- `def _convert_to_anthropic_format(...)`
- `def _convert_tools_to_anthropic(...)`
- `async def _anthropic_response(...)`
- `async def _openai_response(...)`
- `async def _anthropic_stream(...)` (the no-tools streaming version)
- `async def _openai_stream(...)` (the no-tools streaming version)
- The `from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential` block at the top.

**MUST keep** in `provider.py` (compat surface for tests):
- `import openai` and `import anthropic` — even though provider.py no longer uses them directly. The existing tests patch `app.llm.provider.openai.AsyncOpenAI` and `app.llm.provider.anthropic.AsyncAnthropic`; those patch paths require these module attributes to exist. Add `# noqa: F401` to silence linter warnings about unused imports.
- The `_openai_clients` and `_anthropic_clients` dicts must remain accessible as `app.llm.provider._openai_clients` and `app.llm.provider._anthropic_clients` because the existing test scaffolding does `_provider._openai_clients.clear()`. The cleanest way: re-export them from `adapters.py` at the top of provider.py:

```python
# Re-exports of mutable adapter state for tests that need to clear it
# between cases. New code should not rely on these.
from app.llm.adapters import (  # noqa: F401
    _anthropic_clients,
    _openai_clients,
)
```

After deletion, `backend/app/llm/provider.py` should look approximately like this (structure summary — do not literally write a comment block):

- Imports: logging, AsyncIterator, Optional, Settings, ModelConfig
- `import openai`, `import anthropic` (kept with `# noqa: F401` for test patch paths)
- Re-exports from driver: SYSTEM_PROMPT, _SYNTHESIS_NUDGE, helpers
- Re-exports from adapters: AnthropicAdapter, OpenAIAdapter, _anthropic_clients, _openai_clients
- Import from driver: run_tool_loop
- `def _get_adapter(...)`
- `async def get_llm_response(...)`
- `async def stream_with_tools(...)`
- Compat shims (4-line each): `_anthropic_stream_with_tools`, `_openai_stream_with_tools`
- Post-processing wrappers (provider-agnostic): `_with_idle_timeout`, `_buffered_stream`, `_filter_tool_leaks`

Approximate file size after this step: ~170 lines (was ~1100 before this task).

- [ ] **Step 2: Run the full agent-path suite to confirm nothing broke**

Run: `docker exec fn-backend python -m pytest backend/tests/test_llm_provider.py backend/tests/test_chat_e2e.py backend/tests/test_chat_routes.py backend/tests/test_agent_worker.py backend/tests/test_workflows.py backend/tests/test_search.py backend/tests/test_config.py backend/tests/test_auth.py backend/tests/test_memory_throttle.py backend/tests/test_adapters.py backend/tests/test_driver.py -q`

Expected: `102 passed`

If a test fails with `AttributeError` or `ImportError` complaining about a name that should exist in `provider.py`, that name is something else still importing from there — re-add the missing symbol as a re-export from `driver.py` or `adapters.py`. Do **not** restore the deleted implementation; restore the import shim instead.

- [ ] **Step 3: Confirm no callers outside the test suite are broken**

Run: `docker exec fn-backend python -c "from app.llm.provider import get_llm_response, stream_with_tools, SYSTEM_PROMPT, _tool_call_signature, _truncate_tool_result, _summarize_tool_timings, _SYNTHESIS_NUDGE, _anthropic_stream_with_tools, _openai_stream_with_tools, _anthropic_clients, _openai_clients; print('all imports OK')"`

Expected stdout: `all imports OK`

Also confirm test patch paths still resolve:

Run: `docker exec fn-backend python -c "import app.llm.provider as p; print(p.openai.__name__, p.anthropic.__name__)"`

Expected stdout: `openai anthropic`

- [ ] **Step 4: Sanity grep — no orphan references to deleted *function* symbols inside provider.py**

Run: `docker exec fn-backend grep -n "_anthropic_response\|_openai_response\|_anthropic_stream(\|_openai_stream(\|_convert_to_anthropic_format\|_convert_tools_to_anthropic\|_get_anthropic_client\|_get_openai_client\|_build_openai_client\|_build_vision_client\|_RETRYABLE_OPENAI\|_RETRYABLE_ANTHROPIC\|_llm_retry\|ANTHROPIC_MODEL" /app/app/llm/provider.py`

Expected: no output (no matches).

(Note: `_anthropic_clients` and `_openai_clients` are *not* in this grep — they remain as re-exports for tests.)

If the grep finds matches, those are leftover references to deleted symbols — investigate each one. The most likely cause is a function body that still calls a deleted helper.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/provider.py
git commit -m "$(cat <<'EOF'
refactor(llm): delete dead per-provider code from provider.py

Removes _anthropic_stream, _openai_stream, _anthropic_response,
_openai_response, _convert_to_anthropic_format, _convert_tools_to_anthropic,
_get_anthropic_client, _get_openai_client, _build_openai_client,
_build_vision_client, _anthropic_clients, _openai_clients, _llm_retry,
_RETRYABLE_OPENAI, _RETRYABLE_ANTHROPIC, ANTHROPIC_MODEL. All replaced
by adapter methods. provider.py shrinks from ~1100 lines to ~150.

Public surface unchanged. 102 tests still passing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification & wrap-up

**Goal of this task:** Final pass over the full suite, sanity-check the spec's behavior preservation table, and document the result.

**Files:**
- None — verification only.

- [ ] **Step 1: Full agent-path suite — final run**

Run: `docker exec fn-backend python -m pytest backend/tests/ -q --ignore=backend/tests/__pycache__`

Expected: All tests pass. (Total ≥ 102.)

- [ ] **Step 2: Behavior preservation audit walk-through**

For each row in the spec's Behavior Preservation Audit table, confirm the listed "New location" actually contains the behavior. Quick checks:

```bash
# Signature-based stuck detection — should be in run_tool_loop only.
docker exec fn-backend grep -n "stuck =" /app/app/llm/driver.py
# Expected: one match in run_tool_loop.

# JSON-parse-error feedback — should be in _execute_one only.
docker exec fn-backend grep -n "ToolCallParseError" /app/app/llm/driver.py
# Expected: matches in _execute_one and the dataclass definition.

# Per-tool timeout — should be in _execute_one only.
docker exec fn-backend grep -n "asyncio.wait_for" /app/app/llm/driver.py
# Expected: one match in _execute_one.

# Tool result truncation — should be in run_tool_loop only.
docker exec fn-backend grep -n "_truncate_tool_result" /app/app/llm/driver.py
# Expected: usage in run_tool_loop and the helper definition.

# Synthesis nudge text — should appear ONCE.
docker exec fn-backend grep -rn "_SYNTHESIS_NUDGE = (" /app/app/llm/
# Expected: ONE match — in driver.py.

# Telemetry log — should appear ONCE.
docker exec fn-backend grep -rn "tool_loop done" /app/app/llm/
# Expected: ONE match — in driver.py.
```

If any row is duplicated or missing, the refactor is incomplete — investigate before moving on.

- [ ] **Step 3: Line count summary (sanity)**

Run: `wc -l backend/app/llm/provider.py backend/app/llm/driver.py backend/app/llm/adapters.py`

Expected order of magnitude: provider.py ≈ 150 lines, driver.py ≈ 350 lines (including pasted SYSTEM_PROMPT), adapters.py ≈ 280 lines. Total roughly 780 lines vs 1100 before — exact numbers will vary with comments.

- [ ] **Step 4: Confirm git history is clean**

Run: `git log --oneline -7`

Expected: Five new commits from this plan (Tasks 1–5) plus the spec commit if it was committed earlier:
- `refactor(llm): delete dead per-provider code from provider.py`
- `refactor(llm): switch provider entry points to use adapter + driver`
- `refactor(llm): add run_tool_loop and _execute_one to driver`
- `refactor(llm): add OpenAIAdapter implementing ProviderAdapter`
- `refactor(llm): add AnthropicAdapter implementing ProviderAdapter`
- `refactor(llm): scaffold driver.py with shared helpers and Protocol`

- [ ] **Step 5: Note any TODOs surfaced during the refactor**

Briefly review the diff (`git diff main..HEAD -- backend/app/llm/`) for any spots where you cut a corner or noticed a pre-existing oddity that wasn't part of this scope. Examples:
- A test that asserts an internal name we're now exposing only as a compat shim — flag it for follow-up.
- A weird re-export that could be cleaner.

These are not blockers — the refactor is complete. Just a checklist of things worth a follow-up issue.

---

## Done

The unification is complete:

- `provider.py` is the public entry point — short, focused, dispatches.
- `driver.py` owns the shared loop and helpers — every fix lives here once.
- `adapters.py` holds two structurally-typed adapter classes — adding a third provider is one new class.
- 12 new adapter unit tests + 3 new driver tests = 15 new tests.
- All 87 pre-existing tests pass unchanged.
- Public API (`get_llm_response`, `stream_with_tools`, `SYSTEM_PROMPT`) is identical to before.

Future work that's now trivial:
- Adding a Gemini provider — implement one new class with seven methods.
- Cost-per-response calculation — add to the single telemetry log line in `run_tool_loop`.
- New tool-loop features — write once, both providers benefit.
