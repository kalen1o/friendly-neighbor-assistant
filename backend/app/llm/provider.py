import logging
import time
from collections.abc import AsyncIterator
from typing import Optional

import anthropic
import openai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import Settings
from app.llm.model_config import ModelConfig

# Re-export shared symbols so existing imports
# (`from app.llm.provider import _tool_call_signature`, etc.) keep working.
from app.llm.driver import (  # noqa: F401
    SYSTEM_PROMPT,
    _SYNTHESIS_NUDGE,
    _summarize_tool_timings,
    _tool_call_signature,
    _truncate_tool_result,
)

logger = logging.getLogger(__name__)

# --- Client cache: reuse HTTP connections across calls ---
_anthropic_clients: dict[str, anthropic.AsyncAnthropic] = {}
_openai_clients: dict[str, openai.AsyncOpenAI] = {}


def _get_anthropic_client(api_key: str) -> anthropic.AsyncAnthropic:
    if api_key not in _anthropic_clients:
        _anthropic_clients[api_key] = anthropic.AsyncAnthropic(api_key=api_key)
    return _anthropic_clients[api_key]


def _get_openai_client(api_key: str, base_url: str | None = None) -> openai.AsyncOpenAI:
    cache_key = f"{api_key}:{base_url or ''}"
    if cache_key not in _openai_clients:
        kwargs: dict = {"api_key": api_key, "timeout": 300.0}
        if base_url:
            kwargs["base_url"] = base_url
        _openai_clients[cache_key] = openai.AsyncOpenAI(**kwargs)
    return _openai_clients[cache_key]


# Retry on transient errors: rate limits, server errors, timeouts
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

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"

async def get_llm_response(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> str:
    provider = model_config.provider if model_config else settings.ai_provider
    if provider == "anthropic":
        return await _anthropic_response(messages, settings, model_config)
    elif provider in ("openai", "openai_compatible"):
        return await _openai_response(messages, settings, model_config)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


async def stream_llm_response(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> AsyncIterator[str]:
    provider = model_config.provider if model_config else settings.ai_provider
    if provider == "anthropic":
        async for chunk in _anthropic_stream(messages, settings, model_config):
            yield chunk
    elif provider in ("openai", "openai_compatible"):
        async for chunk in _openai_stream(messages, settings, model_config):
            yield chunk
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


@_llm_retry
async def _anthropic_response(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> str:
    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = _get_anthropic_client(api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=settings.max_output_tokens,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


def _build_openai_client(
    settings: Settings, model_config: Optional[ModelConfig] = None
) -> openai.AsyncOpenAI:
    if model_config:
        return _get_openai_client(model_config.api_key, model_config.base_url)
    else:
        return _get_openai_client(settings.openai_api_key, settings.openai_base_url)


def _build_vision_client(settings: Settings) -> openai.AsyncOpenAI:
    """Build an OpenAI client for vision requests, using vision-specific keys if set."""
    api_key = settings.vision_api_key or settings.openai_api_key
    base_url = settings.vision_base_url or settings.openai_base_url
    return _get_openai_client(api_key, base_url)


@_llm_retry
async def _openai_response(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> str:
    client = _build_openai_client(settings, model_config)
    model = model_config.model_id if model_config else settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model=model,
        messages=full_messages,
    )
    return response.choices[0].message.content


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
    anthropic_tools = []
    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool["function"]
        anthropic_tools.append(
            {
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
        )
    return anthropic_tools


async def _anthropic_stream(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> AsyncIterator[str]:
    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = _get_anthropic_client(api_key)
    converted = _convert_to_anthropic_format(messages)
    async with client.messages.stream(
        model=model,
        max_tokens=settings.max_output_tokens,
        system=SYSTEM_PROMPT,
        messages=converted,
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def _anthropic_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    model_config: Optional[ModelConfig] = None,
) -> AsyncIterator[str]:
    """Anthropic streaming with multi-turn tool calling loop."""
    import asyncio as _asyncio

    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = _get_anthropic_client(api_key)
    converted = _convert_to_anthropic_format(messages)
    anthropic_tools = _convert_tools_to_anthropic(tools) if tools else []

    kwargs = {
        "model": model,
        "max_tokens": settings.max_output_tokens,
        "system": SYSTEM_PROMPT,
        "messages": converted,
    }
    if anthropic_tools:
        kwargs["tools"] = anthropic_tools

    needs_separator = False
    seen_signatures: set[str] = set()
    finished_normally = False

    # Telemetry: aggregated at the end into one structured log line.
    rounds_used = 0
    tools_called = 0
    timeouts = 0
    truncations = 0
    stuck_triggered = False
    synthesis_fallback_used = False
    unique_tools_seen: set[str] = set()
    prompt_tokens = 0
    completion_tokens = 0
    # (tool_name, duration_ms) per executed tool call.
    tool_timings: list[tuple[str, float]] = []

    for round_num in range(max_tool_rounds):
        rounds_used = round_num + 1
        # Stream response — text yields immediately to the user
        tool_uses = []
        had_text = False

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                if needs_separator:
                    yield "\n\n"
                    needs_separator = False
                had_text = True
                yield text

            # After stream completes, get the full message to check for tool calls
            response = await stream.get_final_message()

        # Pull token usage off the final message (Anthropic always includes it).
        usage = getattr(response, "usage", None)
        if usage is not None:
            prompt_tokens += getattr(usage, "input_tokens", 0) or 0
            completion_tokens += getattr(usage, "output_tokens", 0) or 0

        # Extract tool calls from the final message
        for block in response.content:
            if block.type == "tool_use":
                tool_uses.append(
                    {"id": block.id, "name": block.name, "input": block.input}
                )

        # If no tool calls, we're done. Break (rather than return) so we still
        # emit the telemetry log on the way out.
        if not tool_uses:
            finished_normally = True
            break

        if had_text:
            needs_separator = True

        # Add assistant response to messages
        kwargs["messages"].append({"role": "assistant", "content": response.content})

        # Detect a stuck loop: every (tool, args) this round was already requested
        # in a prior round. Generalizes the older URL-only check to all tools.
        round_signatures = {
            _tool_call_signature(tu["name"], tu.get("input", {})) for tu in tool_uses
        }
        stuck = round_num > 0 and round_signatures.issubset(seen_signatures)
        seen_signatures.update(round_signatures)
        if stuck:
            stuck_triggered = True

        # Telemetry: count tools and unique tool names this round.
        tools_called += len(tool_uses)
        unique_tools_seen.update(tu["name"] for tu in tool_uses if tu.get("name"))

        # Execute tools in parallel (with a per-tool timeout so one slow
        # tool can't stall the whole round)
        tool_timeout = settings.tool_call_timeout_s

        async def _execute_tool(tu):
            if on_tool_call:
                await on_tool_call(tu["name"], tu.get("input", {}))
            start = time.perf_counter()
            try:
                if tool_executor:
                    try:
                        result = await _asyncio.wait_for(
                            tool_executor(tu["name"], tu["input"]),
                            timeout=tool_timeout,
                        )
                    except _asyncio.TimeoutError:
                        result = (
                            f"Tool error: '{tu['name']}' timed out after "
                            f"{tool_timeout}s"
                        )
                    except Exception as e:
                        result = f"Tool error: {str(e)}"
                else:
                    result = f"Tool {tu['name']} not available"
            finally:
                tool_timings.append(
                    (tu["name"], (time.perf_counter() - start) * 1000)
                )
            return tu["id"], str(result) if not isinstance(result, str) else result

        results = await _asyncio.gather(*[_execute_tool(tu) for tu in tool_uses])

        # Telemetry: count timeouts and truncations.
        timeout_marker = f"timed out after {tool_timeout}s"
        timeouts += sum(1 for _, r in results if timeout_marker in r)
        result_limit = settings.tool_result_max_chars
        if result_limit > 0:
            truncations += sum(
                1 for _, r in results if len(r) > result_limit
            )

        # Add tool results (truncated so a single huge fetch can't dominate context)
        tool_result_content: list = [
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": _truncate_tool_result(result_text, result_limit),
            }
            for tool_id, result_text in results
        ]

        if stuck:
            logger.info(
                "Anthropic tool round %d: repeated tool calls — forcing synthesis",
                round_num + 1,
            )
            # Anthropic requires alternating user/assistant, so the nudge rides
            # along inside the same user message as the tool_result blocks.
            tool_result_content.append({"type": "text", "text": _SYNTHESIS_NUDGE})
            kwargs.pop("tools", None)

        kwargs["messages"].append({"role": "user", "content": tool_result_content})

        # Loop back for next response

    # Only fire the no-tools synthesis fallback when we genuinely exhausted
    # rounds — never on a clean stop, which would double-bill and risk
    # appending unrelated text to the user's response.
    if not finished_normally:
        synthesis_fallback_used = True
        kwargs.pop("tools", None)
        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
            fallback_msg = await stream.get_final_message()
        fallback_usage = getattr(fallback_msg, "usage", None)
        if fallback_usage is not None:
            prompt_tokens += getattr(fallback_usage, "input_tokens", 0) or 0
            completion_tokens += getattr(fallback_usage, "output_tokens", 0) or 0

    slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(tool_timings)
    logger.info(
        "tool_loop done",
        extra={
            "provider": "anthropic",
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


async def _openai_stream(
    messages: list[dict], settings: Settings, model_config: Optional[ModelConfig] = None
) -> AsyncIterator[str]:
    client = _build_openai_client(settings, model_config)
    model = model_config.model_id if model_config else settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


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
    """Stream LLM response with native tool calling support.

    The LLM can call tools mid-generation. When it does:
    1. We execute the tool
    2. Send the result back
    3. LLM continues generating

    Args:
        messages: Chat messages (OpenAI format)
        settings: App settings
        tools: List of tool definitions (OpenAI function calling format)
        tool_executor: async fn(tool_name, arguments) -> str
        on_tool_call: async fn(tool_name) -> None (for SSE action events)
        model_config: Optional per-request model override
    """
    rounds = max_tool_rounds or settings.max_tool_rounds
    provider = model_config.provider if model_config else settings.ai_provider
    if provider in ("openai", "openai_compatible"):
        raw = _openai_stream_with_tools(
            messages,
            settings,
            tools,
            tool_executor,
            on_tool_call,
            rounds,
            vision=vision,
            model_config=model_config,
        )
    elif provider == "anthropic":
        if tools and not vision:
            raw = _anthropic_stream_with_tools(
                messages,
                settings,
                tools,
                tool_executor,
                on_tool_call,
                rounds,
                model_config=model_config,
            )
        else:
            raw = _anthropic_stream(messages, settings, model_config)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")

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
    """OpenAI-compatible streaming with tool calling loop."""

    if model_config:
        client = _build_openai_client(settings, model_config)
        model = model_config.model_id
    elif vision:
        client = _build_vision_client(settings)
        model = settings.vision_model or settings.openai_model
    else:
        client = _build_openai_client(settings)
        model = settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    # Build API kwargs
    kwargs = {
        "model": model,
        "messages": full_messages,
        "stream": True,
        # Ask the server to emit a final usage-only chunk so we can record
        # token spend per response. Compatible endpoints that don't support
        # this should ignore it; we degrade to zero counts.
        "stream_options": {"include_usage": True},
    }
    if tools and not vision:
        kwargs["tools"] = tools

    @_llm_retry
    async def _create_stream(**kw):
        return await client.chat.completions.create(**kw)

    total_content_yielded = 0
    finished_normally = False
    needs_separator = False
    seen_signatures: set[str] = set()

    # Telemetry: aggregated at the end into one structured log line. Lets us
    # tell in prod whether the various guards (stuck detection, per-tool
    # timeouts, truncation, trailing synthesis fallback) ever fire.
    rounds_used = 0
    tools_called = 0
    timeouts = 0
    truncations = 0
    stuck_triggered = False
    synthesis_fallback_used = False
    unique_tools_seen: set[str] = set()
    prompt_tokens = 0
    completion_tokens = 0
    # (tool_name, duration_ms) per executed tool call.
    tool_timings: list[tuple[str, float]] = []

    for round_num in range(max_tool_rounds):
        rounds_used = round_num + 1
        logger.info(
            "Tool round %d: calling LLM with %d messages",
            round_num + 1,
            len(kwargs["messages"]),
        )
        stream = await _create_stream(**kwargs)

        # Collect the response — may contain tool calls or content
        collected_content = ""
        tool_calls_in_progress = {}  # index -> {id, name, arguments}

        async for chunk in stream:
            # Final usage-only chunks (when stream_options.include_usage is
            # set) carry no choices but do carry a `usage` object. Pull it
            # out before checking choices so we don't IndexError.
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                prompt_tokens += getattr(chunk_usage, "prompt_tokens", 0) or 0
                completion_tokens += (
                    getattr(chunk_usage, "completion_tokens", 0) or 0
                )
            if not chunk.choices:
                continue

            delta = chunk.choices[0].delta

            # Stream text content to user
            if delta.content:
                if needs_separator:
                    yield "\n\n"
                    needs_separator = False
                collected_content += delta.content
                total_content_yielded += len(delta.content)
                yield delta.content

            # Accumulate tool call data
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
                            tool_calls_in_progress[tc_id]["name"] = tc.function.name
                            tool_calls_in_progress[tc_id]["id"] = (
                                tc.id or tool_calls_in_progress[tc_id]["id"]
                            )
                        if tc.function.arguments:
                            tool_calls_in_progress[tc_id]["arguments"] += (
                                tc.function.arguments
                            )

            # Check finish reason. Don't break here — OpenAI emits the
            # usage-only chunk *after* finish_reason when stream_options.
            # include_usage is set, so we keep iterating to drain it. The
            # subsequent chunks have no content / no tool_calls.
            if chunk.choices[0].finish_reason == "stop":
                finished_normally = True
            # finish_reason="tool_calls" doesn't need its own flag; we'll
            # detect it below by the presence of accumulated tool calls.

        # Model signalled end of turn — exit the tool loop.
        if finished_normally:
            break

        # Log what the LLM returned this round
        if tool_calls_in_progress:
            for tc_idx, tc_data in tool_calls_in_progress.items():
                logger.info(
                    "Tool round %d: LLM requested tool=%s query=%s",
                    round_num + 1,
                    tc_data["name"],
                    tc_data["arguments"][:200],
                )
        else:
            logger.info(
                "Tool round %d: LLM returned text only, no tool calls", round_num + 1
            )

        # If no tool calls were made, we're done
        if not tool_calls_in_progress:
            logger.info(
                "Tool round %d: no tool calls, done (content=%d chars)",
                round_num + 1,
                len(collected_content),
            )
            break

        # Build assistant message with tool calls for the conversation
        assistant_tool_calls = []
        for tc_data in tool_calls_in_progress.values():
            assistant_tool_calls.append(
                {
                    "id": tc_data["id"],
                    "type": "function",
                    "function": {
                        "name": tc_data["name"],
                        "arguments": tc_data["arguments"],
                    },
                }
            )

        # Add the assistant's response (with tool calls) to messages
        assistant_msg = {
            "role": "assistant",
            "content": collected_content or None,
            "tool_calls": assistant_tool_calls,
        }
        kwargs["messages"].append(assistant_msg)

        # Execute all tool calls in parallel
        import asyncio as _asyncio

        async def _execute_single_tool(tc_data):
            tool_name = tc_data["name"]
            import json as _json

            raw_args = tc_data["arguments"]
            try:
                arguments = _json.loads(raw_args) if raw_args else {}
            except _json.JSONDecodeError as e:
                # Don't run the tool with empty args — let the model see the
                # parse error so it can retry with valid JSON.
                snippet = raw_args[:200] if raw_args else "<empty>"
                err = (
                    f"Tool error: invalid JSON arguments ({e.msg}). "
                    f"Received: {snippet}"
                )
                return tc_data["id"], err

            if on_tool_call:
                await on_tool_call(tool_name, arguments)

            start = time.perf_counter()
            try:
                if tool_executor:
                    try:
                        result = await _asyncio.wait_for(
                            tool_executor(tool_name, arguments),
                            timeout=settings.tool_call_timeout_s,
                        )
                    except _asyncio.TimeoutError:
                        result = (
                            f"Tool error: '{tool_name}' timed out after "
                            f"{settings.tool_call_timeout_s}s"
                        )
                    except Exception as e:
                        result = f"Tool error: {str(e)}"
                else:
                    result = f"Tool {tool_name} not available"
            finally:
                tool_timings.append(
                    (tool_name, (time.perf_counter() - start) * 1000)
                )

            return tc_data["id"], str(result) if not isinstance(result, str) else result

        # Detect a stuck loop: every (tool, args) this round was already requested
        # in a prior round. Generalizes the older URL-only check to all tools.
        round_signatures = {
            _tool_call_signature(tc["name"], tc["arguments"])
            for tc in tool_calls_in_progress.values()
        }
        stuck = round_num > 0 and round_signatures.issubset(seen_signatures)
        seen_signatures.update(round_signatures)
        if stuck:
            stuck_triggered = True

        # Telemetry: count tools and unique tool names this round.
        tools_called += len(tool_calls_in_progress)
        unique_tools_seen.update(
            tc["name"] for tc in tool_calls_in_progress.values() if tc.get("name")
        )

        # Run all tools in parallel
        tool_results = await _asyncio.gather(
            *[_execute_single_tool(tc) for tc in tool_calls_in_progress.values()]
        )

        # Telemetry: count timeout markers in the results.
        timeout_marker = (
            f"timed out after {settings.tool_call_timeout_s}s"
        )
        timeouts += sum(1 for _, r in tool_results if timeout_marker in r)

        # Add results to messages in order (truncated so a single huge fetch
        # can't dominate context across rounds)
        result_limit = settings.tool_result_max_chars
        for tc_call_id, result_content in tool_results:
            if result_limit > 0 and len(result_content) > result_limit:
                truncations += 1
            kwargs["messages"].append(
                {
                    "role": "tool",
                    "tool_call_id": tc_call_id,
                    "content": _truncate_tool_result(result_content, result_limit),
                }
            )

        if stuck:
            logger.info(
                "Tool round %d: repeated tool calls — forcing synthesis next round",
                round_num + 1,
            )
            kwargs["messages"].append(
                {"role": "user", "content": _SYNTHESIS_NUDGE}
            )
            kwargs.pop("tools", None)

        if collected_content:
            needs_separator = True

        # Loop back to get LLM's response after tool results
        logger.info(
            "Tool round %d: executed %d tools, looping back to LLM",
            round_num + 1,
            len(tool_results),
        )
        continue

    # If the model didn't finish on its own and we never streamed any text,
    # try one last synthesis call without tools — the model often produces a
    # real answer once freed from the tool-calling contract. Previously this
    # ran unconditionally, double-billing every response and risking extra
    # text appended after a clean stop.
    if not finished_normally and total_content_yielded == 0:
        synthesis_fallback_used = True
        kwargs.pop("tools", None)
        stream = await _create_stream(**kwargs)
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
                total_content_yielded += len(delta.content)
                yield delta.content

    # Last-resort canned fallback if synthesis also produced nothing.
    if total_content_yielded == 0:
        logger.warning(
            "Tool loop exited with no response text (finished_normally=%s)",
            finished_normally,
        )
        sources = getattr(tool_executor, "collected_sources", None) or []
        seen = set()
        url_lines = []
        for s in sources:
            u = s.get("url") or s.get("title", "")
            if u and u not in seen:
                seen.add(u)
                url_lines.append(f"- {u}")
            if len(url_lines) >= 5:
                break
        if url_lines:
            yield (
                "I gathered information but couldn't finalize an answer. "
                "Sources consulted:\n\n"
                + "\n".join(url_lines)
                + "\n\nPlease rephrase or ask me to summarize these sources."
            )
        else:
            yield (
                "I wasn't able to produce an answer. "
                "Please try rephrasing your question."
            )

    slowest_name, slowest_ms, total_tool_ms = _summarize_tool_timings(tool_timings)
    logger.info(
        "tool_loop done",
        extra={
            "provider": "openai",
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
            "chars_yielded": total_content_yielded,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "slowest_tool_name": slowest_name,
            "slowest_tool_ms": slowest_ms,
            "total_tool_ms": total_tool_ms,
        },
    )
