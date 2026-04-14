import json
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import or_

from app.cache.per_user import PerUserCache
from app.config import Settings
from app.mcp.service import execute_mcp_tool, get_enabled_mcp_tools
from app.models.skill import Skill
from app.skills.executors import register_all_executors
from app.skills.registry import SkillDefinition, SkillRegistry

logger = logging.getLogger(__name__)

_registry_cache: PerUserCache[SkillRegistry] = PerUserCache(ttl_seconds=60)


async def _build_registry(db: AsyncSession, user_id: int) -> SkillRegistry:
    """Build a skill registry with built-in + current user's skills + MCP tools.

    Cached per user for 60 seconds. Call invalidate_agent_cache() on changes.
    """
    cached = _registry_cache.get(user_id)
    if cached is not None:
        logger.debug("Using cached agent registry for user %s", user_id)
        return cached

    logger.info("Building agent registry for user %s (cache miss)", user_id)
    registry = SkillRegistry()
    registry.load_builtin_skills()
    register_all_executors(registry)

    # Load builtin (user_id=None) + current user's skills
    try:
        result = await db.execute(
            select(Skill).where(
                or_(Skill.user_id == None, Skill.user_id == user_id),  # noqa: E711
                Skill.enabled == True,  # noqa: E712
            )
        )
        user_skills = result.scalars().all()
        registry.load_user_skills(user_skills)
    except Exception:
        pass

    # Load enabled MCP tools from builtin + current user's servers
    try:
        mcp_tools = await get_enabled_mcp_tools(db, user_id)
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

            async def mcp_executor(
                query, db=db, settings=None, _tn=tool_name, **kwargs
            ):
                return await execute_mcp_tool(_tn, {"query": query}, db)

            registry.register_executor(f"mcp_{tool_name}", mcp_executor)
    except Exception as e:
        logger.warning(f"Failed to load MCP tools: {e}")

    _registry_cache.set(user_id, registry)
    return registry


def invalidate_agent_cache(user_id: Optional[int] = None) -> None:
    """Clear agent registry cache. Pass user_id to clear one user, or None for all."""
    _registry_cache.invalidate(user_id)
    logger.info("Agent registry cache invalidated (user_id=%s)", user_id)


# Per-tool parameter schemas for OpenAI function calling
TOOL_PARAMETERS = {
    "web_search": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query for finding current information on the web",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of search results to return",
                "default": 3,
            },
        },
        "required": ["query"],
    },
    "knowledge_base": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to find relevant passages in uploaded documents",
            },
            "top_k": {
                "type": "integer",
                "description": "Number of most relevant document chunks to return",
                "default": 5,
            },
        },
        "required": ["query"],
    },
    "web_reader": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch and extract content from",
            },
        },
        "required": ["url"],
    },
    "calculate": {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', '15% of 200')",
            },
        },
        "required": ["expression"],
    },
    "datetime_info": {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "Timezone name (e.g., 'America/New_York', 'Asia/Ho_Chi_Minh', 'UTC')",
                "default": "UTC",
            },
        },
        "required": [],
    },
    "summarize": {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "The text content to summarize",
            },
            "style": {
                "type": "string",
                "description": "Summary style: 'brief' (1-2 sentences), 'detailed' (bullet points), or 'executive' (key takeaways)",
                "enum": ["brief", "detailed", "executive"],
                "default": "brief",
            },
        },
        "required": ["text"],
    },
}

# Default fallback for tools without a specific schema
_DEFAULT_PARAMETERS = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The input for this tool",
        },
    },
    "required": ["query"],
}


def build_tool_definitions(registry: SkillRegistry) -> List[Dict[str, Any]]:
    """Convert enabled skills into OpenAI function calling format."""
    tools = []
    for skill in registry.get_enabled_skills():
        if skill.skill_type not in ("tool", "workflow"):
            continue

        parameters = TOOL_PARAMETERS.get(skill.name, _DEFAULT_PARAMETERS)

        tools.append(
            {
                "type": "function",
                "function": {
                    "name": skill.name,
                    "description": skill.description,
                    "parameters": parameters,
                },
            }
        )

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
    user_id: int = None,
) -> Tuple[List[Dict], List[str], SkillRegistry]:
    """Build everything needed for a tool-calling LLM request.

    Returns: (tool_definitions, knowledge_prompts, registry)
    """
    registry = await _build_registry(db, user_id)
    tool_defs = build_tool_definitions(registry)
    knowledge_prompts = get_knowledge_prompts(registry)
    return tool_defs, knowledge_prompts, registry


async def create_tool_executor(
    registry: SkillRegistry,
    db: AsyncSession,
    settings: Settings,
    on_action: Optional[Callable] = None,
) -> Callable:
    """Create a tool executor function that the LLM provider can call.

    The executor collects sources from each tool call into
    executor.collected_sources (list of dicts).
    on_action: optional async fn(message: str) for workflow progress updates.
    """

    collected_sources: List[Dict[str, Any]] = []

    async def executor(tool_name: str, arguments: Dict[str, Any]) -> str:
        skill_executor = registry.get_executor(tool_name)
        if not skill_executor:
            return "Tool '{}' not found".format(tool_name)

        # Inject on_progress for workflow executors
        extra_kwargs = {}
        skill = registry.get_skill(tool_name)
        if skill and skill.skill_type == "workflow" and on_action:
            extra_kwargs["on_progress"] = on_action

        try:
            # Pass all arguments + db/settings to the executor
            result = await skill_executor(**arguments, **extra_kwargs, db=db, settings=settings)
            if isinstance(result, dict):
                if result.get("sources"):
                    collected_sources.extend(result["sources"])
                return result.get("content", json.dumps(result))
            return str(result)
        except TypeError:
            # Fallback: try with just query (for backward compat with simple executors)
            query = arguments.get("query", arguments.get("expression", arguments.get("url", arguments.get("text", ""))))
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
                    return "Tool error: {}".format(str(e))
        except Exception as e:
            return "Tool error: {}".format(str(e))

    executor.collected_sources = collected_sources
    return executor
