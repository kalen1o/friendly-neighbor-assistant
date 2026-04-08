import datetime
import logging
import math
import re
from typing import Any, Dict, List, Optional

from app.agent.tools import tool_search_knowledge_base, tool_search_web, _fetch_page_content
from app.config import Settings

logger = logging.getLogger(__name__)


async def execute_web_search(query: str, db, settings: Settings, **kwargs) -> Dict[str, Any]:
    """Execute web search skill."""
    max_results = kwargs.get("max_results", 3)
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


async def execute_knowledge_base(query: str, db, settings: Settings, **kwargs) -> Dict[str, Any]:
    """Execute knowledge base search skill."""
    top_k = kwargs.get("top_k", 5)
    results = await tool_search_knowledge_base(query, db, settings, top_k=top_k)
    if not results:
        return {"content": "No relevant documents found.", "sources": []}

    content_parts = []
    for r in results:
        content_parts.append(f"[{r['filename']}]: {r['text']}")

    return {
        "content": "\n\n".join(content_parts),
        "sources": results,
    }


async def execute_web_reader(url: str, **kwargs) -> Dict[str, Any]:
    """Fetch and extract content from a URL."""
    content = await _fetch_page_content(url, timeout=10.0)
    if not content:
        return {"content": f"Failed to fetch content from {url}", "sources": []}

    return {
        "content": content,
        "sources": [{"type": "web", "title": url, "url": url, "snippet": content[:200]}],
    }


async def execute_datetime_info(timezone: str = "UTC", **kwargs) -> Dict[str, Any]:
    """Get current date/time information."""
    try:
        from datetime import timezone as tz
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


async def execute_calculate(expression: str, **kwargs) -> Dict[str, Any]:
    """Safely evaluate a math expression."""
    # Whitelist safe functions
    safe_names = {
        "abs": abs, "round": round, "min": min, "max": max,
        "sum": sum, "len": len, "int": int, "float": float,
        "pow": pow, "sqrt": math.sqrt, "log": math.log,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }  # type: Dict[str, Any]
    try:
        # Remove anything that's not math-related
        clean = re.sub(r'[^\d\s\+\-\*/\.\(\)\,\%\^]', '', expression.replace('^', '**'))
        result = eval(clean, {"__builtins__": {}}, safe_names)
        return {"content": f"{expression} = {result}", "sources": []}
    except Exception as e:
        return {"content": f"Could not calculate: {expression}. Error: {str(e)}", "sources": []}


async def execute_summarize(text: str, settings: Settings, style: str = "brief", **kwargs) -> Dict[str, Any]:
    """Summarize text using LLM."""
    from app.llm.provider import get_llm_response

    style_instructions = {
        "brief": "Summarize in 1-2 sentences.",
        "detailed": "Summarize as bullet points covering all key information.",
        "executive": "Provide 3-5 key takeaways for a busy executive.",
    }
    instruction = style_instructions.get(style, style_instructions["brief"])

    messages = [{"role": "user", "content": f"{instruction}\n\nText:\n{text[:4000]}"}]
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
    # Workflow skills (summarize_all_docs) use a combination of other executors
