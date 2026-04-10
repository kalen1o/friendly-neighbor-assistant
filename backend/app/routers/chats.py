import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, or_, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.auth.dependencies import get_current_user
from app.cache.per_user import PerUserCache
from app.config import Settings, get_settings
from app.db.session import get_db
from app.hooks.executors import register_all_hook_executors
from app.hooks.registry import HookContext, HookRegistry
from app.llm.provider import get_llm_response, stream_llm_response
from app.models.chat import Chat, Message
from app.models.hook import Hook
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatDetail,
    ChatListResponse,
    ChatSummary,
    ChatUpdate,
    MessageCreate,
    MessageOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chats", tags=["chats"])

_hook_cache: PerUserCache[HookRegistry] = PerUserCache(ttl_seconds=60)


async def _build_hook_registry(db, user_id: int) -> HookRegistry:
    """Build hook registry with builtin hooks + current user's hooks only.

    Cached per user for 60 seconds. Call invalidate_hook_cache() on changes.
    """
    cached = _hook_cache.get(user_id)
    if cached is not None:
        return cached

    registry = HookRegistry()
    registry.load_builtin_hooks()
    register_all_hook_executors(registry)
    try:
        result = await db.execute(
            select(Hook).where(
                or_(Hook.user_id == None, Hook.user_id == user_id),  # noqa: E711
                Hook.enabled == True,  # noqa: E712
            )
        )
        user_hooks = result.scalars().all()
        registry.load_user_hooks(user_hooks)
    except Exception:
        pass

    _hook_cache.set(user_id, registry)
    return registry


def invalidate_hook_cache(user_id: Optional[int] = None) -> None:
    """Clear hook registry cache. Pass user_id to clear one user, or None for all."""
    _hook_cache.invalidate(user_id)


@router.post("", status_code=201, response_model=ChatDetail)
async def create_chat(body: ChatCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    chat = Chat(title=body.title, user_id=user.id)
    db.add(chat)
    await db.commit()
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)


@router.get("", response_model=ChatListResponse)
async def list_chats(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(Chat).where(Chat.user_id == user.id).order_by(Chat.updated_at.desc(), Chat.public_id.desc())

    if cursor:
        try:
            ts_str, pid_str = cursor.split(",", 1)
            cursor_ts = datetime.fromisoformat(ts_str)
            query = query.where(
                or_(
                    Chat.updated_at < cursor_ts,
                    and_(Chat.updated_at == cursor_ts, Chat.public_id < pid_str),
                )
            )
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid cursor")

    result = await db.execute(query.limit(limit + 1))
    chats = list(result.scalars().all())

    has_more = len(chats) > limit
    if has_more:
        chats = chats[:limit]

    next_cursor = None
    if has_more and chats:
        last = chats[-1]
        next_cursor = f"{last.updated_at.isoformat()},{last.public_id}"

    return ChatListResponse(chats=chats, next_cursor=next_cursor, has_more=has_more)


@router.get("/{chat_id}", response_model=ChatDetail)
async def get_chat(chat_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return ChatDetail.from_chat(chat)


@router.patch("/{chat_id}", response_model=ChatDetail)
async def update_chat(
    chat_id: str, body: ChatUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.title = body.title
    await db.commit()
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()


@router.delete("", status_code=204)
async def delete_all_chats(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Chat).where(Chat.user_id == user.id))
    chats = result.scalars().all()
    for chat in chats:
        await db.delete(chat)
    await db.commit()


@router.post("/{chat_id}/messages")
async def send_message(
    chat_id: str,
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
):
    # 1. Validate chat exists and belongs to user
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 2. Save user message
    user_msg = Message(chat_id=chat.id, role="user", content=body.content)
    db.add(user_msg)
    await db.commit()

    # 3. Stream response via SSE
    async def event_generator():
        # Build hook registry (per-user: builtin + current user's hooks)
        hook_registry = await _build_hook_registry(db, user.id)
        hook_ctx = HookContext()
        hook_ctx.user_message = body.content
        hook_ctx.chat_id = chat_id

        # 1. pre_message hooks
        hook_ctx = await hook_registry.run_hooks("pre_message", hook_ctx)
        if hook_ctx.blocked:
            yield {"event": "error", "data": hook_ctx.blocked_reason}
            yield {"event": "done", "data": ""}
            return

        user_msg_content = hook_ctx.modifications.get("message_replace", body.content)

        # 2. pre_skills hooks
        hook_ctx = await hook_registry.run_hooks("pre_skills", hook_ctx)

        # Build agent context (tools + knowledge prompts)
        from app.agent.agent import build_agent_context, create_tool_executor
        tool_defs, knowledge_prompts, registry = await build_agent_context(db, settings, user_id=user.id)
        tool_executor = await create_tool_executor(registry, db, settings)

        # 3. post_skills hooks (tools are registered, not yet called)
        hook_ctx.knowledge_prompts = knowledge_prompts
        hook_ctx = await hook_registry.run_hooks("post_skills", hook_ctx)

        # Build message history
        await db.refresh(chat, ["messages"])
        llm_messages = [
            {"role": m.role, "content": m.content} for m in chat.messages
        ]

        # Inject knowledge prompts into the last user message
        if hook_ctx.knowledge_prompts:
            augmented = (
                f"{user_msg_content}\n\n---\n"
                f"Follow these additional instructions:\n"
                + "\n\n".join(hook_ctx.knowledge_prompts)
            )
            llm_messages[-1] = {"role": "user", "content": augmented}

        # 4. pre_llm hooks
        hook_ctx.llm_messages = llm_messages
        hook_ctx = await hook_registry.run_hooks("pre_llm", hook_ctx)

        yield {"event": "action", "data": "Generating response..."}

        # Track tool calls for sources and badges
        skills_used = []
        import asyncio as _asyncio
        tool_action_queue = _asyncio.Queue()

        async def on_tool_call_track(tool_name):
            if tool_name not in skills_used:
                skills_used.append(tool_name)
            await tool_action_queue.put(f"Using {tool_name}...")

        # Mode-specific tool rounds
        mode_tool_rounds = {"fast": 3, "balanced": settings.max_tool_rounds, "thinking": settings.max_tool_rounds * 2}
        tool_rounds = mode_tool_rounds.get(body.mode, settings.max_tool_rounds)

        # Stream with native tool calling
        from app.llm.provider import stream_with_tools
        full_response = ""
        try:
            async for chunk in stream_with_tools(
                llm_messages, settings,
                tools=tool_defs if tool_defs else None,
                tool_executor=tool_executor,
                on_tool_call=on_tool_call_track,
                max_tool_rounds=tool_rounds,
            ):
                # Drain action queue — yield immediately
                while not tool_action_queue.empty():
                    action = await tool_action_queue.get()
                    yield {"event": "action", "data": action}
                full_response += chunk
                yield {"event": "message", "data": chunk}

            # Drain any remaining actions
            while not tool_action_queue.empty():
                action = await tool_action_queue.get()
                yield {"event": "action", "data": action}

            # 5. post_llm hooks
            hook_ctx.response = full_response
            hook_ctx.skills_used = skills_used
            hook_ctx = await hook_registry.run_hooks("post_llm", hook_ctx)

            # Apply modifications
            if "response_replace" in hook_ctx.modifications:
                full_response = hook_ctx.modifications["response_replace"]
            if "response_append" in hook_ctx.modifications:
                full_response += hook_ctx.modifications["response_append"]
                yield {"event": "message", "data": hook_ctx.modifications["response_append"]}

            # Build sources: actual sources from tool results + skill labels
            sources_data = []
            seen_urls = set()
            if hasattr(tool_executor, "collected_sources"):
                for src in tool_executor.collected_sources:
                    key = src.get("url") or src.get("filename")
                    if key and key in seen_urls:
                        continue
                    if key:
                        seen_urls.add(key)
                    sources_data.append(src)
            # Add skill labels for tools that didn't return specific sources
            sourced_tools = {s.get("tool") for s in sources_data if s.get("tool")}
            for s in skills_used:
                if s not in sourced_tools:
                    sources_data.append({"type": "skill", "tool": s})
            if sources_data:
                yield {"event": "sources", "data": json.dumps(sources_data)}

            # Save assistant message
            sources_json = json.dumps(sources_data) if skills_used else None
            assistant_msg = Message(
                chat_id=chat.id,
                role="assistant",
                content=full_response,
                sources_json=sources_json,
            )
            db.add(assistant_msg)
            chat.updated_at = func.now()
            await db.commit()

            # Auto-title
            if chat.title is None:
                title = await _generate_title(body.content, full_response, settings)
                chat.title = title
                await db.commit()
                yield {"event": "title", "data": title}

            # 6. post_message hooks (latency calculated here)
            hook_ctx.response = full_response
            hook_ctx.sources = sources_data
            hook_ctx = await hook_registry.run_hooks("post_message", hook_ctx)

            # Collect metrics from hooks and persist
            metrics = {}
            if "latency_seconds" in hook_ctx.metadata:
                metrics["latency"] = hook_ctx.metadata["latency_seconds"]
            if "tokens_total" in hook_ctx.metadata:
                metrics["tokens_input"] = hook_ctx.metadata["tokens_input"]
                metrics["tokens_output"] = hook_ctx.metadata["tokens_output"]
                metrics["tokens_total"] = hook_ctx.metadata["tokens_total"]
            if metrics:
                assistant_msg.latency = metrics.get("latency")
                assistant_msg.tokens_input = metrics.get("tokens_input")
                assistant_msg.tokens_output = metrics.get("tokens_output")
                assistant_msg.tokens_total = metrics.get("tokens_total")
                await db.commit()
                yield {"event": "metrics", "data": json.dumps(metrics)}

            yield {"event": "done", "data": ""}

        except Exception as e:
            logger.exception(f"Error in event_generator: {e}")
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(event_generator())


async def _generate_title(
    user_message: str, assistant_response: str, settings: Settings
) -> str:
    messages = [
        {
            "role": "user",
            "content": (
                f"Summarize this conversation in 3-5 words as a short title. "
                f"Return ONLY the title, no quotes, no punctuation.\n\n"
                f"User: {user_message}\n"
                f"Assistant: {assistant_response}"
            ),
        }
    ]
    title = await get_llm_response(messages, settings)
    return title.strip().strip('"').strip("'")[:100]
