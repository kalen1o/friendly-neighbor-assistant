from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.chat import Chat
from app.models.folder import Folder
from app.models.user import User
from app.schemas.folder import FolderCreate, FolderOut, FolderUpdate

router = APIRouter(prefix="/api/folders", tags=["folders"])

MAX_DEPTH = 2


async def _resolve_folder(
    db: AsyncSession, public_id: str, user_id: int
) -> Folder:
    """Look up a folder by public_id, ensuring it belongs to the user."""
    result = await db.execute(
        select(Folder).where(Folder.public_id == public_id, Folder.user_id == user_id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


async def _get_depth(db: AsyncSession, folder_id: int) -> int:
    """Calculate depth of a folder (root = 1)."""
    depth = 1
    current_id = folder_id
    while True:
        result = await db.execute(
            select(Folder.parent_id).where(Folder.id == current_id)
        )
        parent_id = result.scalar_one_or_none()
        if parent_id is None:
            break
        depth += 1
        current_id = parent_id
    return depth


async def _get_subtree_max_depth(db: AsyncSession, folder_id: int) -> int:
    """Get the max depth of descendants below a folder (0 if no children)."""
    max_depth = 0
    queue = [(folder_id, 0)]
    while queue:
        current_id, level = queue.pop(0)
        result = await db.execute(
            select(Folder.id).where(Folder.parent_id == current_id)
        )
        children = result.scalars().all()
        for child_id in children:
            child_depth = level + 1
            if child_depth > max_depth:
                max_depth = child_depth
            queue.append((child_id, child_depth))
    return max_depth


async def _get_descendant_ids(db: AsyncSession, folder_id: int) -> set:
    """Get all descendant folder IDs (for cycle detection)."""
    descendants = set()
    queue = [folder_id]
    while queue:
        current_id = queue.pop(0)
        result = await db.execute(
            select(Folder.id).where(Folder.parent_id == current_id)
        )
        children = result.scalars().all()
        for child_id in children:
            descendants.add(child_id)
            queue.append(child_id)
    return descendants


@router.get("", response_model=List[FolderOut])
async def list_folders(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all user's folders as a flat list. Frontend builds tree."""
    result = await db.execute(
        select(Folder)
        .where(Folder.user_id == user.id)
        .order_by(Folder.position, Folder.name)
    )
    folders = result.scalars().all()

    # Batch-load chat counts
    count_result = await db.execute(
        select(Chat.folder_id, func.count(Chat.id))
        .where(Chat.user_id == user.id, Chat.folder_id != None)  # noqa: E711
        .group_by(Chat.folder_id)
    )
    counts = dict(count_result.all())

    out = []
    for f in folders:
        parent_public_id = None
        if f.parent_id:
            parent_result = await db.execute(
                select(Folder.public_id).where(Folder.id == f.parent_id)
            )
            parent_public_id = parent_result.scalar_one_or_none()
        out.append(
            FolderOut(
                id=f.public_id,
                name=f.name,
                parent_id=parent_public_id,
                color=f.color,
                icon=f.icon,
                position=f.position,
                chat_count=counts.get(f.id, 0),
            )
        )

    return out


@router.post("", status_code=201, response_model=FolderOut)
async def create_folder(
    body: FolderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    parent_internal_id = None
    parent_public_id = None

    if body.parent_id:
        parent = await _resolve_folder(db, body.parent_id, user.id)
        parent_internal_id = parent.id
        parent_public_id = parent.public_id

        parent_depth = await _get_depth(db, parent.id)
        if parent_depth >= MAX_DEPTH:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum folder depth of {MAX_DEPTH} exceeded",
            )

    # Check unique name among siblings
    name_check = select(Folder).where(
        Folder.user_id == user.id,
        Folder.name == body.name,
    )
    if parent_internal_id:
        name_check = name_check.where(Folder.parent_id == parent_internal_id)
    else:
        name_check = name_check.where(Folder.parent_id == None)  # noqa: E711

    existing = await db.execute(name_check)
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Folder '{body.name}' already exists at this level",
        )

    # Auto-position at end
    pos_query = select(func.coalesce(func.max(Folder.position), -1)).where(
        Folder.user_id == user.id,
    )
    if parent_internal_id:
        pos_query = pos_query.where(Folder.parent_id == parent_internal_id)
    else:
        pos_query = pos_query.where(Folder.parent_id == None)  # noqa: E711

    pos_result = await db.execute(pos_query)
    next_position = pos_result.scalar() + 1

    folder = Folder(
        user_id=user.id,
        parent_id=parent_internal_id,
        name=body.name,
        color=body.color,
        icon=body.icon,
        position=next_position,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)

    return FolderOut(
        id=folder.public_id,
        name=folder.name,
        parent_id=parent_public_id,
        color=folder.color,
        icon=folder.icon,
        position=folder.position,
        chat_count=0,
    )


@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: str,
    body: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = await _resolve_folder(db, folder_id, user.id)

    if body.parent_id is not None:
        if body.parent_id == "root":
            folder.parent_id = None
        else:
            new_parent = await _resolve_folder(db, body.parent_id, user.id)

            descendants = await _get_descendant_ids(db, folder.id)
            if new_parent.id in descendants or new_parent.id == folder.id:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot move a folder into its own descendant",
                )

            new_parent_depth = await _get_depth(db, new_parent.id)
            subtree_depth = await _get_subtree_max_depth(db, folder.id)
            if new_parent_depth + 1 + subtree_depth > MAX_DEPTH:
                raise HTTPException(
                    status_code=400,
                    detail=f"Maximum folder depth of {MAX_DEPTH} exceeded",
                )

            folder.parent_id = new_parent.id

    if body.name is not None:
        name_check = select(Folder).where(
            Folder.user_id == user.id,
            Folder.name == body.name,
            Folder.id != folder.id,
        )
        if folder.parent_id:
            name_check = name_check.where(Folder.parent_id == folder.parent_id)
        else:
            name_check = name_check.where(Folder.parent_id == None)  # noqa: E711
        existing = await db.execute(name_check)
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Folder '{body.name}' already exists at this level",
            )
        folder.name = body.name

    if body.color is not None:
        folder.color = body.color
    if body.icon is not None:
        folder.icon = body.icon
    if body.position is not None:
        folder.position = body.position

    await db.commit()
    await db.refresh(folder)

    parent_public_id = None
    if folder.parent_id:
        result = await db.execute(
            select(Folder.public_id).where(Folder.id == folder.parent_id)
        )
        parent_public_id = result.scalar_one_or_none()

    count_result = await db.execute(
        select(func.count(Chat.id)).where(Chat.folder_id == folder.id)
    )
    chat_count = count_result.scalar()

    return FolderOut(
        id=folder.public_id,
        name=folder.name,
        parent_id=parent_public_id,
        color=folder.color,
        icon=folder.icon,
        position=folder.position,
        chat_count=chat_count,
    )


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: str,
    action: str = Query(..., pattern="^(move_up|delete_all)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = await _resolve_folder(db, folder_id, user.id)

    if action == "move_up":
        child_folders_result = await db.execute(
            select(Folder).where(Folder.parent_id == folder.id)
        )
        for child in child_folders_result.scalars().all():
            child.parent_id = folder.parent_id

        child_chats_result = await db.execute(
            select(Chat).where(Chat.folder_id == folder.id)
        )
        for chat in child_chats_result.scalars().all():
            chat.folder_id = folder.parent_id

        await db.flush()

    await db.delete(folder)
    await db.commit()
