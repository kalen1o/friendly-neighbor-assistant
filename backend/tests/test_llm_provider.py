import logging
from unittest.mock import AsyncMock, patch

import pytest

from app.config import Settings


def _make_settings(provider: str = "anthropic") -> Settings:
    return Settings(
        ai_provider=provider,
        anthropic_api_key="sk-ant-test",
        openai_api_key="sk-test",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


@pytest.mark.anyio
async def test_get_llm_response_anthropic():
    settings = _make_settings("anthropic")
    messages = [{"role": "user", "content": "Hello"}]

    mock_response = AsyncMock()
    mock_response.content = [AsyncMock(text="Hi there!")]

    with patch("app.llm.provider.anthropic.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi there!"
        instance.messages.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_openai():
    settings = _make_settings("openai")
    messages = [{"role": "user", "content": "Hello"}]

    mock_choice = AsyncMock()
    mock_choice.message.content = "Hi from GPT!"
    mock_response = AsyncMock()
    mock_response.choices = [mock_choice]

    with patch("app.llm.provider.openai.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi from GPT!"
        instance.chat.completions.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_invalid_provider():
    settings = _make_settings("gemini")
    messages = [{"role": "user", "content": "Hello"}]

    from app.llm.provider import get_llm_response

    with pytest.raises(ValueError, match="Unsupported AI provider: gemini"):
        await get_llm_response(messages, settings)


# --- Tool-loop helpers ---


def test_tool_call_signature_dict_args_key_order_independent():
    from app.llm.provider import _tool_call_signature

    a = _tool_call_signature("web_search", {"query": "hi", "max_results": 3})
    b = _tool_call_signature("web_search", {"max_results": 3, "query": "hi"})
    assert a == b


def test_tool_call_signature_string_and_dict_match():
    from app.llm.provider import _tool_call_signature

    sig_dict = _tool_call_signature("web_search", {"query": "hi"})
    sig_str = _tool_call_signature("web_search", '{"query": "hi"}')
    assert sig_dict == sig_str


def test_tool_call_signature_distinguishes_args():
    from app.llm.provider import _tool_call_signature

    a = _tool_call_signature("web_search", {"query": "hello"})
    b = _tool_call_signature("web_search", {"query": "world"})
    assert a != b


def test_tool_call_signature_distinguishes_tool_name():
    from app.llm.provider import _tool_call_signature

    a = _tool_call_signature("web_search", {"q": "x"})
    b = _tool_call_signature("knowledge_base", {"q": "x"})
    assert a != b


def test_tool_call_signature_handles_malformed_json():
    from app.llm.provider import _tool_call_signature

    # Malformed string args should still produce a deterministic key, not raise.
    sig = _tool_call_signature("web_search", '{"query":')
    assert isinstance(sig, str)
    assert sig == _tool_call_signature("web_search", '{"query":')


def test_tool_call_signature_empty_args_normalize():
    from app.llm.provider import _tool_call_signature

    # Empty dict and empty string both mean "no args" — should match.
    assert _tool_call_signature("datetime_info", {}) == _tool_call_signature(
        "datetime_info", ""
    )


def test_truncate_tool_result_under_limit_unchanged():
    from app.llm.provider import _truncate_tool_result

    text = "hello world"
    assert _truncate_tool_result(text, 100) == text


def test_truncate_tool_result_at_limit_unchanged():
    from app.llm.provider import _truncate_tool_result

    text = "x" * 50
    assert _truncate_tool_result(text, 50) == text


def test_truncate_tool_result_over_limit_marks_omission():
    from app.llm.provider import _truncate_tool_result

    text = "a" * 1000
    out = _truncate_tool_result(text, 100)
    assert out.startswith("a" * 100)
    assert "[truncated, 900 chars omitted]" in out


def test_truncate_tool_result_zero_or_negative_limit_disables():
    from app.llm.provider import _truncate_tool_result

    assert _truncate_tool_result("abc", 0) == "abc"
    assert _truncate_tool_result("abc", -5) == "abc"


# --- OpenAI tool-loop behavior tests ---
#
# These drive the inner `_openai_stream_with_tools` generator with a fake
# streaming OpenAI client so we can verify per-round behavior end-to-end:
# JSON-parse-error feedback, per-tool timeout, and signature-based stuck
# detection.


class _FakeFunc:
    def __init__(self, name=None, arguments=None):
        self.name = name
        self.arguments = arguments


class _FakeToolCall:
    def __init__(self, index, id=None, name=None, arguments=None):
        self.index = index
        self.id = id
        self.function = _FakeFunc(name=name, arguments=arguments)


class _FakeDelta:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _FakeChoice:
    def __init__(self, delta, finish_reason=None):
        self.delta = delta
        self.finish_reason = finish_reason


class _FakeUsage:
    """OpenAI-style usage payload: chunk.usage on the final usage-only chunk."""

    def __init__(self, prompt_tokens=0, completion_tokens=0):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens


class _FakeChunk:
    def __init__(self, choice=None, usage=None):
        # Usage-only chunks (sent at the end when stream_options.include_usage
        # is set) have empty `choices` and a populated `usage` payload.
        self.choices = [choice] if choice is not None else []
        self.usage = usage


def _usage_chunk(prompt_tokens, completion_tokens):
    """Build an OpenAI usage-only chunk like the API emits at end of stream."""
    return _FakeChunk(usage=_FakeUsage(prompt_tokens, completion_tokens))


def _stream(chunks):
    """Build an async iterator that yields the given chunks once."""

    async def gen():
        for c in chunks:
            yield c

    return gen()


def _tool_call_round(call_id, name, arguments):
    """One round that emits a single tool call with finish_reason=tool_calls."""
    return [
        _FakeChunk(
            _FakeChoice(
                _FakeDelta(
                    tool_calls=[
                        _FakeToolCall(
                            index=0, id=call_id, name=name, arguments=arguments
                        )
                    ]
                ),
                finish_reason="tool_calls",
            )
        )
    ]


def _final_round(text):
    """One round that emits text and finish_reason=stop."""
    return [_FakeChunk(_FakeChoice(_FakeDelta(content=text), finish_reason="stop"))]


def _patch_openai_streams(streams):
    """Patch the OpenAI client constructor so each create() returns the next stream.

    Returns an empty stream for any extra calls (the loop fires a trailing
    no-tools call after exiting; we don't want tests to fail on that). Also
    clears the module-level client cache so the patched constructor is
    actually consumed.
    """
    from unittest.mock import AsyncMock, patch

    from app.llm import provider as _provider

    _provider._openai_clients.clear()

    pending = list(streams)

    def next_stream(*args, **kwargs):
        if pending:
            return _stream(pending.pop(0))
        return _stream([])

    create = AsyncMock(side_effect=next_stream)
    cm = patch("app.llm.provider.openai.AsyncOpenAI")
    MockClient = cm.start()
    MockClient.return_value.chat.completions.create = create
    return cm, create


def _stop_patch(cm):
    cm.stop()


def _openai_settings():
    return Settings(
        ai_provider="openai",
        openai_api_key=f"sk-test-{id(object())}",  # unique to dodge any cache
        openai_model="gpt-4o-mini",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


@pytest.mark.anyio
async def test_openai_loop_invalid_json_args_skips_tool_and_feeds_error_back():
    """Bad JSON in tool_call.arguments must NOT silently call the tool with {}.

    The tool result fed to the next round should describe the parse failure
    so the model can retry with valid JSON.
    """
    from app.llm.provider import _openai_stream_with_tools

    streams = [
        _tool_call_round("call_x", "web_search", "{not valid json"),
        _final_round("done"),
    ]
    cm, create = _patch_openai_streams(streams)
    try:
        tool_executor = AsyncMock()
        chunks = []
        async for chunk in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=tool_executor,
        ):
            chunks.append(chunk)

        # Tool was never executed because args couldn't be parsed.
        tool_executor.assert_not_called()

        # The second round must have received a 'tool' message containing the
        # parse-error string so the model can react.
        second_call_messages = create.call_args_list[1].kwargs["messages"]
        tool_msgs = [m for m in second_call_messages if m.get("role") == "tool"]
        assert tool_msgs, "expected a tool result message in round 2"
        assert "invalid JSON" in tool_msgs[-1]["content"]

        assert "".join(chunks).strip().endswith("done")
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_openai_loop_per_tool_timeout_returns_timeout_message():
    """A slow tool must time out and surface a clear error to the model."""
    import asyncio as _asyncio

    from app.llm.provider import _openai_stream_with_tools

    streams = [
        _tool_call_round("call_t", "web_search", '{"query":"x"}'),
        _final_round("ok"),
    ]
    cm, create = _patch_openai_streams(streams)
    try:

        async def slow_tool(name, args):
            await _asyncio.sleep(5)
            return "should not reach"

        settings = _openai_settings()
        settings.tool_call_timeout_s = 1  # snug enough to fire fast in tests

        chunks = []
        async for chunk in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=settings,
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=slow_tool,
        ):
            chunks.append(chunk)

        second_call_messages = create.call_args_list[1].kwargs["messages"]
        tool_msgs = [m for m in second_call_messages if m.get("role") == "tool"]
        assert tool_msgs
        assert "timed out" in tool_msgs[-1]["content"]
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_openai_loop_clean_stop_does_not_trigger_extra_call():
    """A normal stop response must not fire the trailing no-tools call.

    Used to: every response paid for an extra LLM call after the model said
    'stop'. Now it should only fire when we're empty-handed.
    """
    from app.llm.provider import _openai_stream_with_tools

    streams = [_final_round("hello")]
    cm, create = _patch_openai_streams(streams)
    try:
        chunks = []
        async for chunk in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=None,
            tool_executor=None,
        ):
            chunks.append(chunk)

        assert "".join(chunks) == "hello"
        # Exactly one create() call for the round that produced the response.
        assert create.call_count == 1
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_openai_loop_repeated_tool_calls_trigger_synthesis_nudge():
    """When the same (tool, args) repeats across rounds, strip tools and nudge."""
    from app.llm.provider import _SYNTHESIS_NUDGE, _openai_stream_with_tools

    # Round 0: call web_search("x")
    # Round 1: call web_search("x") again — should be flagged as stuck
    # Round 2: model must produce a final answer (we make it emit text)
    streams = [
        _tool_call_round("call_a", "web_search", '{"query":"x"}'),
        _tool_call_round("call_b", "web_search", '{"query":"x"}'),
        _final_round("answer"),
    ]
    cm, create = _patch_openai_streams(streams)
    try:

        async def fake_tool(name, args):
            return "result"

        chunks = []
        async for chunk in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=fake_tool,
        ):
            chunks.append(chunk)

        # On the third LLM call, tools should be absent (stripped after the
        # repeat was detected) and the synthesis nudge should be present as
        # the most recent user-role message.
        third_kwargs = create.call_args_list[2].kwargs
        assert "tools" not in third_kwargs

        msgs = third_kwargs["messages"]
        nudge_msgs = [
            m
            for m in msgs
            if m.get("role") == "user" and m.get("content") == _SYNTHESIS_NUDGE
        ]
        assert nudge_msgs, "expected the synthesis nudge in round 3 messages"

        assert "".join(chunks).strip().endswith("answer")
    finally:
        _stop_patch(cm)


# --- Anthropic tool-loop behavior tests ---
#
# Anthropic's SDK exposes streaming via `client.messages.stream(**kwargs)`,
# which returns an async context manager whose entered object has a
# `text_stream` async iterator and a `get_final_message()` coroutine. The
# fake below mirrors that surface so we can drive `_anthropic_stream_with_tools`
# round by round.


class _FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _FakeToolUseBlock:
    def __init__(self, id, name, input):
        self.type = "tool_use"
        self.id = id
        self.name = name
        self.input = input


class _AnthroUsage:
    def __init__(self, input_tokens=0, output_tokens=0):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeFinalMessage:
    def __init__(self, blocks, usage=None):
        self.content = blocks
        self.usage = usage


class _FakeAnthropicStream:
    def __init__(self, text_chunks, blocks, usage=None):
        self._text_chunks = text_chunks
        self._final_message = _FakeFinalMessage(blocks, usage=usage)

    @property
    def text_stream(self):
        async def _iter():
            for t in self._text_chunks:
                yield t

        return _iter()

    async def get_final_message(self):
        return self._final_message


class _FakeAnthropicStreamContext:
    def __init__(self, stream):
        self._stream = stream

    async def __aenter__(self):
        return self._stream

    async def __aexit__(self, *args):
        return None


def _patch_anthropic_streams(stream_specs):
    """Patch the Anthropic client constructor to drive the loop round by round.

    `stream_specs` is a list of (text_chunks, blocks) tuples — one per round.
    Returns the patcher (for stop) and a list that captures the kwargs of
    each `client.messages.stream(...)` call so tests can assert what the
    loop sent on each round.
    """
    from unittest.mock import MagicMock, patch

    from app.llm import provider as _provider

    _provider._anthropic_clients.clear()

    pending = list(stream_specs)
    captured_kwargs = []

    def stream_factory(**kwargs):
        captured_kwargs.append({k: v for k, v in kwargs.items()})
        if pending:
            spec = pending.pop(0)
        else:
            spec = ([], [])
        # Each spec is (text_chunks, blocks) or (text_chunks, blocks, usage).
        text_chunks, blocks = spec[0], spec[1]
        usage = spec[2] if len(spec) > 2 else None
        # Deep-copy the messages list shape into the captured kwargs *before*
        # the loop mutates it further. The loop appends to kwargs["messages"]
        # in place, so without this snapshot every captured entry would point
        # at the same final list.
        captured_kwargs[-1]["messages"] = [
            (
                {**m, "content": list(m["content"])}
                if isinstance(m.get("content"), list)
                else dict(m)
            )
            for m in kwargs.get("messages", [])
        ]
        return _FakeAnthropicStreamContext(
            _FakeAnthropicStream(text_chunks, blocks, usage=usage)
        )

    cm = patch("app.llm.provider.anthropic.AsyncAnthropic")
    MockClient = cm.start()
    instance = MockClient.return_value
    instance.messages = MagicMock()
    instance.messages.stream = stream_factory
    return cm, captured_kwargs


def _anthropic_settings():
    return Settings(
        ai_provider="anthropic",
        anthropic_api_key=f"sk-ant-test-{id(object())}",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


@pytest.mark.anyio
async def test_anthropic_loop_clean_stop_returns_immediately():
    """Model that emits text and no tool_use must end the loop after round 1."""
    from app.llm.provider import _anthropic_stream_with_tools

    streams = [(["hello"], [])]  # text only, no tool_use blocks
    cm, captured = _patch_anthropic_streams(streams)
    try:
        chunks = []
        async for chunk in _anthropic_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_anthropic_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=AsyncMock(),
        ):
            chunks.append(chunk)

        assert "".join(chunks) == "hello"
        # No tool_use → loop returns; no trailing fallback call
        assert len(captured) == 1
    finally:
        cm.stop()


@pytest.mark.anyio
async def test_anthropic_loop_per_tool_timeout_returns_timeout_message():
    """A slow tool must time out and surface a clear error in the next round."""
    import asyncio as _asyncio

    from app.llm.provider import _anthropic_stream_with_tools

    streams = [
        ([], [_FakeToolUseBlock("call_t", "web_search", {"query": "x"})]),
        (["ok"], []),
    ]
    cm, captured = _patch_anthropic_streams(streams)
    try:

        async def slow_tool(name, args):
            await _asyncio.sleep(5)
            return "should not reach"

        settings = _anthropic_settings()
        settings.tool_call_timeout_s = 1

        chunks = []
        async for chunk in _anthropic_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=settings,
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=slow_tool,
        ):
            chunks.append(chunk)

        # Round 2 received a user message containing tool_result with timeout text
        second_round_msgs = captured[1]["messages"]
        last_user = next(
            m
            for m in reversed(second_round_msgs)
            if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        tool_results = [
            b
            for b in last_user["content"]
            if isinstance(b, dict) and b.get("type") == "tool_result"
        ]
        assert tool_results
        assert any("timed out" in str(b.get("content", "")) for b in tool_results)
    finally:
        cm.stop()


@pytest.mark.anyio
async def test_anthropic_loop_repeated_tool_calls_trigger_synthesis_nudge():
    """Same (tool, args) twice must strip tools and append nudge as a text block."""
    from app.llm.provider import _SYNTHESIS_NUDGE, _anthropic_stream_with_tools

    streams = [
        ([], [_FakeToolUseBlock("call_a", "web_search", {"query": "x"})]),
        ([], [_FakeToolUseBlock("call_b", "web_search", {"query": "x"})]),
        (["answer"], []),
    ]
    cm, captured = _patch_anthropic_streams(streams)
    try:

        async def fake_tool(name, args):
            return "result"

        chunks = []
        async for chunk in _anthropic_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_anthropic_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=fake_tool,
        ):
            chunks.append(chunk)

        # Third call must have no tools and the prior user message must
        # carry a text block whose .text is the synthesis nudge.
        third_kwargs = captured[2]
        assert "tools" not in third_kwargs

        last_user = next(
            m
            for m in reversed(third_kwargs["messages"])
            if m.get("role") == "user" and isinstance(m.get("content"), list)
        )
        text_blocks = [
            b
            for b in last_user["content"]
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        assert any(b.get("text") == _SYNTHESIS_NUDGE for b in text_blocks), (
            "expected the synthesis nudge as a text block alongside tool_result"
        )

        assert "answer" in "".join(chunks)
    finally:
        cm.stop()


# --- Tool-loop telemetry tests ---


def _telemetry_record(caplog):
    """Find the structured 'tool_loop done' log record."""
    records = [r for r in caplog.records if r.message == "tool_loop done"]
    assert len(records) == 1, f"expected exactly one telemetry log, got {len(records)}"
    return records[0]


@pytest.mark.anyio
async def test_openai_loop_telemetry_clean_stop(caplog):
    """A clean-stop response logs zero tools, one round, finished_normally=True."""
    from app.llm.provider import _openai_stream_with_tools

    streams = [_final_round("hello")]
    cm, _ = _patch_openai_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:
        async for _ in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=None,
            tool_executor=None,
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.provider == "openai"
        assert record.rounds_used == 1
        assert record.tools_called == 0
        assert record.unique_tools == 0
        assert record.timeouts == 0
        assert record.truncations == 0
        assert record.stuck_triggered is False
        assert record.synthesis_fallback is False
        assert record.finished_normally is True
        assert record.max_rounds_hit is False
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_openai_loop_telemetry_stuck_and_timeout(caplog):
    """Telemetry records stuck_triggered=True and counts timeouts."""
    import asyncio as _asyncio

    from app.llm.provider import _openai_stream_with_tools

    # Both rounds call web_search("x") — round 2 trips the stuck gate.
    streams = [
        _tool_call_round("call_1", "web_search", '{"query":"x"}'),
        _tool_call_round("call_2", "web_search", '{"query":"x"}'),
        _final_round("ok"),
    ]
    cm, _ = _patch_openai_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:

        async def slow_tool(name, args):
            # Time out on every call so we count 2 timeouts across 2 rounds.
            await _asyncio.sleep(2)
            return "never"

        settings = _openai_settings()
        settings.tool_call_timeout_s = 1

        async for _ in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=settings,
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=slow_tool,
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.tools_called == 2
        assert record.unique_tools == 1
        assert record.timeouts == 2
        assert record.stuck_triggered is True
        assert record.finished_normally is True  # round 3 emitted text
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_anthropic_loop_telemetry_clean_stop(caplog):
    """Anthropic clean stop emits provider=anthropic with the right counts."""
    from app.llm.provider import _anthropic_stream_with_tools

    streams = [(["hello"], [])]
    cm, _ = _patch_anthropic_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:
        async for _ in _anthropic_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_anthropic_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=AsyncMock(),
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.provider == "anthropic"
        assert record.rounds_used == 1
        assert record.tools_called == 0
        assert record.synthesis_fallback is False
        assert record.finished_normally is True
    finally:
        cm.stop()


@pytest.mark.anyio
async def test_openai_loop_telemetry_includes_token_usage(caplog):
    """When the server emits a usage chunk, telemetry records token counts."""
    from app.llm.provider import _openai_stream_with_tools

    # Round 1: text + a final usage-only chunk (the shape OpenAI returns
    # when stream_options.include_usage is set).
    streams = [
        [
            _FakeChunk(_FakeChoice(_FakeDelta(content="hi"), finish_reason="stop")),
            _usage_chunk(prompt_tokens=42, completion_tokens=7),
        ]
    ]
    cm, _ = _patch_openai_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:
        async for _ in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=None,
            tool_executor=None,
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.prompt_tokens == 42
        assert record.completion_tokens == 7
        assert record.total_tokens == 49
    finally:
        _stop_patch(cm)


@pytest.mark.anyio
async def test_anthropic_loop_telemetry_includes_token_usage(caplog):
    """Anthropic usage from get_final_message().usage flows into telemetry."""
    from app.llm.provider import _anthropic_stream_with_tools

    streams = [(["hello"], [], _AnthroUsage(input_tokens=15, output_tokens=4))]
    cm, _ = _patch_anthropic_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:
        async for _ in _anthropic_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_anthropic_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=AsyncMock(),
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.prompt_tokens == 15
        assert record.completion_tokens == 4
        assert record.total_tokens == 19
    finally:
        cm.stop()


# --- Per-tool latency telemetry ---


def test_summarize_tool_timings_empty_returns_zeros():
    from app.llm.provider import _summarize_tool_timings

    assert _summarize_tool_timings([]) == ("", 0.0, 0.0)


def test_summarize_tool_timings_picks_slowest_and_sums():
    from app.llm.provider import _summarize_tool_timings

    timings = [("web_search", 12.5), ("calculate", 4.0), ("web_search", 30.0)]
    name, slowest, total = _summarize_tool_timings(timings)
    assert name == "web_search"
    assert slowest == 30.0
    assert total == 46.5


@pytest.mark.anyio
async def test_openai_loop_telemetry_records_tool_latency(caplog):
    """A slow-ish tool surfaces as slowest_tool_name + slowest_tool_ms."""
    import asyncio as _asyncio

    from app.llm.provider import _openai_stream_with_tools

    streams = [
        _tool_call_round("call_1", "web_search", '{"query":"x"}'),
        _final_round("ok"),
    ]
    cm, _ = _patch_openai_streams(streams)
    caplog.set_level(logging.INFO, logger="app.llm.provider")
    try:

        async def slow_ish_tool(name, args):
            await _asyncio.sleep(0.05)  # ~50ms — well under the 60s timeout
            return "result"

        async for _ in _openai_stream_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            settings=_openai_settings(),
            tools=[
                {
                    "type": "function",
                    "function": {"name": "web_search", "parameters": {}},
                }
            ],
            tool_executor=slow_ish_tool,
        ):
            pass

        record = _telemetry_record(caplog)
        assert record.slowest_tool_name == "web_search"
        # Floor at 40ms to allow a little jitter; ceiling well above 50ms in
        # case CI is slow.
        assert 40.0 <= record.slowest_tool_ms <= 5000.0
        # Single tool call → total equals slowest.
        assert record.total_tool_ms == record.slowest_tool_ms
    finally:
        _stop_patch(cm)
