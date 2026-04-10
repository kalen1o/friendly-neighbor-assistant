import json
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.auth.jwt import decode_access_token
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.chat import Chat
from app.models.shared_chat import SharedChat
from app.models.user import User
from app.schemas.shared_chat import ShareCreate, ShareOut, SharedChatView, SharedMessage

router = APIRouter(tags=["sharing"])


@router.post("/api/chats/{chat_id}/share", status_code=201, response_model=ShareOut)
async def create_share(
    chat_id: str,
    body: ShareCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.visibility not in ("public", "authenticated"):
        raise HTTPException(
            status_code=400, detail="visibility must be 'public' or 'authenticated'"
        )

    result = await db.execute(
        select(Chat)
        .where(Chat.public_id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    snapshot = json.dumps(
        [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in chat.messages
        ]
    )

    shared = SharedChat(
        chat_id=chat.id,
        user_id=user.id,
        visibility=body.visibility,
        title=chat.title,
        snapshot=snapshot,
    )
    db.add(shared)
    await db.commit()
    await db.refresh(shared)

    return ShareOut.from_shared(shared)


@router.get("/api/shared/{share_id}", response_model=SharedChatView)
async def view_shared_chat(
    share_id: str,
    request: Request,
    access_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    result = await db.execute(
        select(SharedChat).where(
            SharedChat.public_id == share_id, SharedChat.active == True
        )
    )
    shared = result.scalar_one_or_none()
    if not shared:
        raise HTTPException(status_code=404, detail="Shared chat not found")

    if shared.visibility == "authenticated":
        token = access_token
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if not token or decode_access_token(token, settings) is None:
            raise HTTPException(
                status_code=401,
                detail="Login required to view this shared chat",
            )

    messages = [SharedMessage(**m) for m in json.loads(shared.snapshot)]

    return SharedChatView(
        id=shared.public_id,
        title=shared.title,
        visibility=shared.visibility,
        created_at=shared.created_at,
        messages=messages,
    )


@router.get("/api/chats/{chat_id}/shares", response_model=List[ShareOut])
async def list_shares(
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

    result = await db.execute(
        select(SharedChat)
        .where(SharedChat.chat_id == chat.id, SharedChat.active == True)
        .order_by(SharedChat.created_at.desc())
    )
    shares = result.scalars().all()
    return [ShareOut.from_shared(s) for s in shares]


@router.delete("/api/shared/{share_id}", status_code=204)
async def revoke_share(
    share_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SharedChat).where(
            SharedChat.public_id == share_id, SharedChat.user_id == user.id
        )
    )
    shared = result.scalar_one_or_none()
    if not shared:
        raise HTTPException(status_code=404, detail="Shared chat not found")

    shared.active = False
    await db.commit()
