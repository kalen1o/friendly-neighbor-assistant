"""Cross-chat memory extraction.

After each assistant response, analyzes the conversation for user preferences
and facts, then saves them as a JSON array on the User model.
Runs as a background task via asyncio.create_task.
"""

import json
import logging
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.cache.redis import cache_delete, cache_get_json, cache_set_json
from app.config import Settings
from app.llm.provider import get_llm_response
from app.models.user import User

logger = logging.getLogger(__name__)

MAX_MEMORIES = 20
MEMORY_CACHE_TTL = 120  # seconds


def _cache_key(user_id: int) -> str:
    return f"memories:{user_id}"


def _load_memories(user: User) -> list:
    """Parse the JSON memories column. Returns list of dicts."""
    if not user.memories:
        return []
    try:
        data = json.loads(user.memories)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _save_memories(user: User, memories: list) -> None:
    """Serialize memories list to the JSON column."""
    user.memories = json.dumps(memories) if memories else None


async def get_cached_memories(user_id: int, user: User) -> list:
    """Get user memories, using Redis cache when available."""
    cached = await cache_get_json(_cache_key(user_id))
    if cached is not None:
        logger.debug("Memory cache HIT for user %s", user_id)
        return cached

    logger.debug("Memory cache MISS for user %s", user_id)
    memories = _load_memories(user)

    await cache_set_json(_cache_key(user_id), memories, ttl_seconds=MEMORY_CACHE_TTL)
    return memories


async def invalidate_memory_cache(user_id: int) -> None:
    """Clear the memory cache for a user."""
    await cache_delete(_cache_key(user_id))


def build_memory_prompt(memories: list) -> str:
    """Build a system prompt section from user memories."""
    if not memories:
        return ""
    lines = "\n".join(f"- {m['content']}" for m in memories if m.get("content"))
    if not lines:
        return ""
    return (
        "\n\nThings you know about this user (use as context, don't repeat back):\n"
        f"{lines}"
    )


EXTRACTION_PROMPT = """Analyze the conversation below and extract any user preferences, facts, or instructions that should be remembered across future conversations.

Current saved memories:
{existing_memories}

Recent conversation:
{conversation}

Return a JSON array of actions. Each action is one of:
- {{"action": "ADD", "content": "...", "category": "preference|fact|instruction"}}
- {{"action": "UPDATE", "old_content": "...", "content": "...", "category": "preference|fact|instruction"}}
- {{"action": "DELETE", "content": "..."}}

Rules:
- Only extract EXPLICIT user statements about themselves, their preferences, or instructions for how they want you to behave.
- Do NOT extract facts about the world, code snippets, or conversation topics.
- Keep each memory to 1-2 short sentences.
- If the user contradicts an existing memory, use UPDATE.
- If the user says to forget something, use DELETE.
- If nothing new was revealed, return an empty array: []

Return ONLY the JSON array, no other text."""


async def extract_memories(
    user_id: int,
    messages: List[dict],
    settings: Settings,
    session_factory: async_sessionmaker,
) -> None:
    """Extract and save user memories from a conversation. Runs as background task."""
    try:
        async with session_factory() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user or not user.memory_enabled:
                return

            existing = _load_memories(user)
            existing_text = "\n".join(f"- {m['content']}" for m in existing) or "(none)"

            # Build conversation excerpt (last 6 messages)
            recent = messages[-6:] if len(messages) > 6 else messages
            conversation = "\n".join(
                f"{m.get('role', 'user').title()}: {m.get('content', '')[:500]}"
                for m in recent
                if isinstance(m.get("content"), str)
            )

            if not conversation.strip():
                return

            prompt = EXTRACTION_PROMPT.format(
                existing_memories=existing_text,
                conversation=conversation,
            )
            response = await get_llm_response(
                [{"role": "user", "content": prompt}], settings
            )

            actions = _parse_actions(response)
            if not actions:
                return

            # Build lookup for existing memories
            existing_map = {
                m["content"].lower().strip(): i for i, m in enumerate(existing)
            }
            changed = False

            for action in actions:
                act = action.get("action", "").upper()
                content = action.get("content", "").strip()
                category = action.get("category", "general")

                if act == "ADD" and content:
                    # Enforce max limit
                    if len(existing) >= MAX_MEMORIES:
                        existing.pop(0)  # remove oldest
                    existing.append({"content": content, "category": category})
                    changed = True
                    logger.info("Memory ADD for user %s: %s", user_id, content[:50])

                elif act == "UPDATE" and content:
                    old_content = action.get("old_content", "").lower().strip()
                    idx = existing_map.get(old_content)
                    if idx is not None and idx < len(existing):
                        existing[idx] = {"content": content, "category": category}
                    else:
                        if len(existing) >= MAX_MEMORIES:
                            existing.pop(0)
                        existing.append({"content": content, "category": category})
                    changed = True
                    logger.info("Memory UPDATE for user %s: %s", user_id, content[:50])

                elif act == "DELETE" and content:
                    content_lower = content.lower().strip()
                    idx = existing_map.get(content_lower)
                    if idx is not None and idx < len(existing):
                        existing.pop(idx)
                        changed = True
                        logger.info(
                            "Memory DELETE for user %s: %s", user_id, content[:50]
                        )

            if changed:
                _save_memories(user, existing)
                await db.commit()
                await invalidate_memory_cache(user_id)

    except Exception:
        logger.exception("Memory extraction failed for user %s", user_id)


def _parse_actions(response: str) -> list:
    """Parse LLM response into a list of action dicts."""
    response = response.strip()

    if response.startswith("```"):
        lines = response.split("\n")
        response = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])

    try:
        actions = json.loads(response)
        if isinstance(actions, list):
            return actions
    except json.JSONDecodeError:
        pass

    start = response.find("[")
    end = response.rfind("]")
    if start != -1 and end != -1:
        try:
            actions = json.loads(response[start : end + 1])
            if isinstance(actions, list):
                return actions
        except json.JSONDecodeError:
            pass

    return []
