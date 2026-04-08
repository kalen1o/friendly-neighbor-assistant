import json
import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.llm.provider import get_llm_response
from app.models.skill import Skill
from app.skills.registry import SkillRegistry
from app.skills.executors import register_all_executors

logger = logging.getLogger(__name__)

# Casual patterns — skip skills for greetings/thanks
_CASUAL_PATTERNS = [
    r"^(hi|hello|hey|yo|sup)[\s!.,?]*$",
    r"^(thanks|thank you|thx|cheers)[\s!.,?]*$",
    r"^(bye|goodbye|see you|good night|good morning)[\s!.,?]*$",
    r"^(how are you|what's up|how's it going)",
    r"^(ok|okay|sure|got it|understood|nice|cool|great)[\s!.,?]*$",
    r"^(yes|no|yep|nope|yeah|nah)[\s!.,?]*$",
]

# Query abbreviation expansions
_QUERY_EXPANSIONS = {
    "hcm": "Ho Chi Minh City Vietnam",
    "hn": "Hanoi Vietnam",
    "sg": "Singapore",
    "bkk": "Bangkok Thailand",
    "nyc": "New York City",
    "sf": "San Francisco",
    "la": "Los Angeles",
    "uk": "United Kingdom",
    "us": "United States",
}


def _is_casual(message: str) -> bool:
    msg_lower = message.strip().lower()
    return any(re.search(p, msg_lower, re.IGNORECASE) for p in _CASUAL_PATTERNS)


def _expand_query(message: str) -> str:
    query = message
    for abbr, expansion in _QUERY_EXPANSIONS.items():
        query = re.sub(r'\b' + re.escape(abbr) + r'\b', expansion, query, flags=re.IGNORECASE)
    return query


async def _build_registry(db: AsyncSession) -> SkillRegistry:
    """Build a skill registry with built-in + user skills."""
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

    return registry


async def run_agent(
    user_message: str,
    chat_history: list,
    db: AsyncSession,
    settings: Settings,
    on_action=None,
) -> Dict[str, Any]:
    """Run the agent: select and execute relevant skills, return context for LLM.

    Uses LLM to pick skills from the index, then executes selected skills.

    Returns: {"context_parts": [...], "sources": [...], "knowledge_prompts": [...]}
    """
    # Skip skills for casual messages
    if _is_casual(user_message):
        return {"context_parts": [], "sources": [], "knowledge_prompts": []}

    # Build registry
    registry = await _build_registry(db)
    enabled_skills = registry.get_enabled_skills()

    if not enabled_skills:
        return {"context_parts": [], "sources": [], "knowledge_prompts": []}

    # Expand query for better search
    search_query = _expand_query(user_message)

    # Build skill index for selection — include ALL types
    skill_index = "\n".join(
        f"- {s.name} ({s.skill_type}): {s.description}" for s in enabled_skills
    )

    if on_action:
        await on_action("Selecting skills...")

    # Ask LLM which skills to use
    selection_prompt = (
        f"Given the user's message, which skills should be used? "
        f"Reply with ONLY a comma-separated list of skill names, or 'none'.\n\n"
        f"Available skills:\n{skill_index}\n\n"
        f"User message: {user_message}\n\n"
        f"Skills to use:"
    )

    try:
        selection = await get_llm_response(
            [{"role": "user", "content": selection_prompt}],
            settings
        )
        selected_names = [
            n.strip().lower()
            for n in selection.strip().split(",")
            if n.strip().lower() != "none" and n.strip()
        ]
    except Exception:
        # Fallback: no skills
        selected_names = []

    if not selected_names:
        return {"context_parts": [], "sources": [], "knowledge_prompts": []}

    # Execute selected skills
    context_parts = []
    sources = []
    knowledge_prompts = []

    for skill_name in selected_names:
        skill = registry.get_skill(skill_name)
        if not skill:
            continue

        if on_action:
            await on_action(f"Using {skill.name}...")

        # Knowledge skills: inject their content as system prompt
        if skill.skill_type == "knowledge":
            knowledge_prompts.append(skill.content)
            continue

        # Tool/workflow skills: run executor
        executor = registry.get_executor(skill_name)
        if not executor:
            continue

        try:
            result = await executor(
                query=search_query,
                db=db,
                settings=settings,
            )
            if result.get("content"):
                context_parts.append(f"[{skill.name}]: {result['content']}")
            if result.get("sources"):
                sources.extend(result["sources"])
        except TypeError:
            try:
                result = await executor(search_query)
                if isinstance(result, dict):
                    if result.get("content"):
                        context_parts.append(f"[{skill.name}]: {result['content']}")
                    if result.get("sources"):
                        sources.extend(result["sources"])
            except Exception as e:
                logger.warning(f"Skill {skill_name} failed: {e}")
        except Exception as e:
            logger.warning(f"Skill {skill_name} failed: {e}")

    if on_action and sources:
        src_count = len(sources)
        await on_action(f"Found {src_count} result{'s' if src_count > 1 else ''}")

    return {
        "context_parts": context_parts,
        "sources": sources,
        "knowledge_prompts": knowledge_prompts,
    }
