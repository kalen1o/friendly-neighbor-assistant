import datetime
import logging
import math
import re
from typing import Any, Dict

from app.agent.tools import (
    tool_search_knowledge_base,
    tool_search_web,
    _fetch_page_content,
)
from app.config import Settings

logger = logging.getLogger(__name__)


async def execute_web_search(
    query: str, db, settings: Settings, max_results: int = 3, **kwargs
) -> Dict[str, Any]:
    """Execute web search skill."""
    results = await tool_search_web(query, max_results=max_results)
    if not results:
        return {"content": "No web results found.", "sources": []}

    content_parts = []
    for r in results:
        text = r.get("content", r.get("snippet", ""))
        content_parts.append(f"[{r['title']}]({r['url']}): {text}")

    return {
        "content": "\n\n".join(content_parts),
        "sources": results,
    }


async def execute_knowledge_base(
    query: str, db, settings: Settings, top_k: int = 5, **kwargs
) -> Dict[str, Any]:
    """Execute knowledge base search skill with numbered citations."""
    results = await tool_search_knowledge_base(query, db, settings, top_k=top_k)
    if not results:
        return {"content": "No relevant documents found.", "sources": []}

    content_parts = []
    sources = []
    for i, r in enumerate(results, 1):
        content_parts.append("[{}] [{}]: {}".format(i, r["filename"], r["text"]))
        sources.append(
            {
                **r,
                "citation_index": i,
                "chunk_excerpt": r["text"][:150],
            }
        )

    return {
        "content": "\n\n".join(content_parts),
        "sources": sources,
    }


async def execute_web_reader(
    url: str = "", query: str = "", **kwargs
) -> Dict[str, Any]:
    """Fetch and extract content from a URL."""
    # Accept both 'url' (new) and 'query' (backward compat) parameters
    target_url = url or query
    if not target_url:
        return {"content": "No URL provided", "sources": []}
    content = await _fetch_page_content(target_url, timeout=10.0)
    if not content:
        return {
            "content": "Failed to fetch content from {}".format(target_url),
            "sources": [],
        }
    return {
        "content": content,
        "sources": [
            {
                "type": "web",
                "title": target_url,
                "url": target_url,
                "snippet": content[:200],
            }
        ],
    }


async def execute_datetime_info(
    timezone: str = "UTC", query: str = "", **kwargs
) -> Dict[str, Any]:
    """Get current date/time information."""
    try:
        import zoneinfo

        zone = zoneinfo.ZoneInfo(timezone)
        now = datetime.datetime.now(zone)
    except Exception:
        now = datetime.datetime.utcnow()
        timezone = "UTC"

    content = (
        f"Current date and time ({timezone}):\n"
        f"- Date: {now.strftime('%A, %B %d, %Y')}\n"
        f"- Time: {now.strftime('%I:%M %p')}\n"
        f"- ISO: {now.isoformat()}\n"
        f"- Unix timestamp: {int(now.timestamp())}"
    )
    return {"content": content, "sources": []}


async def execute_calculate(
    expression: str = "", query: str = "", **kwargs
) -> Dict[str, Any]:
    """Safely evaluate a math expression."""
    # Accept both 'expression' (new) and 'query' (backward compat)
    expr = expression or query
    # Whitelist safe functions
    safe_names = {
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "len": len,
        "int": int,
        "float": float,
        "pow": pow,
        "sqrt": math.sqrt,
        "log": math.log,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "pi": math.pi,
        "e": math.e,
    }  # type: Dict[str, Any]
    try:
        # Remove anything that's not math-related
        clean = re.sub(r"[^\d\s\+\-\*/\.\(\)\,\%\^]", "", expr.replace("^", "**"))
        result = eval(clean, {"__builtins__": {}}, safe_names)
        return {"content": "{} = {}".format(expr, result), "sources": []}
    except Exception as e:
        return {
            "content": "Could not calculate: {}. Error: {}".format(expr, str(e)),
            "sources": [],
        }


async def execute_summarize(
    text: str = "",
    query: str = "",
    settings: Settings = None,
    style: str = "brief",
    **kwargs,
) -> Dict[str, Any]:
    """Summarize text using LLM."""
    from app.llm.provider import get_llm_response

    content = text or query

    style_instructions = {
        "brief": "Summarize in 1-2 sentences.",
        "detailed": "Summarize as bullet points covering all key information.",
        "executive": "Provide 3-5 key takeaways for a busy executive.",
    }
    instruction = style_instructions.get(style, style_instructions["brief"])

    messages = [
        {
            "role": "user",
            "content": "{}\n\nText:\n{}".format(instruction, content[:4000]),
        }
    ]
    summary = await get_llm_response(messages, settings)
    return {"content": summary, "sources": []}


def register_all_executors(registry) -> None:
    """Register all built-in skill executors with the registry."""
    registry.register_executor("web_search", execute_web_search)
    registry.register_executor("knowledge_base", execute_knowledge_base)
    registry.register_executor("web_reader", execute_web_reader)
    registry.register_executor("datetime_info", execute_datetime_info)
    registry.register_executor("calculate", execute_calculate)
    registry.register_executor("summarize", execute_summarize)
    # Knowledge skills (coding_assistant, writing_assistant) don't need executors
    # -- they modify the system prompt, not run code

    # Register workflow executors for any workflow-type skills
    for skill in registry.all_skills():
        if skill.skill_type == "workflow":
            steps = skill.get_workflow_steps()
            if steps:

                async def _workflow_exec(
                    query: str,
                    db=None,
                    settings: Settings = None,
                    _steps=steps,
                    on_progress=None,
                    **kwargs,
                ) -> Dict[str, Any]:
                    from app.workflows.engine import execute_workflow

                    result = await execute_workflow(
                        _steps, query, settings, on_progress=on_progress
                    )
                    step_summary = "\n".join(
                        "- {}: {}".format(s["name"], s["status"])
                        for s in result["steps"]
                    )
                    output = result["output"]
                    if result["status"] == "failed":
                        output = "Workflow failed:\n{}\n\n{}".format(
                            step_summary, output
                        )
                    return {"content": output, "sources": []}

                registry.register_executor(skill.name, _workflow_exec)
