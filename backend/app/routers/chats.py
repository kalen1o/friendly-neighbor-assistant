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
from app.db.session import get_db
from app.hooks.executors import register_all_hook_executors
from app.hooks.registry import HookContext, HookRegistry
from app.llm.provider import get_llm_response
from app.models.artifact import Artifact
from app.models.chat import Chat, Message
from app.models.chat_file import ChatFile
from app.models.hook import Hook
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatDetail,
    ChatListResponse,
    ChatUpdate,
    MessageCreate,
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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = (
        select(Chat)
        .where(Chat.user_id == user.id)
        .order_by(Chat.updated_at.desc(), Chat.public_id.desc())
    )

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


@router.get("/{chat_id}", response_model=ChatDetail)
async def get_chat(
    chat_id: str,
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
    return ChatDetail.from_chat(chat)


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
    chat.title = body.title
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

        tool_defs, knowledge_prompts, registry = await build_agent_context(
            db, settings, user_id=user.id
        )
        tool_executor = await create_tool_executor(registry, db, settings)

        # 3. post_skills hooks (tools are registered, not yet called)
        hook_ctx.knowledge_prompts = knowledge_prompts
        hook_ctx = await hook_registry.run_hooks("post_skills", hook_ctx)

        # Build message history with sliding window
        from app.agent.context import build_context_messages

        await db.refresh(chat, ["messages"])
        llm_messages = await build_context_messages(chat, settings)
        # Persist any new summary that was generated
        await db.commit()

        # Process file attachments
        has_vision = False
        if body.file_ids:
            file_result = await db.execute(
                select(ChatFile).where(
                    ChatFile.public_id.in_(body.file_ids),
                    ChatFile.user_id == user.id,
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
                    "content": user_msg_content + extra_instructions,
                }

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
        mode_tool_rounds = {
            "fast": 3,
            "balanced": settings.max_tool_rounds,
            "thinking": settings.max_tool_rounds * 2,
        }
        tool_rounds = mode_tool_rounds.get(body.mode, settings.max_tool_rounds)

        # Stream with native tool calling
        from app.llm.provider import stream_with_tools

        full_response = ""
        try:
            async for chunk in stream_with_tools(
                llm_messages,
                settings,
                tools=tool_defs if tool_defs and not has_vision else None,
                tool_executor=tool_executor if not has_vision else None,
                on_tool_call=on_tool_call_track,
                max_tool_rounds=tool_rounds,
                vision=has_vision,
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
                yield {
                    "event": "message",
                    "data": hook_ctx.modifications["response_append"],
                }

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

            # Parse artifacts from response
            cleaned_response, found_artifacts = parse_artifacts(full_response)

            # Save assistant message (with artifact tags stripped)
            sources_json = json.dumps(sources_data) if skills_used else None
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

            # Save and emit artifacts
            for art_data in found_artifacts:
                artifact = Artifact(
                    message_id=assistant_msg.id,
                    chat_id=chat.id,
                    user_id=user.id,
                    title=art_data["title"],
                    artifact_type=art_data["type"],
                    code=art_data["code"],
                )
                db.add(artifact)
                await db.commit()
                await db.refresh(artifact)
                yield {
                    "event": "artifact",
                    "data": json.dumps(
                        {
                            "id": artifact.public_id,
                            "type": artifact.artifact_type,
                            "title": artifact.title,
                            "code": artifact.code,
                        }
                    ),
                }

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
