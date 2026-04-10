from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.hooks.registry import HookRegistry
from app.models.hook import Hook
from app.models.user import User
from app.routers.chats import invalidate_hook_cache
from app.schemas.hook import HookCreate, HookOut, HookUpdate

router = APIRouter(prefix="/api/hooks", tags=["hooks"])


def _get_builtin_hooks() -> List[dict]:
    registry = HookRegistry()
    registry.load_builtin_hooks()
    return [
        {
            "id": f"hook-builtin-{h.name}",
            "name": h.name,
            "description": h.description,
            "hook_type": h.hook_type,
            "hook_point": h.hook_point,
            "priority": h.priority,
            "content": h.content,
            "enabled": h.enabled,
            "builtin": True,
            "created_at": None,
            "updated_at": None,
        }
        for h in registry.all_hooks()
    ]


@router.get("", response_model=List[HookOut])
async def list_hooks(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    builtin = _get_builtin_hooks()
    result = await db.execute(
        select(Hook).where(or_(Hook.user_id == None, Hook.user_id == user.id)).order_by(Hook.hook_point, Hook.priority)  # noqa: E711
    )
    user_hooks = result.scalars().all()
    db_names = {h.name for h in user_hooks}
    merged = [b for b in builtin if b["name"] not in db_names]
    return merged + [HookOut.model_validate(h) for h in user_hooks]


@router.post("", status_code=201, response_model=HookOut)
async def create_hook(body: HookCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    existing = await db.execute(select(Hook).where(Hook.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Hook '{body.name}' already exists")
    hook = Hook(
        name=body.name,
        description=body.description,
        hook_type=body.hook_type,
        hook_point=body.hook_point,
        priority=body.priority,
        content=body.content,
        enabled=True,
        builtin=False,
        user_id=user.id,
    )
    db.add(hook)
    await db.commit()
    invalidate_hook_cache()
    await db.refresh(hook)
    return hook


@router.get("/{hook_id}", response_model=HookOut)
async def get_hook(hook_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Hook).where(Hook.public_id == hook_id, or_(Hook.user_id == None, Hook.user_id == user.id)))  # noqa: E711
    hook = result.scalar_one_or_none()
    if not hook:
        raise HTTPException(status_code=404, detail="Hook not found")
    return hook


@router.patch("/{hook_id}", response_model=HookOut)
async def update_hook(hook_id: str, body: HookUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Hook).where(Hook.public_id == hook_id, Hook.user_id == user.id))
    hook = result.scalar_one_or_none()
    if not hook:
        raise HTTPException(status_code=404, detail="Hook not found")
    if body.name is not None:
        hook.name = body.name
    if body.description is not None:
        hook.description = body.description
    if body.content is not None:
        hook.content = body.content
    if body.enabled is not None:
        hook.enabled = body.enabled
    if body.priority is not None:
        hook.priority = body.priority
    await db.commit()
    invalidate_hook_cache()
    await db.refresh(hook)
    return hook


@router.delete("/{hook_id}", status_code=204)
async def delete_hook(hook_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Hook).where(Hook.public_id == hook_id, Hook.user_id == user.id))
    hook = result.scalar_one_or_none()
    if not hook:
        raise HTTPException(status_code=404, detail="Hook not found")
    if hook.builtin:
        raise HTTPException(status_code=403, detail="Cannot delete built-in hooks")
    await db.delete(hook)
    await db.commit()
    invalidate_hook_cache()
