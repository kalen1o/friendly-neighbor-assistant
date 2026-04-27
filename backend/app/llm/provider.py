import logging
from collections.abc import AsyncIterator
from typing import Optional

import anthropic  # noqa: F401
import openai  # noqa: F401

from app.config import Settings
from app.llm.model_config import ModelConfig
from app.llm.adapters import AnthropicAdapter, OpenAIAdapter
import app.llm.adapters as _adapters

# Re-export shared symbols so existing imports
# (`from app.llm.provider import _tool_call_signature`, etc.) keep working.
from app.llm.driver import (  # noqa: F401
    SYSTEM_PROMPT,
    _SYNTHESIS_NUDGE,
    _summarize_tool_timings,
    _tool_call_signature,
    _truncate_tool_result,
)
from app.llm.driver import run_tool_loop

logger = logging.getLogger(__name__)


def _get_adapter(
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
    vision: bool = False,
):
    """Provider dispatch. The only place provider strings are matched."""
    provider = model_config.provider if model_config else settings.ai_provider
    if provider == "anthropic":
        return AnthropicAdapter(settings, model_config)
    if provider in ("openai", "openai_compatible"):
        return OpenAIAdapter(settings, model_config, vision=vision)
    raise ValueError(f"Unsupported AI provider: {provider}")


# --- Client cache: reuse HTTP connections across calls ---
# These names are re-bound to the adapters' shared dicts so that tests which
# clear `provider._anthropic_clients` / `provider._openai_clients` also flush
# the caches that AnthropicAdapter / OpenAIAdapter use internally.
_anthropic_clients: dict[str, anthropic.AsyncAnthropic] = _adapters._anthropic_clients
_openai_clients: dict[str, openai.AsyncOpenAI] = _adapters._openai_clients


async def get_llm_response(
    messages: list[dict],
    settings: Settings,
    model_config: Optional[ModelConfig] = None,
) -> str:
    adapter = _get_adapter(settings, model_config)
    return await adapter.respond(messages)


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
        _logger=logger,
    ):
        yield chunk


async def _with_idle_timeout(
    source: AsyncIterator[str], timeout_s: float
) -> AsyncIterator[str]:
    """Abort if no chunk arrives within `timeout_s` of the previous one.

    Prevents silent hangs when an upstream provider holds the connection open
    without sending data. Raises a TimeoutError with a readable message so the
    caller can surface it via SSE and the UI can show a retry banner.
    """
    import asyncio

    iterator = source.__aiter__()
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


async def _buffered_stream(
    source: AsyncIterator[str],
    flush_interval: float = 0.06,
    min_chars: int = 8,
) -> AsyncIterator[str]:
    """Buffer token stream and yield multi-word chunks like ChatGPT.

    Flushes on newlines (markdown block boundaries) or every flush_interval
    seconds, whichever comes first. Keeps markdown tokens intact.
    """
    import time

    buffer = ""
    last_flush = time.monotonic()

    async for token in source:
        buffer += token
        now = time.monotonic()

        has_newline = "\n" in buffer
        elapsed = now - last_flush >= flush_interval
        long_enough = len(buffer) >= min_chars

        if has_newline or (elapsed and long_enough):
            yield buffer
            buffer = ""
            last_flush = now

    if buffer:
        yield buffer


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


async def _filter_tool_leaks(source: AsyncIterator[str]) -> AsyncIterator[str]:
    """Strip leaked tool call syntax from streamed chunks.

    Some models (GLM, DeepSeek, Qwen) leak internal markup like
    <tool_call>...</tool_call> or <｜end▁of▁thinking｜> into the text stream.
    """
    buffer = ""
    in_tool_leak = False

    async for chunk in source:
        buffer += chunk

        # Check if we're inside a leaked tool call block
        if "<tool_call>" in buffer and not in_tool_leak:
            # Yield everything before the tag
            idx = buffer.index("<tool_call>")
            if idx > 0:
                yield buffer[:idx]
            buffer = buffer[idx:]
            in_tool_leak = True

        if in_tool_leak:
            # Look for end markers
            for end_marker in ("</tool_call>", "<｜end▁of▁thinking｜>"):
                if end_marker in buffer:
                    idx = buffer.index(end_marker) + len(end_marker)
                    buffer = buffer[idx:]
                    in_tool_leak = False
                    break
            # If still in leak and buffer is getting large, discard it
            if in_tool_leak and len(buffer) > 2000:
                buffer = ""
                in_tool_leak = False
            continue

        # Not in a leak — yield the buffer
        if buffer:
            yield buffer
            buffer = ""

    # Flush remaining buffer
    if buffer and not in_tool_leak:
        yield buffer


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
        _logger=logger,
    ):
        yield chunk
