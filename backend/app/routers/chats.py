import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.agent.agent import run_agent
from app.config import Settings, get_settings
from app.db.session import get_db
from app.hooks.executors import register_all_hook_executors
from app.hooks.registry import HookContext, HookRegistry
from app.llm.provider import get_llm_response, stream_llm_response
from app.models.chat import Chat, Message
from app.models.hook import Hook
from app.schemas.chat import (
    ChatCreate,
    ChatDetail,
    ChatSummary,
    ChatUpdate,
    MessageCreate,
    MessageOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chats", tags=["chats"])


async def _build_hook_registry(db) -> HookRegistry:
    registry = HookRegistry()
    registry.load_builtin_hooks()
    register_all_hook_executors(registry)
    try:
        result = await db.execute(select(Hook))
        user_hooks = result.scalars().all()
        registry.load_user_hooks(user_hooks)
    except Exception:
        pass
    return registry


@router.post("", status_code=201, response_model=ChatDetail)
async def create_chat(body: ChatCreate, db: AsyncSession = Depends(get_db)):
    chat = Chat(title=body.title)
    db.add(chat)
    await db.commit()
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)


@router.get("", response_model=List[ChatSummary])
async def list_chats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).order_by(Chat.updated_at.desc(), Chat.id.desc()))
    return result.scalars().all()


@router.get("/{chat_id}", response_model=ChatDetail)
async def get_chat(chat_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return ChatDetail.from_chat(chat)


@router.patch("/{chat_id}", response_model=ChatDetail)
async def update_chat(
    chat_id: int, body: ChatUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.title = body.title
    await db.commit()
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one()
    return ChatDetail.from_chat(chat)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()


@router.post("/{chat_id}/messages")
async def send_message(
    chat_id: int,
    body: MessageCreate,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # 1. Validate chat exists
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 2. Save user message
    user_msg = Message(chat_id=chat_id, role="user", content=body.content)
    db.add(user_msg)
    await db.commit()

    # 3. Stream response via SSE
    async def event_generator():
        # Build hook registry
        hook_registry = await _build_hook_registry(db)
        hook_ctx = HookContext()
        hook_ctx.user_message = body.content
        hook_ctx.chat_id = chat_id

        # 1. pre_message hooks
        hook_ctx = await hook_registry.run_hooks("pre_message", hook_ctx)
        if hook_ctx.blocked:
            yield {"event": "error", "data": hook_ctx.blocked_reason}
            yield {"event": "done", "data": ""}
            return

        # Use potentially modified message
        user_msg_content = hook_ctx.modifications.get("message_replace", body.content)

        # 2. pre_skills hooks
        hook_ctx = await hook_registry.run_hooks("pre_skills", hook_ctx)

        actions = []

        async def on_action(text):
            actions.append(text)

        # Run agent: selects and executes skills
        agent_result = await run_agent(
            user_message=user_msg_content,
            chat_history=[],
            db=db,
            settings=settings,
            on_action=on_action,
        )

        # Yield all action events
        for action_text in actions:
            yield {"event": "action", "data": action_text}

        context_parts = agent_result["context_parts"]
        sources = agent_result["sources"]
        knowledge_prompts = agent_result["knowledge_prompts"]

        # 3. post_skills hooks
        hook_ctx.skills_used = [a.replace("Using ", "").replace("...", "") for a in actions if a.startswith("Using ")]
        hook_ctx.sources = sources
        hook_ctx.context_parts = context_parts
        hook_ctx.knowledge_prompts = knowledge_prompts
        hook_ctx = await hook_registry.run_hooks("post_skills", hook_ctx)

        # 4. Build message history for LLM
        await db.refresh(chat, ["messages"])
        llm_messages = [
            {"role": m.role, "content": m.content} for m in chat.messages
        ]

        # Inject knowledge skill prompts + tool context into the message
        augment_parts = []

        if hook_ctx.knowledge_prompts:
            augment_parts.append("Follow these additional instructions:\n" + "\n\n".join(hook_ctx.knowledge_prompts))

        if hook_ctx.context_parts:
            augment_parts.append("Use the following context to help answer. Cite sources when relevant:\n\n" + "\n\n".join(hook_ctx.context_parts))

        if augment_parts:
            augmented_content = (
                f"{user_msg_content}\n\n---\n" + "\n\n---\n".join(augment_parts)
            )
            llm_messages[-1] = {"role": "user", "content": augmented_content}

        # 4. pre_llm hooks
        hook_ctx.llm_messages = llm_messages
        hook_ctx = await hook_registry.run_hooks("pre_llm", hook_ctx)

        yield {"event": "action", "data": "Generating response..."}

        # Stream LLM response
        full_response = ""
        try:
            async for chunk in stream_llm_response(llm_messages, settings):
                full_response += chunk
                yield {"event": "message", "data": chunk}

            # 5. post_llm hooks
            hook_ctx.response = full_response
            hook_ctx = await hook_registry.run_hooks("post_llm", hook_ctx)

            # Apply modifications
            if "response_replace" in hook_ctx.modifications:
                full_response = hook_ctx.modifications["response_replace"]
            if "response_append" in hook_ctx.modifications:
                full_response += hook_ctx.modifications["response_append"]
                yield {"event": "message", "data": hook_ctx.modifications["response_append"]}

            # Save assistant message with sources
            sources_json = json.dumps(sources) if sources else None
            assistant_msg = Message(
                chat_id=chat_id,
                role="assistant",
                content=full_response,
                sources_json=sources_json,
            )
            db.add(assistant_msg)
            chat.updated_at = func.now()
            await db.commit()

            # Send sources to frontend
            if sources:
                yield {"event": "sources", "data": json.dumps(sources)}

            # Auto-title
            if chat.title is None:
                title = await _generate_title(body.content, full_response, settings)
                chat.title = title
                await db.commit()
                yield {"event": "title", "data": title}

            # 6. post_message hooks
            hook_ctx.response = full_response
            hook_ctx = await hook_registry.run_hooks("post_message", hook_ctx)

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
