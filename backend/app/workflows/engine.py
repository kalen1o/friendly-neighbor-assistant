import asyncio
import logging
from typing import Any, Dict, List, Optional

from app.config import Settings
from app.llm.provider import get_llm_response
from app.llm.model_config import ModelConfig

logger = logging.getLogger(__name__)

MAX_RETRIES = 1


class StepResult:
    def __init__(
        self, name: str, output: str = "", status: str = "pending", error: str = ""
    ):
        self.name = name
        self.output = output
        self.status = status  # pending, running, completed, failed, skipped
        self.error = error


def parse_steps(steps_raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Parse and validate workflow step definitions."""
    steps = []
    for s in steps_raw:
        step = {
            "name": s.get("name", ""),
            "prompt": s.get("prompt", ""),
            "input": s.get("input"),  # str or list of str
            "parallel": s.get("parallel"),  # str or list of str — run alongside these
            "model": s.get("model"),  # optional "provider:model_id"
        }
        if not step["name"] or not step["prompt"]:
            raise ValueError("Each workflow step must have 'name' and 'prompt'")
        # Normalize input to list
        if isinstance(step["input"], str):
            step["input"] = [step["input"]]
        elif step["input"] is None:
            step["input"] = []
        # Normalize parallel to list
        if isinstance(step["parallel"], str):
            step["parallel"] = [step["parallel"]]
        elif step["parallel"] is None:
            step["parallel"] = []
        steps.append(step)
    return steps


def _build_execution_groups(steps: List[Dict[str, Any]]) -> List[List[str]]:
    """Build execution groups — steps in the same group run in parallel."""
    step_map = {s["name"]: s for s in steps}
    assigned = set()  # type: set
    groups = []  # type: List[List[str]]

    for step in steps:
        name = step["name"]
        if name in assigned:
            continue

        # Collect this step + any steps it should run parallel with
        group = [name]
        assigned.add(name)
        for p in step["parallel"]:
            if p in step_map and p not in assigned:
                group.append(p)
                assigned.add(p)
        # Also check if other steps declare parallel with this one
        for other in steps:
            if name in other["parallel"] and other["name"] not in assigned:
                group.append(other["name"])
                assigned.add(other["name"])

        groups.append(group)

    return groups


async def _run_step(
    step: Dict[str, Any],
    results: Dict[str, StepResult],
    user_message: str,
    settings: Settings,
) -> StepResult:
    """Execute a single workflow step with retry."""
    name = step["name"]
    prompt_template = step["prompt"]

    # Build input context from referenced steps
    if step["input"]:
        input_parts = []
        for dep_name in step["input"]:
            dep = results.get(dep_name)
            if dep and dep.status == "completed":
                input_parts.append("[{}]:\n{}".format(dep_name, dep.output))
        context = "\n\n".join(input_parts) if input_parts else user_message
    else:
        context = user_message

    full_prompt = "{}\n\n---\nInput:\n{}".format(prompt_template, context)
    messages = [{"role": "user", "content": full_prompt}]

    # Resolve model config if specified
    model_config = None
    if step.get("model") and ":" in step["model"]:
        provider, model_id = step["model"].split(":", 1)
        base_url = None
        if "@" in model_id:
            model_id, base_url = model_id.rsplit("@", 1)
        if provider == "anthropic":
            api_key = settings.anthropic_api_key
        else:
            api_key = settings.openai_api_key
            if not base_url and settings.openai_base_url:
                base_url = settings.openai_base_url
        model_config = ModelConfig(
            provider=provider,
            model_id=model_id,
            api_key=api_key,
            base_url=base_url,
        )

    # Execute with retry
    last_error = ""
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = await get_llm_response(
                messages, settings, model_config=model_config
            )
            logger.info("Workflow step '%s' completed (attempt %d)", name, attempt + 1)
            return StepResult(name=name, output=response, status="completed")
        except Exception as e:
            last_error = str(e)
            if attempt < MAX_RETRIES:
                logger.warning(
                    "Workflow step '%s' failed (attempt %d), retrying: %s",
                    name,
                    attempt + 1,
                    e,
                )
                await asyncio.sleep(1)
            else:
                logger.error(
                    "Workflow step '%s' failed after %d attempts: %s",
                    name,
                    MAX_RETRIES + 1,
                    e,
                )

    return StepResult(name=name, status="failed", error=last_error)


async def execute_workflow(
    steps_raw: List[Dict[str, Any]],
    user_message: str,
    settings: Settings,
    on_progress: Optional[Any] = None,
) -> Dict[str, Any]:
    """Execute a workflow — returns final output and step results.

    Args:
        on_progress: optional async callback(message: str) for progress updates

    Returns:
        {
            "output": str (final step output or combined output),
            "steps": [{"name": str, "status": str, "output": str, "error": str}],
            "status": "completed" | "failed",
        }
    """
    steps = parse_steps(steps_raw)
    step_map = {s["name"]: s for s in steps}
    groups = _build_execution_groups(steps)
    completed_count = 0
    results = {}  # type: Dict[str, StepResult]

    async def _notify(msg: str) -> None:
        if on_progress:
            try:
                await on_progress(msg)
            except Exception:
                pass

    # Send all step names upfront so UI can render the full list
    import json as _json

    parallel_names = set()
    for s in steps:
        for p in s["parallel"]:
            parallel_names.add(p)
            parallel_names.add(s["name"])
    step_info = []
    for s in steps:
        info = {"name": s["name"], "status": "pending"}
        if s["name"] in parallel_names:
            info["parallel"] = True
        step_info.append(info)
    await _notify("__workflow__" + _json.dumps({"steps": step_info}))

    for group in groups:
        # Check all dependencies are met
        for name in group:
            step = step_map[name]
            for dep in step["input"]:
                dep_result = results.get(dep)
                if dep_result and dep_result.status == "failed":
                    # Dependency failed — stop workflow
                    return {
                        "output": "Workflow stopped: step '{}' failed — {}".format(
                            dep, dep_result.error
                        ),
                        "steps": [
                            {
                                "name": r.name,
                                "status": r.status,
                                "output": r.output,
                                "error": r.error,
                            }
                            for r in results.values()
                        ],
                        "status": "failed",
                    }

        # Run group steps
        if len(group) == 1:
            name = group[0]
            completed_count += 1
            await _notify("__step__" + _json.dumps({"name": name, "status": "running"}))
            result = await _run_step(step_map[name], results, user_message, settings)
            results[name] = result
            await _notify(
                "__step__" + _json.dumps({"name": name, "status": result.status})
            )
            if result.status == "failed":
                return {
                    "output": "Workflow stopped: step '{}' failed — {}".format(
                        name, result.error
                    ),
                    "steps": [
                        {
                            "name": r.name,
                            "status": r.status,
                            "output": r.output,
                            "error": r.error,
                        }
                        for r in results.values()
                    ],
                    "status": "failed",
                }
        else:
            # Parallel execution
            completed_count += len(group)
            for name in group:
                await _notify(
                    "__step__" + _json.dumps({"name": name, "status": "running"})
                )
            tasks = [
                _run_step(step_map[name], results, user_message, settings)
                for name in group
            ]
            group_results = await asyncio.gather(*tasks)
            for result in group_results:
                results[result.name] = result
                await _notify(
                    "__step__"
                    + _json.dumps({"name": result.name, "status": result.status})
                )
                if result.status == "failed":
                    return {
                        "output": "Workflow stopped: step '{}' failed — {}".format(
                            result.name, result.error
                        ),
                        "steps": [
                            {
                                "name": r.name,
                                "status": r.status,
                                "output": r.output,
                                "error": r.error,
                            }
                            for r in results.values()
                        ],
                        "status": "failed",
                    }

    # Final output is the last step's output
    last_step_name = steps[-1]["name"]
    final_output = results[last_step_name].output if last_step_name in results else ""

    return {
        "output": final_output,
        "steps": [
            {"name": r.name, "status": r.status, "output": r.output, "error": r.error}
            for r in results.values()
        ],
        "status": "completed",
    }
