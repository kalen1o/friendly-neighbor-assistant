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
    results = await tool_search_web(
        query, max_results=max_results, cache=kwargs.get("fetch_cache")
    )
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
    content = await _fetch_page_content(
        target_url, timeout=10.0, cache=kwargs.get("fetch_cache")
    )
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


# --- Vietnamese lunar calendar ----------------------------------------------

# Can-Chi (Sexagenary cycle) — Vietnamese transliteration
_CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"]
_CHI = [
    "Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ",
    "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi",
]


def _can_chi_year(lunar_year: int) -> str:
    return "{} {}".format(
        _CAN[(lunar_year + 6) % 10],
        _CHI[(lunar_year + 8) % 12],
    )


_LUNAR_YEAR_MIN = 1900
_LUNAR_YEAR_MAX = 2199


async def execute_lunar_convert(
    direction: str = "today",
    year: int = 0,
    month: int = 0,
    day: int = 0,
    is_leap: bool = False,
    timezone: str = "Asia/Ho_Chi_Minh",
    **kwargs,
) -> Dict[str, Any]:
    """Deterministic Vietnamese lunar ↔ solar calendar conversion.

    Uses the `lunarcalendar` library, which implements the Ho Ngoc Duc
    algorithm — the same math used by VN government and major calendar sites.
    """
    try:
        from lunarcalendar import Converter, Solar, Lunar
        from lunarcalendar.converter import DateNotExist
    except ImportError as e:
        return {
            "content": "Lunar calendar library unavailable: {}".format(e),
            "sources": [],
        }

    def _fmt_result(solar, lunar, direction_used: str) -> Dict[str, Any]:
        import datetime as _dt

        try:
            weekday = _dt.date(solar.year, solar.month, solar.day).strftime("%A")
        except Exception:
            weekday = ""
        lunar_label = "{:02d}/{:02d}/{} âm lịch{}".format(
            lunar.day,
            lunar.month,
            lunar.year,
            " (tháng nhuận)" if lunar.isleap else "",
        )
        solar_label = "{:02d}/{:02d}/{} dương lịch".format(
            solar.day, solar.month, solar.year
        )
        summary = "{} = {} (năm {}, {})".format(
            solar_label, lunar_label, _can_chi_year(lunar.year), weekday
        )
        return {
            "content": summary,
            "sources": [
                {
                    "type": "calendar",
                    "title": "Vietnamese lunar calendar conversion",
                    "solar": {
                        "year": solar.year,
                        "month": solar.month,
                        "day": solar.day,
                    },
                    "lunar": {
                        "year": lunar.year,
                        "month": lunar.month,
                        "day": lunar.day,
                        "is_leap_month": bool(lunar.isleap),
                    },
                    "can_chi_year": _can_chi_year(lunar.year),
                    "weekday": weekday,
                    "direction": direction_used,
                }
            ],
        }

    direction = (direction or "today").strip().lower()

    if direction == "today":
        import datetime as _dt

        try:
            import zoneinfo

            now = _dt.datetime.now(zoneinfo.ZoneInfo(timezone))
        except Exception:
            now = _dt.datetime.now()
            timezone = "UTC"
        solar = Solar(now.year, now.month, now.day)
        lunar = Converter.Solar2Lunar(solar)
        return _fmt_result(solar, lunar, "today")

    if direction == "solar_to_lunar":
        if not (1900 <= year <= 2199) or not (1 <= month <= 12) or not (1 <= day <= 31):
            return {
                "content": "Invalid solar date: year={}, month={}, day={}. Year must be 1900–2199.".format(
                    year, month, day
                ),
                "sources": [],
            }
        try:
            solar = Solar(year, month, day)
            lunar = Converter.Solar2Lunar(solar)
        except Exception as e:
            return {
                "content": "Could not convert solar date {}/{}/{}: {}".format(
                    day, month, year, e
                ),
                "sources": [],
            }
        return _fmt_result(solar, lunar, "solar_to_lunar")

    if direction == "lunar_to_solar":
        if not (_LUNAR_YEAR_MIN <= year <= _LUNAR_YEAR_MAX) or not (1 <= month <= 12) or not (1 <= day <= 30):
            return {
                "content": "Invalid lunar date: year={}, month={}, day={}. Year must be {}–{}, day 1–30.".format(
                    year, month, day, _LUNAR_YEAR_MIN, _LUNAR_YEAR_MAX
                ),
                "sources": [],
            }
        try:
            lunar = Lunar(year, month, day, isleap=bool(is_leap))
            solar = Converter.Lunar2Solar(lunar)
        except DateNotExist:
            # Day doesn't exist in this lunar month (month has only 29 days).
            # Probe for the last valid day so the LLM can relay a useful answer.
            last_day_info = ""
            for probe in range(29, 0, -1):
                try:
                    probe_lunar = Lunar(year, month, probe, isleap=bool(is_leap))
                    probe_solar = Converter.Lunar2Solar(probe_lunar)
                    last_day_info = (
                        " Tháng {} âm lịch năm {} chỉ có {} ngày — ngày cuối là "
                        "{}/{}/{} âm = {:02d}/{:02d}/{} dương.".format(
                            month, year, probe,
                            probe, month, year,
                            probe_solar.day, probe_solar.month, probe_solar.year,
                        )
                    )
                    break
                except DateNotExist:
                    continue
            return {
                "content": "Ngày {}/{}/{} âm lịch không tồn tại.{}".format(
                    day, month, year, last_day_info
                ),
                "sources": [],
            }
        except Exception as e:
            return {
                "content": "Could not convert lunar date {}/{}/{}: {}".format(
                    day, month, year, e
                ),
                "sources": [],
            }
        return _fmt_result(solar, lunar, "lunar_to_solar")

    return {
        "content": "Unknown direction '{}'. Use 'today', 'solar_to_lunar', or 'lunar_to_solar'.".format(
            direction
        ),
        "sources": [],
    }


def register_all_executors(registry) -> None:
    """Register all built-in skill executors with the registry."""
    registry.register_executor("web_search", execute_web_search)
    registry.register_executor("knowledge_base", execute_knowledge_base)
    registry.register_executor("web_reader", execute_web_reader)
    registry.register_executor("datetime_info", execute_datetime_info)
    registry.register_executor("calculate", execute_calculate)
    registry.register_executor("summarize", execute_summarize)
    registry.register_executor("lunar_convert", execute_lunar_convert)
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
