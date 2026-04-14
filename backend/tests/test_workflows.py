import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.workflows.engine import parse_steps, _build_execution_groups, execute_workflow, StepResult


def test_parse_steps_basic():
    steps = parse_steps([
        {"name": "step1", "prompt": "Do thing 1"},
        {"name": "step2", "prompt": "Do thing 2", "input": "step1"},
    ])
    assert len(steps) == 2
    assert steps[0]["name"] == "step1"
    assert steps[0]["input"] == []
    assert steps[1]["input"] == ["step1"]


def test_parse_steps_normalizes_input():
    steps = parse_steps([
        {"name": "a", "prompt": "p"},
        {"name": "b", "prompt": "p", "input": "a"},
        {"name": "c", "prompt": "p", "input": ["a", "b"]},
    ])
    assert steps[1]["input"] == ["a"]
    assert steps[2]["input"] == ["a", "b"]


def test_parse_steps_validates():
    with pytest.raises(ValueError):
        parse_steps([{"name": "", "prompt": "test"}])
    with pytest.raises(ValueError):
        parse_steps([{"name": "test", "prompt": ""}])


def test_build_execution_groups_sequential():
    steps = parse_steps([
        {"name": "a", "prompt": "p"},
        {"name": "b", "prompt": "p", "input": "a"},
        {"name": "c", "prompt": "p", "input": "b"},
    ])
    groups = _build_execution_groups(steps)
    assert groups == [["a"], ["b"], ["c"]]


def test_build_execution_groups_parallel():
    steps = parse_steps([
        {"name": "a", "prompt": "p"},
        {"name": "b", "prompt": "p", "input": "a", "parallel": "c"},
        {"name": "c", "prompt": "p", "input": "a"},
        {"name": "d", "prompt": "p", "input": ["b", "c"]},
    ])
    groups = _build_execution_groups(steps)
    assert groups[0] == ["a"]
    assert set(groups[1]) == {"b", "c"}
    assert groups[2] == ["d"]


@pytest.mark.anyio
async def test_execute_workflow_sequential():
    mock_settings = MagicMock()
    mock_settings.anthropic_api_key = ""
    mock_settings.openai_api_key = ""
    mock_settings.openai_base_url = ""

    with patch("app.workflows.engine.get_llm_response", new_callable=AsyncMock) as mock_llm:
        mock_llm.side_effect = ["Key points: A, B, C", "Final report with A, B, C"]

        result = await execute_workflow(
            [
                {"name": "extract", "prompt": "Extract key points"},
                {"name": "format", "prompt": "Format as report", "input": "extract"},
            ],
            "Some long text here",
            mock_settings,
        )

    assert result["status"] == "completed"
    assert result["output"] == "Final report with A, B, C"
    assert len(result["steps"]) == 2
    assert all(s["status"] == "completed" for s in result["steps"])
    assert mock_llm.call_count == 2


@pytest.mark.anyio
async def test_execute_workflow_parallel():
    mock_settings = MagicMock()

    with patch("app.workflows.engine.get_llm_response", new_callable=AsyncMock) as mock_llm:
        mock_llm.side_effect = ["Key points", "Vietnamese translation", "Japanese translation", "Combined report"]

        result = await execute_workflow(
            [
                {"name": "extract", "prompt": "Extract"},
                {"name": "vi", "prompt": "Translate to Vietnamese", "input": "extract", "parallel": "ja"},
                {"name": "ja", "prompt": "Translate to Japanese", "input": "extract"},
                {"name": "combine", "prompt": "Combine", "input": ["vi", "ja"]},
            ],
            "Input text",
            mock_settings,
        )

    assert result["status"] == "completed"
    assert result["output"] == "Combined report"
    assert len(result["steps"]) == 4
    assert mock_llm.call_count == 4


@pytest.mark.anyio
async def test_execute_workflow_retry_then_stop():
    mock_settings = MagicMock()

    with patch("app.workflows.engine.get_llm_response", new_callable=AsyncMock) as mock_llm:
        mock_llm.side_effect = Exception("API error")

        result = await execute_workflow(
            [
                {"name": "step1", "prompt": "Do something"},
            ],
            "Input",
            mock_settings,
        )

    assert result["status"] == "failed"
    assert "failed" in result["output"]
    # Called twice: original + 1 retry
    assert mock_llm.call_count == 2


@pytest.mark.anyio
async def test_execute_workflow_stops_on_dependency_failure():
    mock_settings = MagicMock()

    with patch("app.workflows.engine.get_llm_response", new_callable=AsyncMock) as mock_llm:
        mock_llm.side_effect = [Exception("API error"), Exception("API error")]

        result = await execute_workflow(
            [
                {"name": "step1", "prompt": "Fail here"},
                {"name": "step2", "prompt": "Never runs", "input": "step1"},
            ],
            "Input",
            mock_settings,
        )

    assert result["status"] == "failed"
    assert len(result["steps"]) == 1  # step2 never started


def test_skill_definition_get_workflow_steps():
    from app.skills.registry import SkillDefinition
    skill = SkillDefinition(
        name="test_wf",
        description="test",
        skill_type="workflow",
        content='Some text\n\n```json\n{"steps": [{"name": "a", "prompt": "do A"}]}\n```',
    )
    steps = skill.get_workflow_steps()
    assert steps is not None
    assert len(steps) == 1
    assert steps[0]["name"] == "a"
