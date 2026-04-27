"""Driver-level tests using a fake adapter that satisfies the Protocol.

Bypasses any SDK so we can exercise the driver's logic — stuck detection,
JSON-error handling, max-rounds behavior, telemetry — without provider
mocks.
"""

import logging
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.llm.driver import (
    RoundEnd,
    RoundResult,
    ToolCall,
    ToolCallParseError,
    Usage,
    run_tool_loop,
)


def _settings() -> Settings:
    return Settings(
        ai_provider="openai",
        openai_api_key="sk-test",
        openai_model="gpt-4o-mini",
        database_url="postgresql+asyncpg://x:x@localhost/x",
        max_tool_rounds=5,
        tool_call_timeout_s=60,
        tool_result_max_chars=12000,
    )


class _FakeAdapter:
    """Minimal ProviderAdapter implementation for driver-level tests.

    Scripts a sequence of (text_chunks, tool_calls) per round. extract_args
    behavior is configurable per call.
    """

    provider_name = "fake"

    def __init__(
        self,
        rounds: list[tuple[list[str], list[ToolCall]]],
        extract_args=None,
    ):
        self._rounds = list(rounds)
        self._extract_args = extract_args
        self.append_tool_results_calls: list[tuple] = []  # captured for asserts

    def build_kwargs(self, messages, tools):
        return {"messages": list(messages), "tools": tools}

    async def stream_round(self, kwargs):
        if self._rounds:
            text_chunks, tool_calls = self._rounds.pop(0)
        else:
            text_chunks, tool_calls = [], []
        for t in text_chunks:
            yield t
        yield RoundEnd(
            result=RoundResult(tool_calls=tool_calls, usage=Usage(1, 1))
        )

    def append_assistant_turn(self, kwargs, round_result):
        kwargs["messages"].append({"role": "assistant", "content": "..."})

    def append_tool_results(self, kwargs, results, with_synthesis_nudge):
        self.append_tool_results_calls.append(
            (list(results), with_synthesis_nudge)
        )
        for tid, text in results:
            kwargs["messages"].append(
                {"role": "tool", "tool_call_id": tid, "content": text}
            )
        if with_synthesis_nudge:
            kwargs.pop("tools", None)

    def extract_tool_call_args(self, call: ToolCall):
        if self._extract_args is not None:
            return self._extract_args(call)
        return call.raw_args if isinstance(call.raw_args, dict) else {}


@pytest.mark.anyio
async def test_driver_runs_until_no_tool_calls_then_emits_telemetry(caplog):
    """Round 1 returns one tool call, round 2 returns none → loop exits cleanly."""
    adapter = _FakeAdapter(
        rounds=[
            ([], [ToolCall(id="t1", name="search", raw_args={"q": "x"})]),
            (["done"], []),
        ]
    )

    async def fake_executor(name, args):
        return "result"

    caplog.set_level(logging.INFO, logger="app.llm.driver")

    chunks = []
    async for chunk in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=fake_executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        chunks.append(chunk)

    assert "done" in "".join(chunks)

    records = [r for r in caplog.records if r.message == "tool_loop done"]
    assert len(records) == 1
    record = records[0]
    assert record.provider == "fake"
    assert record.rounds_used == 2
    assert record.tools_called == 1
    assert record.unique_tools == 1
    assert record.finished_normally is True
    assert record.stuck_triggered is False
    assert record.synthesis_fallback is False


@pytest.mark.anyio
async def test_driver_detects_stuck_and_strips_tools():
    """Same (tool, args) in rounds 0 and 1 → append_tool_results called with
    with_synthesis_nudge=True on the second tool round."""
    same_call = lambda i: ToolCall(id=f"t{i}", name="search", raw_args={"q": "x"})
    adapter = _FakeAdapter(
        rounds=[
            ([], [same_call(1)]),
            ([], [same_call(2)]),
            (["answer"], []),
        ]
    )

    async def fake_executor(name, args):
        return "result"

    chunks = []
    async for chunk in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=fake_executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        chunks.append(chunk)

    # Two append_tool_results calls happened (one per tool round).
    assert len(adapter.append_tool_results_calls) == 2
    # Round 0 was not stuck (first time we see this signature).
    assert adapter.append_tool_results_calls[0][1] is False
    # Round 1 was stuck (signature already seen).
    assert adapter.append_tool_results_calls[1][1] is True
    assert "answer" in "".join(chunks)


@pytest.mark.anyio
async def test_driver_skips_tool_executor_on_invalid_args():
    """When extract_tool_call_args returns ToolCallParseError, the tool is
    NOT executed and the result string describes the parse failure."""
    bad_call = ToolCall(id="t1", name="search", raw_args="{not valid json")
    adapter = _FakeAdapter(
        rounds=[
            ([], [bad_call]),
            (["recovered"], []),
        ],
        extract_args=lambda c: ToolCallParseError(
            raw_args="{not valid json", reason="Expecting property name"
        ),
    )

    executor = AsyncMock()

    async for _ in run_tool_loop(
        adapter,
        messages=[{"role": "user", "content": "hi"}],
        settings=_settings(),
        tools=[
            {"type": "function", "function": {"name": "search", "parameters": {}}}
        ],
        tool_executor=executor,
        on_tool_call=None,
        max_tool_rounds=5,
    ):
        pass

    executor.assert_not_called()
    # The tool result fed back into messages should describe the error.
    results_call = adapter.append_tool_results_calls[0]
    results, _stuck = results_call
    assert len(results) == 1
    tid, content = results[0]
    assert tid == "t1"
    assert "invalid JSON arguments" in content
