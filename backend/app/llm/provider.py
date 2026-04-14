import logging
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

logger = logging.getLogger(__name__)

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

SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely.\n\n"
    "When the user asks you to build, create, or generate a UI component, "
    "web page, or interactive application, wrap your code in an artifact tag.\n\n"
    "Always use the project format with a JSON manifest:\n\n"
    '<artifact type="project" title="Project Name" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "export default function App() { return <h1>Hello</h1>; }"\n'
    '  },\n'
    '  "dependencies": {}\n'
    '}\n'
    "</artifact>\n\n"
    "For multi-file projects:\n\n"
    '<artifact type="project" title="Todo App" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "import Counter from \'./Counter\';\\nexport default function App() { return <Counter />; }",\n'
    '    "/Counter.js": "export default function Counter() { ... }"\n'
    '  },\n'
    '  "dependencies": {\n'
    '    "uuid": "latest"\n'
    '  }\n'
    '}\n'
    "</artifact>\n\n"
    "Rules for artifacts:\n"
    "- Always use type=\"project\" with a JSON manifest.\n"
    "- template is \"react\" (default) or \"vanilla\" (plain HTML/JS).\n"
    "- React projects must include /App.js as the entry point.\n"
    "- Vanilla projects must include /index.html as the entry point.\n"
    "- The files object has file paths as keys (starting with /) and code strings as values.\n"
    "- The dependencies object maps npm package names to version strings. Use {} if none.\n"
    "- Even simple single-component UIs use this format (one file is fine).\n"
    "- Always include the artifact tag when generating UI code.\n"
    "- You can still include explanation text outside the artifact tag."
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
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


def _build_openai_client(
    settings: Settings, model_config: Optional[ModelConfig] = None
) -> openai.AsyncOpenAI:
    if model_config:
        kwargs: dict = {"api_key": model_config.api_key, "timeout": 120.0}
        if model_config.base_url:
            kwargs["base_url"] = model_config.base_url
    else:
        kwargs = {"api_key": settings.openai_api_key, "timeout": 120.0}
        if settings.openai_base_url:
            kwargs["base_url"] = settings.openai_base_url
    return openai.AsyncOpenAI(**kwargs)


def _build_vision_client(settings: Settings) -> openai.AsyncOpenAI:
    """Build an OpenAI client for vision requests, using vision-specific keys if set."""
    api_key = settings.vision_api_key or settings.openai_api_key
    base_url = settings.vision_base_url or settings.openai_base_url
    kwargs: dict = {"api_key": api_key, "timeout": 120.0}
    if base_url:
        kwargs["base_url"] = base_url
    return openai.AsyncOpenAI(**kwargs)


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
    client = anthropic.AsyncAnthropic(api_key=api_key)
    converted = _convert_to_anthropic_format(messages)
    async with client.messages.stream(
        model=model,
        max_tokens=4096,
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
    client = anthropic.AsyncAnthropic(api_key=api_key)
    converted = _convert_to_anthropic_format(messages)
    anthropic_tools = _convert_tools_to_anthropic(tools) if tools else []

    kwargs = {
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": converted,
    }
    if anthropic_tools:
        kwargs["tools"] = anthropic_tools

    for _ in range(max_tool_rounds):
        response = await client.messages.create(**kwargs)

        # Process content blocks
        text_content = ""
        tool_uses = []

        for block in response.content:
            if block.type == "text":
                text_content += block.text
                yield block.text
            elif block.type == "tool_use":
                tool_uses.append(
                    {"id": block.id, "name": block.name, "input": block.input}
                )

        # If no tool calls, we're done
        if not tool_uses:
            return

        # Add assistant response to messages
        kwargs["messages"].append({"role": "assistant", "content": response.content})

        # Execute tools in parallel
        async def _execute_tool(tu):
            if on_tool_call:
                await on_tool_call(tu["name"], tu.get("input", {}))
            if tool_executor:
                try:
                    result = await tool_executor(tu["name"], tu["input"])
                except Exception as e:
                    result = f"Tool error: {str(e)}"
            else:
                result = f"Tool {tu['name']} not available"
            return tu["id"], str(result) if not isinstance(result, str) else result

        results = await _asyncio.gather(*[_execute_tool(tu) for tu in tool_uses])

        # Add tool results
        tool_result_content = [
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": result_text,
            }
            for tool_id, result_text in results
        ]
        kwargs["messages"].append({"role": "user", "content": tool_result_content})

        # Loop back for next response

    # Hit max rounds — final response without tools
    kwargs.pop("tools", None)
    response = await client.messages.create(**kwargs)
    for block in response.content:
        if block.type == "text":
            yield block.text


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
                messages, settings, tools, tool_executor, on_tool_call, rounds,
                model_config=model_config,
            )
        else:
            raw = _anthropic_stream(messages, settings, model_config)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")

    async for chunk in _buffered_stream(raw):
        yield chunk


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
    }
    if tools and not vision:
        kwargs["tools"] = tools

    @_llm_retry
    async def _create_stream(**kw):
        return await client.chat.completions.create(**kw)

    for round_num in range(max_tool_rounds):
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
            delta = chunk.choices[0].delta

            # Stream text content to user
            if delta.content:
                collected_content += delta.content
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

            # Check finish reason
            if chunk.choices[0].finish_reason == "stop":
                return  # Done, no more tool calls

            if chunk.choices[0].finish_reason == "tool_calls":
                break  # Need to execute tools

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
            logger.info("Tool round %d: LLM returned text only, no tool calls", round_num + 1)

        # If no tool calls were made, we're done
        if not tool_calls_in_progress:
            logger.info(
                "Tool round %d: no tool calls, done (content=%d chars)",
                round_num + 1,
                len(collected_content),
            )
            return

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
            try:
                import json as _json

                arguments = (
                    _json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
                )
            except _json.JSONDecodeError:
                arguments = {}

            if on_tool_call:
                await on_tool_call(tool_name, arguments)

            if tool_executor:
                try:
                    result = await tool_executor(tool_name, arguments)
                except Exception as e:
                    result = f"Tool error: {str(e)}"
            else:
                result = f"Tool {tool_name} not available"

            return tc_data["id"], str(result) if not isinstance(result, str) else result

        # Run all tools in parallel
        tool_results = await _asyncio.gather(
            *[_execute_single_tool(tc) for tc in tool_calls_in_progress.values()]
        )

        # Add results to messages in order
        for tc_call_id, result_content in tool_results:
            kwargs["messages"].append(
                {
                    "role": "tool",
                    "tool_call_id": tc_call_id,
                    "content": result_content,
                }
            )

        # Loop back to get LLM's response after tool results
        logger.info(
            "Tool round %d: executed %d tools, looping back to LLM",
            round_num + 1,
            len(tool_results),
        )
        continue

    # Hit max tool rounds — force a final text response without tools
    kwargs.pop("tools", None)
    stream = await _create_stream(**kwargs)
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content
