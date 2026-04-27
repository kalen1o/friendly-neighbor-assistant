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
                    "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAA="},
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
    kwargs = adapter.build_kwargs([{"role": "user", "content": "hi"}], tools=None)
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
    tools = [{"type": "function", "function": {"name": "web_search", "parameters": {}}}]
    kwargs = adapter.build_kwargs([{"role": "user", "content": "hi"}], tools=tools)
    assert kwargs["stream"] is True
    assert kwargs["stream_options"] == {"include_usage": True}
    assert kwargs["tools"] == tools
    # System message prepended.
    assert kwargs["messages"][0]["role"] == "system"
    assert kwargs["messages"][1]["role"] == "user"


def test_openai_adapter_build_kwargs_omits_tools_in_vision_mode():
    adapter = OpenAIAdapter(_openai_settings(), model_config=None, vision=True)
    tools = [{"type": "function", "function": {"name": "web_search", "parameters": {}}}]
    kwargs = adapter.build_kwargs([{"role": "user", "content": "hi"}], tools=tools)
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
    adapter.append_tool_results(kwargs, [("call_x", "ok")], with_synthesis_nudge=False)
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
