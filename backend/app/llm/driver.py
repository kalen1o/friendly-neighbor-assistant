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
