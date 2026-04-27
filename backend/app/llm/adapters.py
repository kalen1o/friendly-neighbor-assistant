"""Provider adapters implementing the ProviderAdapter Protocol."""

from __future__ import annotations

import json as _json
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

logger = logging.getLogger(__name__)

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

    def __init__(self, settings: Settings, model_config: Optional[ModelConfig] = None):
        self._settings = settings
        api_key = model_config.api_key if model_config else settings.anthropic_api_key
        self._client = _get_anthropic_client(api_key)
        self._model = model_config.model_id if model_config else ANTHROPIC_MODEL

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

    def append_assistant_turn(self, kwargs: dict, round_result: RoundResult) -> None:
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
            return ToolCallParseError(raw_args=str(call.raw_args), reason=e.msg)

    async def stream_simple(self, kwargs: dict) -> AsyncIterator[str]:
        async with self._client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    async def respond(self, messages: list) -> str:
        kwargs = self.build_kwargs(messages, tools=None)
        response = await self._client.messages.create(**kwargs)
        return response.content[0].text


# ---------------------------------------------------------------------------
# OpenAI client cache + retry decorator
# ---------------------------------------------------------------------------

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


def _get_openai_client(
    api_key: str, base_url: Optional[str] = None
) -> openai.AsyncOpenAI:
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
    return _get_openai_client(settings.openai_api_key, settings.openai_base_url or None)


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
                completion_tokens += getattr(chunk_usage, "completion_tokens", 0) or 0
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
                            tool_calls_in_progress[tc_id]["name"] = tc.function.name
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
        usage = Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
        yield RoundEnd(result=RoundResult(tool_calls=tool_calls, usage=usage))

    def append_assistant_turn(self, kwargs: dict, round_result: RoundResult) -> None:
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
            kwargs["messages"].append({"role": "user", "content": _SYNTHESIS_NUDGE})
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
