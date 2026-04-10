import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.mcp.service import execute_mcp_tool, get_enabled_mcp_tools
from app.models.skill import Skill
from app.skills.executors import register_all_executors
from app.skills.registry import SkillDefinition, SkillRegistry

logger = logging.getLogger(__name__)

# Cached registry — rebuilt only when skills or MCP tools change
_registry_cache: Optional[SkillRegistry] = None

# Query abbreviation expansions (used by web search tool)
_QUERY_EXPANSIONS = {
    "hcm": "Ho Chi Minh City Vietnam",
    "hn": "Hanoi Vietnam",
    "sg": "Singapore",
    "bkk": "Bangkok Thailand",
    "nyc": "New York City",
    "sf": "San Francisco",
    "la": "Los Angeles",
}


def _expand_query(query: str) -> str:
    for abbr, expansion in _QUERY_EXPANSIONS.items():
        query = re.sub(r'\b' + re.escape(abbr) + r'\b', expansion, query, flags=re.IGNORECASE)
    return query


async def _build_registry(db: AsyncSession) -> SkillRegistry:
    """Build a skill registry with built-in + user + MCP skills.

    Uses a module-level cache. Call invalidate_agent_cache() when
    skills or MCP tools are created/updated/deleted.
    """
    global _registry_cache

    if _registry_cache is not None:
        logger.debug("Using cached agent registry")
        return _registry_cache

    logger.info("Building agent registry (cache miss)")
    registry = SkillRegistry()
    registry.load_builtin_skills()
    register_all_executors(registry)

    # Load user skills from DB
    try:
        result = await db.execute(select(Skill))
        user_skills = result.scalars().all()
        registry.load_user_skills(user_skills)
    except Exception:
        pass

    # Load enabled MCP tools as skills
    try:
        mcp_tools = await get_enabled_mcp_tools(db)
        for mcp_tool in mcp_tools:
            skill = SkillDefinition(
                name=f"mcp_{mcp_tool['tool_name']}",
                description=mcp_tool["description"],
                skill_type="tool",
                content=f"MCP tool. Input schema: {json.dumps(mcp_tool['input_schema'])}",
                enabled=True,
                builtin=False,
            )
            registry._skills[skill.name] = skill

            tool_name = mcp_tool["tool_name"]
            async def mcp_executor(query, db=db, settings=None, _tn=tool_name, **kwargs):
                return await execute_mcp_tool(_tn, {"query": query}, db)
            registry.register_executor(f"mcp_{tool_name}", mcp_executor)
    except Exception as e:
        logger.warning(f"Failed to load MCP tools: {e}")

    _registry_cache = registry
    return registry


def invalidate_agent_cache():
    """Clear the agent registry cache. Call when skills or MCP tools change."""
    global _registry_cache
    _registry_cache = None
    logger.info("Agent registry cache invalidated")


def build_tool_definitions(registry: SkillRegistry) -> List[Dict[str, Any]]:
    """Convert enabled skills into OpenAI function calling format."""
    tools = []
    for skill in registry.get_enabled_skills():
        if skill.skill_type != "tool":
            continue  # Only tool-type skills become function tools

        tools.append({
            "type": "function",
            "function": {
                "name": skill.name,
                "description": skill.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query or input for this tool",
                        },
                    },
                    "required": ["query"],
                },
            },
        })

    return tools


def get_knowledge_prompts(registry: SkillRegistry) -> List[str]:
    """Get content from enabled knowledge-type skills."""
    return [
        skill.content
        for skill in registry.get_enabled_skills()
        if skill.skill_type == "knowledge"
    ]


async def build_agent_context(
    db: AsyncSession,
    settings: Settings,
) -> Tuple[List[Dict], List[str], SkillRegistry]:
    """Build everything needed for a tool-calling LLM request.

    Returns: (tool_definitions, knowledge_prompts, registry)
    """
    registry = await _build_registry(db)
    tool_defs = build_tool_definitions(registry)
    knowledge_prompts = get_knowledge_prompts(registry)
    return tool_defs, knowledge_prompts, registry


async def create_tool_executor(
    registry: SkillRegistry,
    db: AsyncSession,
    settings: Settings,
) -> Callable:
    """Create a tool executor function that the LLM provider can call.

    The executor collects sources from each tool call into
    executor.collected_sources (list of dicts).
    """

    collected_sources: List[Dict[str, Any]] = []

    async def executor(tool_name: str, arguments: Dict[str, Any]) -> str:
        query = arguments.get("query", "")
        query = _expand_query(query)

        skill_executor = registry.get_executor(tool_name)
        if not skill_executor:
            return f"Tool '{tool_name}' not found"

        try:
            result = await skill_executor(query=query, db=db, settings=settings)
            if isinstance(result, dict):
                if result.get("sources"):
                    collected_sources.extend(result["sources"])
                return result.get("content", json.dumps(result))
            return str(result)
        except TypeError:
            try:
                result = await skill_executor(query)
                if isinstance(result, dict):
                    if result.get("sources"):
                        collected_sources.extend(result["sources"])
                    return result.get("content", json.dumps(result))
                return str(result)
            except Exception as e:
                return f"Tool error: {str(e)}"
        except Exception as e:
            return f"Tool error: {str(e)}"

    executor.collected_sources = collected_sources
    return executor
