import asyncio
import base64
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.agent.artifact_parser import parse_artifacts
from app.auth.dependencies import get_current_user
from app.cache.per_user import PerUserCache
from app.config import Settings, get_settings
from app.db.engine import get_session_factory
from app.db.session import get_db
from app.hooks.executors import register_all_hook_executors
from app.hooks.registry import HookContext, HookRegistry
from app.llm.provider import get_llm_response
from app.models.artifact import Artifact
from app.models.chat import Chat, Message
from app.models.folder import Folder
from app.models.user_model import UserModel
from app.llm.model_config import resolve_model_config
from app.models.chat_file import ChatFile
from app.models.hook import Hook
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatDetail,
    ChatListResponse,
    ChatUpdate,
    MessageCreate,
    MessageOut,
    SearchResponse,
    SearchResult,
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
async def create_chat(
    body: ChatCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = Chat(title=body.title, user_id=user.id)
    db.add(chat)
    await db.commit()
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)


@router.get("", response_model=ChatListResponse)
async def list_chats(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    folder_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = (
        select(Chat)
        .where(Chat.user_id == user.id)
        .order_by(Chat.updated_at.desc(), Chat.public_id.desc())
    )

    # Filter by folder
    if folder_id == "none":
        query = query.where(Chat.folder_id == None)  # noqa: E711
    elif folder_id:
        folder_result = await db.execute(
            select(Folder.id).where(
                Folder.public_id == folder_id, Folder.user_id == user.id
            )
        )
        fid = folder_result.scalar_one_or_none()
        if fid is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        query = query.where(Chat.folder_id == fid)

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

    # Resolve folder public IDs for the response
    folder_internal_ids = {c.folder_id for c in chats if c.folder_id}
    folder_map = {}
    if folder_internal_ids:
        fres = await db.execute(
            select(Folder.id, Folder.public_id).where(Folder.id.in_(folder_internal_ids))
        )
        folder_map = dict(fres.all())

    # Resolve model public IDs for the response
    model_internal_ids = {c.user_model_id for c in chats if c.user_model_id}
    model_map = {}
    if model_internal_ids:
        mres = await db.execute(
            select(UserModel.id, UserModel.public_id).where(UserModel.id.in_(model_internal_ids))
        )
        model_map = dict(mres.all())

    chat_summaries = [
        {
            "public_id": c.public_id,
            "title": c.title,
            "updated_at": c.updated_at,
            "folder_id": folder_map.get(c.folder_id) if c.folder_id else None,
            "model_id": c.selected_model_slug or (model_map.get(c.user_model_id) if c.user_model_id else None),
            "has_notification": c.has_notification,
        }
        for c in chats
    ]

    return ChatListResponse(chats=chat_summaries, next_cursor=next_cursor, has_more=has_more)


@router.get("/search", response_model=SearchResponse)
async def search_chats(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full-text search across user's chat messages."""
    # Detect database dialect for Postgres vs SQLite compatibility
    dialect = db.bind.dialect.name if db.bind else "unknown"

    if dialect == "postgresql":
        # Postgres: use tsvector full-text search with ranking
        from sqlalchemy import text

        query = text("""
            SELECT m.public_id as message_id, m.role, m.content, m.created_at,
                   c.public_id as chat_id, c.title as chat_title,
                   ts_rank(m.search_vector, plainto_tsquery('english', :query)) as rank
            FROM messages m
            JOIN chats c ON c.id = m.chat_id
            WHERE c.user_id = :user_id
              AND m.search_vector @@ plainto_tsquery('english', :query)
            ORDER BY rank DESC
            LIMIT :limit
        """)
        result = await db.execute(
            query, {"query": q, "user_id": user.id, "limit": limit}
        )
    else:
        # SQLite fallback: LIKE-based search
        from sqlalchemy import text

        query = text("""
            SELECT m.public_id as message_id, m.role, m.content, m.created_at,
                   c.public_id as chat_id, c.title as chat_title
            FROM messages m
            JOIN chats c ON c.id = m.chat_id
            WHERE c.user_id = :user_id
              AND m.content LIKE :pattern
            ORDER BY m.created_at DESC
            LIMIT :limit
        """)
        result = await db.execute(
            query, {"pattern": f"%{q}%", "user_id": user.id, "limit": limit}
        )

    rows = result.mappings().all()
    results = [
        SearchResult(
            chat_id=row["chat_id"],
            chat_title=row["chat_title"],
            message_id=row["message_id"],
            role=row["role"],
            content=row["content"][:300],  # Truncate for preview
            created_at=row["created_at"],
        )
        for row in rows
    ]

    return SearchResponse(results=results, total=len(results))


@router.get("/{chat_id}")
async def get_chat(
    chat_id: str,
    limit: Optional[int] = Query(
        None,
        ge=1,
        le=200,
        description="Max messages to return (newest first). Omit for all.",
    ),
    before: Optional[str] = Query(
        None, description="Cursor: return messages before this message ID"
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Load chat without messages (we'll query them separately if paginated)
    chat_result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id)
    )
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # Clear notification when user opens the chat
    if chat.has_notification:
        try:
            from sqlalchemy import update
            await db.execute(
                update(Chat).where(Chat.id == chat.id).values(has_notification=False)
            )
            await db.commit()
            await db.refresh(chat)
        except Exception:
            await db.rollback()
            chat_result = await db.execute(
                select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id)
            )
            chat = chat_result.scalar_one_or_none()
            if not chat:
                raise HTTPException(status_code=404, detail="Chat not found")

    # If no pagination params, return all messages (backward compatible)
    if limit is None and before is None:
        msg_result = await db.execute(
            select(Message)
            .where(Message.chat_id == chat.id)
            .options(selectinload(Message.files))
            .order_by(Message.created_at)
        )
        messages = msg_result.scalars().all()
        # Resolve model_id for response
        chat_model_id = chat.selected_model_slug
        if not chat_model_id and chat.user_model_id:
            um_res = await db.execute(
                select(UserModel.public_id).where(UserModel.id == chat.user_model_id)
            )
            chat_model_id = um_res.scalar_one_or_none()

        return {
            "id": chat.public_id,
            "title": chat.title,
            "created_at": chat.created_at.isoformat(),
            "updated_at": chat.updated_at.isoformat(),
            "messages": [MessageOut.from_message(m).model_dump() for m in messages],
            "model_id": chat_model_id,
        }

    # Paginated: return `limit` most recent messages, or messages before cursor
    query = (
        select(Message)
        .where(Message.chat_id == chat.id)
        .options(selectinload(Message.files))
    )

    if before:
        cursor_result = await db.execute(
            select(Message.id).where(
                Message.public_id == before, Message.chat_id == chat.id
            )
        )
        cursor_id = cursor_result.scalar_one_or_none()
        if cursor_id:
            query = query.where(Message.id < cursor_id)

    effective_limit = limit or 50
    # Fetch one extra to determine has_more
    query = query.order_by(Message.created_at.desc()).limit(effective_limit + 1)
    msg_result = await db.execute(query)
    messages = list(msg_result.scalars().all())

    has_more = len(messages) > effective_limit
    if has_more:
        messages = messages[:effective_limit]

    # Reverse to chronological order
    messages.reverse()

    next_cursor = messages[0].public_id if has_more and messages else None

    # Resolve model_id for response
    paginated_model_id = chat.selected_model_slug
    if not paginated_model_id and chat.user_model_id:
        um_res = await db.execute(
            select(UserModel.public_id).where(UserModel.id == chat.user_model_id)
        )
        paginated_model_id = um_res.scalar_one_or_none()

    return {
        "id": chat.public_id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "messages": [MessageOut.from_message(m).model_dump() for m in messages],
        "has_more": has_more,
        "next_cursor": next_cursor,
        "model_id": paginated_model_id,
    }


@router.patch("/{chat_id}", response_model=ChatDetail)
async def update_chat(
    chat_id: str,
    body: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat)
        .where(Chat.public_id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages).selectinload(Message.files))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if body.title is not None:
        chat.title = body.title

    if body.folder_id is not None:
        if body.folder_id == "none":
            chat.folder_id = None
        else:
            folder_result = await db.execute(
                select(Folder.id).where(
                    Folder.public_id == body.folder_id, Folder.user_id == user.id
                )
            )
            fid = folder_result.scalar_one_or_none()
            if fid is None:
                raise HTTPException(status_code=404, detail="Folder not found")
            chat.folder_id = fid

    if body.model_id is not None:
        if body.model_id == "":
            # Reset to default
            chat.user_model_id = None
            chat.selected_model_slug = None
        elif body.model_id.startswith("project-"):
            # Project model — store slug, clear user model FK
            chat.user_model_id = None
            chat.selected_model_slug = body.model_id
        else:
            # User model — store FK, clear slug
            model_result = await db.execute(
                select(UserModel.id).where(
                    UserModel.public_id == body.model_id, UserModel.user_id == user.id
                )
            )
            mid = model_result.scalar_one_or_none()
            if mid is None:
                raise HTTPException(status_code=404, detail="Model not found")
            chat.user_model_id = mid
            chat.selected_model_slug = None

    await db.commit()
    await db.refresh(chat)
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()


@router.delete("", status_code=204)
async def delete_all_chats(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
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
        select(Chat)
        .where(Chat.public_id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages).selectinload(Message.files))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 2. Save user message
    user_msg = Message(chat_id=chat.id, role="user", content=body.content)
    db.add(user_msg)
    await db.commit()

    chat.has_notification = True
    await db.commit()

    # 3. Start background task and stream via SSE
    queue: asyncio.Queue = asyncio.Queue()

    asyncio.ensure_future(_llm_background_task(
        chat_id=chat.id,
        chat_public_id=chat_id,
        user_id=user.id,
        user_msg_id=user_msg.id,
        user_msg_content=body.content,
        mode=body.mode,
        file_ids=body.file_ids,
        user_memory_enabled=user.memory_enabled,
        settings=settings,
        queue=queue,
    ))

    async def event_generator():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event

    return EventSourceResponse(event_generator())


async def _llm_background_task(
    chat_id: int,
    chat_public_id: str,
    user_id: int,
    user_msg_id: int,
    user_msg_content: str,
    mode: str,
    file_ids: list,
    user_memory_enabled: bool,
    settings: Settings,
    queue: asyncio.Queue,
):
    """Runs the full LLM pipeline with its own DB session. Writes SSE events to queue."""
    async with get_session_factory()() as db:
        try:
            # Load chat fresh in this session
            result = await db.execute(
                select(Chat)
                .where(Chat.id == chat_id)
                .options(selectinload(Chat.messages).selectinload(Message.files))
            )
            chat = result.scalar_one_or_none()
            if not chat:
                await queue.put({"event": "error", "data": "Chat not found"})
                await queue.put(None)
                return

            # Load user fresh in this session
            user_result = await db.execute(
                select(User).where(User.id == user_id)
            )
            user = user_result.scalar_one_or_none()
            if not user:
                await queue.put({"event": "error", "data": "User not found"})
                await queue.put(None)
                return

            # Load user message fresh in this session
            user_msg_result = await db.execute(
                select(Message).where(Message.id == user_msg_id)
            )
            user_msg = user_msg_result.scalar_one_or_none()

            # Build hook registry (per-user: builtin + current user's hooks)
            hook_registry = await _build_hook_registry(db, user_id)
            hook_ctx = HookContext()
            hook_ctx.user_message = user_msg_content
            hook_ctx.chat_id = chat_public_id

            # Load user memories for system prompt (Redis-cached)
            from app.agent.memory import build_memory_prompt, get_cached_memories

            memory_prompt = ""
            if user_memory_enabled:
                user_memories = await get_cached_memories(user_id, user)
                memory_prompt = build_memory_prompt(user_memories)

            # Resolve which model to use: per-chat > user default > project default
            resolved_model_config = None

            # 1. Per-chat project model slug (uses project API keys)
            if chat.selected_model_slug and chat.selected_model_slug.startswith("project-"):
                from app.routers.models import _project_defaults
                from app.llm.model_config import ModelConfig
                # Look up the project model by slug to get its base_url
                project_models = _project_defaults(settings)
                matched = next(
                    (m for m in project_models if m.id == chat.selected_model_slug), None
                )
                if matched:
                    api_key = (
                        settings.anthropic_api_key
                        if matched.provider == "anthropic"
                        else settings.openai_api_key
                    )
                    resolved_model_config = ModelConfig(
                        provider=matched.provider,
                        model_id=matched.model_id,
                        api_key=api_key,
                        base_url=matched.base_url,
                    )

            # 2. Per-chat user model (uses user's encrypted API key)
            if resolved_model_config is None and chat.user_model_id and settings.encryption_key:
                um_result = await db.execute(
                    select(UserModel).where(UserModel.id == chat.user_model_id)
                )
                user_model = um_result.scalar_one_or_none()
                if user_model:
                    resolved_model_config = resolve_model_config(
                        user_model, settings, settings.encryption_key
                    )

            # 3. User default model
            if resolved_model_config is None and settings.encryption_key:
                default_result = await db.execute(
                    select(UserModel).where(
                        UserModel.user_id == user_id,
                        UserModel.is_default == True,  # noqa: E712
                    )
                )
                default_model = default_result.scalar_one_or_none()
                if default_model:
                    resolved_model_config = resolve_model_config(
                        default_model, settings, settings.encryption_key
                    )

            # 4. If still None → project default from .env (provider.py handles this)

            # Quota enforcement
            try:
                from app.models.user_quota import UserQuota
                from app.usage import get_usage

                quota_result = await db.execute(
                    select(UserQuota).where(UserQuota.user_id == user_id)
                )
                quota = quota_result.scalar_one_or_none()
                if quota:
                    usage = await get_usage(user_id)
                    # Hard limits — block the request
                    if quota.messages_hard and usage["messages"] >= quota.messages_hard:
                        await queue.put({"event": "error", "data": "Monthly message limit reached. Please try again next month or contact support."})
                        await queue.put({"event": "done", "data": ""})
                        await queue.put(None)
                        return
                    if quota.tokens_hard and usage["tokens_total"] >= quota.tokens_hard:
                        await queue.put({"event": "error", "data": "Monthly token limit reached. Please try again next month or contact support."})
                        await queue.put({"event": "done", "data": ""})
                        await queue.put(None)
                        return
                    # Soft limits — warn but allow
                    if quota.messages_soft and usage["messages"] >= quota.messages_soft:
                        await queue.put({"event": "action", "data": "Warning: approaching monthly message limit."})
                    if quota.tokens_soft and usage["tokens_total"] >= quota.tokens_soft:
                        await queue.put({"event": "action", "data": "Warning: approaching monthly token limit."})
            except Exception:
                logger.warning("Failed to check user quota for user %s", user_id)

            # 1. pre_message hooks
            hook_ctx = await hook_registry.run_hooks("pre_message", hook_ctx)
            if hook_ctx.blocked:
                await queue.put({"event": "error", "data": hook_ctx.blocked_reason})
                await queue.put({"event": "done", "data": ""})
                await queue.put(None)
                return

            user_msg_content_resolved = hook_ctx.modifications.get("message_replace", user_msg_content)

            # 2. pre_skills hooks
            hook_ctx = await hook_registry.run_hooks("pre_skills", hook_ctx)

            # Build agent context (tools + knowledge prompts)
            from app.agent.agent import build_agent_context, create_tool_executor

            tool_defs, knowledge_prompts, registry = await build_agent_context(
                db, settings, user_id=user_id
            )
            tool_executor = await create_tool_executor(registry, db, settings)

            # Check if any enabled knowledge skill specifies a model override
            enabled_names = [s.name for s in registry.get_enabled_skills()]
            skill_model_str = registry.get_skill_model(enabled_names)
            if skill_model_str and ":" in skill_model_str:
                sk_provider, sk_model_id = skill_model_str.split(":", 1)
                # Skill model overrides chat/user/project model
                if sk_provider == "anthropic":
                    sk_api_key = settings.anthropic_api_key
                    sk_base_url = None
                else:
                    sk_api_key = settings.openai_api_key
                    sk_base_url = None
                    # Check if there's a @base_url in the model string
                    if "@" in sk_model_id:
                        sk_model_id, sk_base_url = sk_model_id.rsplit("@", 1)
                    elif settings.openai_base_url:
                        sk_base_url = settings.openai_base_url
                from app.llm.model_config import ModelConfig as _MC
                resolved_model_config = _MC(
                    provider=sk_provider,
                    model_id=sk_model_id,
                    api_key=sk_api_key,
                    base_url=sk_base_url,
                )

            # 3. post_skills hooks (tools are registered, not yet called)
            hook_ctx.knowledge_prompts = knowledge_prompts
            hook_ctx = await hook_registry.run_hooks("post_skills", hook_ctx)

            # Build message history with sliding window
            from app.agent.context import build_context_messages

            await db.refresh(chat, ["messages"])
            llm_messages = await build_context_messages(chat, settings)
            # Persist any new summary that was generated
            await db.commit()

            # Inject user memories as context
            if memory_prompt:
                llm_messages.insert(0, {"role": "user", "content": memory_prompt})
                llm_messages.insert(
                    1,
                    {
                        "role": "assistant",
                        "content": "Understood, I'll keep these in mind.",
                    },
                )

            # Process file attachments
            has_vision = False
            if file_ids:
                file_result = await db.execute(
                    select(ChatFile).where(
                        ChatFile.public_id.in_(file_ids),
                        ChatFile.user_id == user_id,
                    )
                )
                files = file_result.scalars().all()

                # Link files to message
                for f in files:
                    f.message_id = user_msg.id
                    f.chat_id = chat.id
                await db.commit()

                # Build content array for the last user message
                image_blocks = []
                extra_text = []

                for f in files:
                    if f.file_type.startswith("image/"):
                        has_vision = True
                        with open(f.storage_path, "rb") as fh:
                            b64 = base64.b64encode(fh.read()).decode()
                        image_blocks.append(
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{f.file_type};base64,{b64}"},
                            }
                        )
                    elif f.file_type == "application/pdf":
                        from pypdf import PdfReader

                        reader = PdfReader(f.storage_path)
                        pdf_text = "\n".join(
                            page.extract_text() or "" for page in reader.pages
                        )
                        extra_text.append(f"[Content of {f.filename}]:\n{pdf_text}")
                    else:
                        with open(f.storage_path, "r", errors="replace") as fh:
                            file_text = fh.read()
                        extra_text.append(f"[Content of {f.filename}]:\n{file_text}")

                # Modify the last message to include file content
                if image_blocks or extra_text:
                    last_msg = llm_messages[-1]
                    text_content = last_msg.get("content", "")
                    if extra_text:
                        text_content += "\n\n" + "\n\n".join(extra_text)

                    if image_blocks:
                        llm_messages[-1] = {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": text_content},
                                *image_blocks,
                            ],
                        }
                    else:
                        llm_messages[-1]["content"] = text_content

            # Inject knowledge prompts into the last user message
            if hook_ctx.knowledge_prompts:
                extra_instructions = (
                    "\n\n---\n"
                    "Follow these additional instructions:\n"
                    + "\n\n".join(hook_ctx.knowledge_prompts)
                )
                last_msg = llm_messages[-1]
                if isinstance(last_msg.get("content"), list):
                    # Content array (vision mode) — append to the text block
                    for block in last_msg["content"]:
                        if block.get("type") == "text":
                            block["text"] += extra_instructions
                            break
                else:
                    llm_messages[-1] = {
                        "role": "user",
                        "content": user_msg_content_resolved + extra_instructions,
                    }

            # 4. pre_llm hooks
            hook_ctx.llm_messages = llm_messages
            hook_ctx = await hook_registry.run_hooks("pre_llm", hook_ctx)

            await queue.put({"event": "action", "data": "Generating response..."})

            # Track tool calls for sources and badges
            skills_used = []

            tool_action_queue = asyncio.Queue()

            async def on_tool_call_track(tool_name):
                if tool_name not in skills_used:
                    skills_used.append(tool_name)
                await tool_action_queue.put(f"Using {tool_name}...")
                from app.usage import track_tool_call

                await track_tool_call(user_id)

            # Mode-specific tool rounds
            mode_tool_rounds = {
                "fast": 3,
                "balanced": settings.max_tool_rounds,
                "thinking": settings.max_tool_rounds * 2,
            }
            tool_rounds = mode_tool_rounds.get(mode, settings.max_tool_rounds)

            # Stream with native tool calling
            from app.llm.provider import stream_with_tools

            full_response = ""
            assistant_msg = None
            assistant_saved = False
            last_save_len = 0
            try:
                async for chunk in stream_with_tools(
                    llm_messages,
                    settings,
                    tools=tool_defs if tool_defs and not has_vision else None,
                    tool_executor=tool_executor if not has_vision else None,
                    on_tool_call=on_tool_call_track,
                    max_tool_rounds=tool_rounds,
                    vision=has_vision,
                    model_config=resolved_model_config,
                ):
                    # Drain action queue — send immediately
                    while not tool_action_queue.empty():
                        action = await tool_action_queue.get()
                        await queue.put({"event": "action", "data": action})
                    full_response += chunk
                    await queue.put({"event": "message", "data": chunk})

                    # Create assistant message on first text chunk
                    if assistant_msg is None and full_response:
                        assistant_msg = Message(chat_id=chat.id, role="assistant", content=full_response)
                        db.add(assistant_msg)
                        await db.commit()
                        await db.refresh(assistant_msg)
                        assistant_saved = True
                        last_save_len = len(full_response)
                    elif assistant_msg and len(full_response) - last_save_len >= 500:
                        assistant_msg.content = full_response
                        await db.commit()
                        last_save_len = len(full_response)

                # Drain any remaining actions
                while not tool_action_queue.empty():
                    action = await tool_action_queue.get()
                    await queue.put({"event": "action", "data": action})

                # 5. post_llm hooks
                hook_ctx.response = full_response
                hook_ctx.skills_used = skills_used
                hook_ctx = await hook_registry.run_hooks("post_llm", hook_ctx)

                # Apply modifications
                if "response_replace" in hook_ctx.modifications:
                    full_response = hook_ctx.modifications["response_replace"]
                if "response_append" in hook_ctx.modifications:
                    full_response += hook_ctx.modifications["response_append"]
                    await queue.put({
                        "event": "message",
                        "data": hook_ctx.modifications["response_append"],
                    })

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
                    await queue.put({"event": "sources", "data": json.dumps(sources_data)})

                # Parse artifacts from response
                cleaned_response, found_artifacts = parse_artifacts(full_response)

                # Save assistant message (with artifact tags stripped)
                sources_json = json.dumps(sources_data) if skills_used else None
                if assistant_msg:
                    # Update the progressively-saved message
                    assistant_msg.content = cleaned_response
                    assistant_msg.sources_json = sources_json
                else:
                    # No progressive save happened — create the message now
                    assistant_msg = Message(
                        chat_id=chat.id,
                        role="assistant",
                        content=cleaned_response,
                        sources_json=sources_json,
                    )
                    db.add(assistant_msg)
                chat.updated_at = func.now()
                await db.commit()
                await db.refresh(assistant_msg)

                # Audit logging
                from app.auth.admin import log_audit as _log_audit
                await _log_audit(db, "send_message", user_id=user_id, resource_type="chat", resource_id=chat_public_id)

                # Save and emit artifacts
                for art_data in found_artifacts:
                    artifact = Artifact(
                        message_id=assistant_msg.id,
                        chat_id=chat.id,
                        user_id=user_id,
                        title=art_data["title"],
                        artifact_type=art_data["type"],
                        code=art_data["code"],
                    )
                    db.add(artifact)
                    await db.commit()
                    await db.refresh(artifact)
                    await queue.put({
                        "event": "artifact",
                        "data": json.dumps(
                            {
                                "id": artifact.public_id,
                                "type": artifact.artifact_type,
                                "title": artifact.title,
                                "code": artifact.code,
                            }
                        ),
                    })

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
                    await queue.put({"event": "metrics", "data": json.dumps(metrics)})

                # Track usage analytics
                from app.usage import track_message

                await track_message(
                    user_id,
                    tokens_input=metrics.get("tokens_input", 0),
                    tokens_output=metrics.get("tokens_output", 0),
                )

                # Signal response complete — title generation follows asynchronously
                await queue.put({"event": "done", "data": ""})

                # Auto-title (runs after done so the user isn't blocked)
                if chat.title is None:
                    title = await _generate_title(user_msg_content, full_response, settings)
                    chat.title = title
                    await db.commit()
                    await queue.put({"event": "title", "data": title})

                # Background: extract memories from this conversation
                if user_memory_enabled:
                    from app.agent.memory import extract_memories

                    asyncio.create_task(
                        extract_memories(
                            user_id,
                            llm_messages,
                            settings,
                            get_session_factory(),
                        )
                    )

            except Exception as e:
                logger.exception(f"Error in _llm_background_task (inner): {e}")
                await db.rollback()
                # Save partial response if we got any content before the error
                if full_response:
                    try:
                        partial_msg = Message(
                            chat_id=chat.id,
                            role="assistant",
                            content=full_response
                            + "\n\n[Response interrupted due to an error]",
                        )
                        db.add(partial_msg)
                        await db.commit()
                    except Exception:
                        logger.warning("Failed to save partial message after error")
                await queue.put({"event": "error", "data": str(e)})

        except Exception as e:
            logger.exception(f"Error in _llm_background_task (outer): {e}")
            await queue.put({"event": "error", "data": str(e)})
        finally:
            # Signal queue completion so SSE generator exits
            await queue.put(None)


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
