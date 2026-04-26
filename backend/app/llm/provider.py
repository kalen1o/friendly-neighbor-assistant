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
    for round_num in range(max_tool_rounds):
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

        # Extract tool calls from the final message
        for block in response.content:
            if block.type == "tool_use":
                tool_uses.append(
                    {"id": block.id, "name": block.name, "input": block.input}
                )

        # If no tool calls, we're done
        if not tool_uses:
            return

        if had_text:
            needs_separator = True

        # Add assistant response to messages
        kwargs["messages"].append({"role": "assistant", "content": response.content})

        fetch_cache = getattr(tool_executor, "fetch_cache", None)
        urls_before = set(fetch_cache.keys()) if fetch_cache is not None else set()

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

        # If no new URLs were fetched, the model is spinning — strip tools and
        # force a final synthesis next round.
        urls_after = set(fetch_cache.keys()) if fetch_cache is not None else set()
        stuck = (
            fetch_cache is not None and round_num > 0 and not (urls_after - urls_before)
        )
        if stuck:
            logger.info(
                "Anthropic tool round %d: no new URLs — forcing synthesis",
                round_num + 1,
            )
            kwargs.pop("tools", None)

        # Loop back for next response

    # Hit max rounds — final response without tools
    kwargs.pop("tools", None)
    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


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
    }
    if tools and not vision:
        kwargs["tools"] = tools

    @_llm_retry
    async def _create_stream(**kw):
        return await client.chat.completions.create(**kw)

    total_content_yielded = 0
    finished_normally = False
    needs_separator = False

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

            # Check finish reason
            if chunk.choices[0].finish_reason == "stop":
                finished_normally = True
                break  # Done, no more tool calls — but fall through to fallback check

            if chunk.choices[0].finish_reason == "tool_calls":
                break  # Need to execute tools

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

        # Snapshot fetch cache before tools run so we can detect "nothing new"
        fetch_cache = getattr(tool_executor, "fetch_cache", None)
        urls_before = set(fetch_cache.keys()) if fetch_cache is not None else set()

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

        # If this round fetched no new URLs, the model is spinning.
        # Nudge it to synthesize and strip tools for the next call.
        urls_after = set(fetch_cache.keys()) if fetch_cache is not None else set()
        stuck = (
            fetch_cache is not None and round_num > 0 and not (urls_after - urls_before)
        )
        if stuck:
            logger.info(
                "Tool round %d: no new URLs fetched — forcing synthesis next round",
                round_num + 1,
            )
            kwargs["messages"].append(
                {
                    "role": "system",
                    "content": (
                        "You already have sufficient information from prior tool "
                        "calls. Do not call any more tools. Answer the user now "
                        "using the content already gathered."
                    ),
                }
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

    # Tool loop finished (either exhausted rounds or model stopped) but no
    # response text was yielded. Emit a fallback so the user sees something.
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

    # Hit max tool rounds — force a final text response without tools
    kwargs.pop("tools", None)
    stream = await _create_stream(**kwargs)
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content
