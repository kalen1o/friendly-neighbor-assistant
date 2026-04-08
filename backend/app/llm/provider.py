from collections.abc import AsyncIterator

import anthropic
import openai

from app.config import Settings

SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely."
)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"


async def get_llm_response(messages: list[dict], settings: Settings) -> str:
    if settings.ai_provider == "anthropic":
        return await _anthropic_response(messages, settings)
    elif settings.ai_provider == "openai":
        return await _openai_response(messages, settings)
    else:
        raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")


async def stream_llm_response(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    if settings.ai_provider == "anthropic":
        async for chunk in _anthropic_stream(messages, settings):
            yield chunk
    elif settings.ai_provider == "openai":
        async for chunk in _openai_stream(messages, settings):
            yield chunk
    else:
        raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")


async def _anthropic_response(messages: list[dict], settings: Settings) -> str:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


def _build_openai_client(settings: Settings) -> openai.AsyncOpenAI:
    kwargs: dict = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return openai.AsyncOpenAI(**kwargs)


async def _openai_response(messages: list[dict], settings: Settings) -> str:
    client = _build_openai_client(settings)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=full_messages,
    )
    return response.choices[0].message.content


async def _anthropic_stream(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    async with client.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def _openai_stream(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    client = _build_openai_client(settings)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    stream = await client.chat.completions.create(
        model=settings.openai_model,
        messages=full_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
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
    """
    if settings.ai_provider == "openai":
        async for chunk in _openai_stream_with_tools(
            messages, settings, tools, tool_executor, on_tool_call
        ):
            yield chunk
    elif settings.ai_provider == "anthropic":
        # Anthropic has different tool calling format — fallback to simple stream for now
        async for chunk in _anthropic_stream(messages, settings):
            yield chunk
    else:
        raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")


async def _openai_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
) -> AsyncIterator[str]:
    """OpenAI-compatible streaming with tool calling loop."""
    import json as _json

    client = _build_openai_client(settings)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    # Build API kwargs
    kwargs = {
        "model": settings.openai_model,
        "messages": full_messages,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools

    max_tool_rounds = 5  # prevent infinite loops

    for _ in range(max_tool_rounds):
        stream = await client.chat.completions.create(**kwargs)

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
                            tool_calls_in_progress[tc_id]["id"] = tc.id or tool_calls_in_progress[tc_id]["id"]
                        if tc.function.arguments:
                            tool_calls_in_progress[tc_id]["arguments"] += tc.function.arguments

            # Check finish reason
            if chunk.choices[0].finish_reason == "stop":
                return  # Done, no more tool calls

            if chunk.choices[0].finish_reason == "tool_calls":
                break  # Need to execute tools

        # If no tool calls were made, we're done
        if not tool_calls_in_progress:
            return

        # Build assistant message with tool calls for the conversation
        assistant_tool_calls = []
        for tc_data in tool_calls_in_progress.values():
            assistant_tool_calls.append({
                "id": tc_data["id"],
                "type": "function",
                "function": {
                    "name": tc_data["name"],
                    "arguments": tc_data["arguments"],
                },
            })

        # Add the assistant's response (with tool calls) to messages
        assistant_msg = {"role": "assistant", "content": collected_content or None, "tool_calls": assistant_tool_calls}
        kwargs["messages"].append(assistant_msg)

        # Execute each tool and add results
        for tc_data in tool_calls_in_progress.values():
            tool_name = tc_data["name"]

            if on_tool_call:
                await on_tool_call(tool_name)

            try:
                arguments = _json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
            except _json.JSONDecodeError:
                arguments = {}

            # Execute the tool
            if tool_executor:
                try:
                    result = await tool_executor(tool_name, arguments)
                except Exception as e:
                    result = f"Tool error: {str(e)}"
            else:
                result = f"Tool {tool_name} not available"

            # Add tool result to messages
            kwargs["messages"].append({
                "role": "tool",
                "tool_call_id": tc_data["id"],
                "content": str(result) if not isinstance(result, str) else result,
            })

        # Loop back to get LLM's response after tool results
        continue

    # If we hit max rounds, just return what we have
