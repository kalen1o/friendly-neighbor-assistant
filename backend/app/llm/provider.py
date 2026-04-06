from collections.abc import AsyncIterator

import anthropic
import openai

from app.config import Settings

SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely."
)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
OPENAI_MODEL = "gpt-4o"


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


async def _openai_response(messages: list[dict], settings: Settings) -> str:
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model=OPENAI_MODEL,
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
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    stream = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=full_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
