"""Tests for tool definition building."""

from app.agent.agent import build_tool_definitions
from app.skills.registry import SkillDefinition, SkillRegistry


def _registry(names):
    registry = SkillRegistry()
    for name in names:
        registry._skills[name] = SkillDefinition(
            name=name,
            description=name,
            skill_type="tool",
            content="",
            enabled=True,
        )
    return registry


def test_tool_definitions_are_sorted_regardless_of_load_order():
    # Tools sit at the front of the prompt cache prefix, so their order must
    # not depend on DB row order.
    a = build_tool_definitions(_registry(["web_search", "calculate", "mcp_x"]))
    b = build_tool_definitions(_registry(["mcp_x", "web_search", "calculate"]))

    names = [t["function"]["name"] for t in a]
    assert names == ["calculate", "mcp_x", "web_search"]
    assert a == b
