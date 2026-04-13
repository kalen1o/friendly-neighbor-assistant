# Conversation Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nested folder system for organizing conversations in the sidebar, with drag-and-drop, color/icon customization, and two view modes (All Chats / Folders).

**Architecture:** New `folders` table with self-referencing `parent_id` for nesting. `chats.folder_id` FK links chats to folders. Backend handles CRUD + tree validation (cycle prevention, max depth 5). Frontend renders a collapsible tree in the sidebar with drag-and-drop via `@dnd-kit`. Two sidebar views: flat "All Chats" (existing) and "Folders" tree view, persisted in localStorage.

**Tech Stack:** SQLAlchemy model + Alembic migration, FastAPI router, Pydantic schemas, React + @dnd-kit/core + @dnd-kit/sortable, shadcn/ui components, lucide-react icons.

---

## File Structure

### Backend (new files)
- `backend/app/models/folder.py` — Folder SQLAlchemy model
- `backend/app/schemas/folder.py` — Pydantic request/response schemas
- `backend/app/routers/folders.py` — Folder CRUD endpoints
- `backend/alembic/versions/0022_create_folders_table.py` — Migration

### Backend (modified files)
- `backend/app/models/chat.py` — Add `folder_id` FK to Chat
- `backend/app/schemas/chat.py` — Add `folder_id` to ChatSummary, ChatUpdate, ChatCreate
- `backend/app/routers/chats.py` — Add `folder_id` filter to list_chats, support folder_id in update
- `backend/app/main.py` — Register folders router

### Frontend (new files)
- `frontend/src/components/folder-tree.tsx` — Collapsible folder tree with drag-and-drop
- `frontend/src/components/folder-context-menu.tsx` — Right-click menu for folders (rename, delete, customize, new sub-folder)
- `frontend/src/components/folder-delete-dialog.tsx` — Delete confirmation with two options
- `frontend/src/components/folder-customize-popover.tsx` — Color palette + icon picker popover
- `frontend/src/components/move-to-folder-menu.tsx` — "Move to folder" submenu for chat context menu

### Frontend (modified files)
- `frontend/src/lib/api.ts` — Add folder types + API functions
- `frontend/src/components/sidebar-content.tsx` — Add view toggle, integrate folder tree
- `frontend/src/components/chat-list.tsx` — Add folder indicator + "Move to folder" action

---

### Task 1: Database Migration

**Files:**
- Create: `backend/alembic/versions/0022_create_folders_table.py`

- [ ] **Step 1: Create migration file**

```python
"""create folders table and add folder_id to chats

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("folders.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "parent_id", "name", name="uq_folder_user_parent_name"),
    )

    op.add_column(
        "chats",
        sa.Column(
            "folder_id",
            sa.Integer(),
            sa.ForeignKey("folders.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("chats", "folder_id")
    op.drop_table("folders")
```

- [ ] **Step 2: Run migration**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant && make migrate`
Expected: Migration 0022 applies successfully.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0022_create_folders_table.py
git commit -m "feat: add folders migration (0022)"
```

---

### Task 2: Folder Model

**Files:**
- Create: `backend/app/models/folder.py`
- Modify: `backend/app/models/chat.py`

- [ ] **Step 1: Create Folder model**

Create `backend/app/models/folder.py`:

```python
from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.utils.ids import generate_public_id

if TYPE_CHECKING:
    from app.models.chat import Chat


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (
        UniqueConstraint("user_id", "parent_id", "name", name="uq_folder_user_parent_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "fld")
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), default=None, nullable=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    icon: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    children: Mapped[List["Folder"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="Folder.position, Folder.name",
    )
    parent: Mapped[Optional["Folder"]] = relationship(
        back_populates="children", remote_side=[id]
    )
    chats: Mapped[List["Chat"]] = relationship(
        back_populates="folder", foreign_keys="Chat.folder_id"
    )
```

- [ ] **Step 2: Add folder_id to Chat model**

In `backend/app/models/chat.py`, add the `folder_id` column and relationship:

After the `context_summary` mapped_column, add:
```python
    folder_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), default=None, nullable=True
    )
```

Add the relationship (after `messages` relationship):
```python
    folder: Mapped[Optional["Folder"]] = relationship(
        "Folder", back_populates="chats", foreign_keys=[folder_id]
    )
```

Add import at top (inside TYPE_CHECKING):
```python
    from app.models.folder import Folder
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/folder.py backend/app/models/chat.py
git commit -m "feat: add Folder model and folder_id to Chat"
```

---

### Task 3: Folder Schemas

**Files:**
- Create: `backend/app/schemas/folder.py`
- Modify: `backend/app/schemas/chat.py`

- [ ] **Step 1: Create folder schemas**

Create `backend/app/schemas/folder.py`:

```python
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FolderCreate(BaseModel):
    name: str = Field(max_length=100)
    parent_id: Optional[str] = None  # public_id of parent folder, null = root
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    parent_id: Optional[str] = None  # public_id or "root" to move to root level
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)
    position: Optional[int] = None


class FolderOut(BaseModel):
    id: str
    name: str
    parent_id: Optional[str]
    color: Optional[str]
    icon: Optional[str]
    position: int
    chat_count: int

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Update ChatSummary to include folder_id**

In `backend/app/schemas/chat.py`, update `ChatSummary`:

```python
class ChatSummary(BaseModel):
    id: str = Field(validation_alias="public_id")
    title: Optional[str]
    updated_at: datetime
    folder_id: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}
```

Update `ChatUpdate` to support optional folder_id:

```python
class ChatUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None  # public_id of folder, or null to unfile
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/folder.py backend/app/schemas/chat.py
git commit -m "feat: add folder schemas, update chat schemas with folder_id"
```

---

### Task 4: Folder Router

**Files:**
- Create: `backend/app/routers/folders.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the folder router**

Create `backend/app/routers/folders.py`:

```python
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

MAX_DEPTH = 5


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
    # BFS to find max depth below this folder
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


async def _get_ancestor_ids(db: AsyncSession, folder_id: int) -> set:
    """Get all ancestor IDs of a folder (for cycle detection)."""
    ancestors = set()
    current_id = folder_id
    while True:
        result = await db.execute(
            select(Folder.parent_id).where(Folder.id == current_id)
        )
        parent_id = result.scalar_one_or_none()
        if parent_id is None:
            break
        ancestors.add(parent_id)
        current_id = parent_id
    return ancestors


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


def _folder_to_out(folder: Folder, chat_count: int) -> FolderOut:
    return FolderOut(
        id=folder.public_id,
        name=folder.name,
        parent_id=folder.parent.public_id if folder.parent else None,
        color=folder.color,
        icon=folder.icon,
        position=folder.position,
        chat_count=chat_count,
    )


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
        # Eagerly load parent for public_id resolution
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

        # Check depth
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
    pos_result = await db.execute(
        select(func.coalesce(func.max(Folder.position), -1)).where(
            Folder.user_id == user.id,
            Folder.parent_id == parent_internal_id
            if parent_internal_id
            else Folder.parent_id == None,  # noqa: E711
        )
    )
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

    # Handle parent_id change (move folder)
    if body.parent_id is not None:
        if body.parent_id == "root":
            folder.parent_id = None
        else:
            new_parent = await _resolve_folder(db, body.parent_id, user.id)

            # Cycle detection: new parent must not be a descendant
            descendants = await _get_descendant_ids(db, folder.id)
            if new_parent.id in descendants or new_parent.id == folder.id:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot move a folder into its own descendant",
                )

            # Depth check: depth of new_parent + subtree depth of folder must not exceed MAX_DEPTH
            new_parent_depth = await _get_depth(db, new_parent.id)
            subtree_depth = await _get_subtree_max_depth(db, folder.id)
            if new_parent_depth + 1 + subtree_depth > MAX_DEPTH:
                raise HTTPException(
                    status_code=400,
                    detail=f"Maximum folder depth of {MAX_DEPTH} exceeded",
                )

            folder.parent_id = new_parent.id

    if body.name is not None:
        # Check unique name among new siblings
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
    action: str = Query(..., regex="^(move_up|delete_all)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = await _resolve_folder(db, folder_id, user.id)

    if action == "move_up":
        # Move child folders to this folder's parent
        child_folders_result = await db.execute(
            select(Folder).where(Folder.parent_id == folder.id)
        )
        for child in child_folders_result.scalars().all():
            child.parent_id = folder.parent_id

        # Move child chats to this folder's parent (or null = unfiled)
        child_chats_result = await db.execute(
            select(Chat).where(Chat.folder_id == folder.id)
        )
        for chat in child_chats_result.scalars().all():
            chat.folder_id = folder.parent_id

        await db.flush()

    # delete_all: CASCADE on parent_id handles sub-folders,
    # SET NULL on chat.folder_id handles chats
    await db.delete(folder)
    await db.commit()
```

- [ ] **Step 2: Register router in main.py**

In `backend/app/main.py`, add import and include:

Add import after existing router imports:
```python
from app.routers.folders import router as folders_router
```

Add after `app.include_router(uploads_router)`:
```python
app.include_router(folders_router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/folders.py backend/app/main.py
git commit -m "feat: add folder CRUD router with tree validation"
```

---

### Task 5: Update Chat Router for Folder Support

**Files:**
- Modify: `backend/app/routers/chats.py`
- Modify: `backend/app/schemas/chat.py`

- [ ] **Step 1: Update ChatSummary to include folder_id**

The `ChatSummary` schema uses `from_attributes` mode and `validation_alias`. The `folder_id` on the Chat model is an internal int, but we need the public_id string. Since `ChatSummary` is constructed from ORM objects directly, we need a custom approach.

Update the `list_chats` endpoint in `backend/app/routers/chats.py` to manually build ChatSummary with folder public IDs. First, update the import to include Folder:

Add to imports:
```python
from app.models.folder import Folder
```

- [ ] **Step 2: Add folder_id filter to list_chats**

In `backend/app/routers/chats.py`, update the `list_chats` endpoint to accept an optional `folder_id` query parameter:

```python
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

    chat_summaries = [
        {
            "public_id": c.public_id,
            "title": c.title,
            "updated_at": c.updated_at,
            "folder_id": folder_map.get(c.folder_id) if c.folder_id else None,
        }
        for c in chats
    ]

    return ChatListResponse(chats=chat_summaries, next_cursor=next_cursor, has_more=has_more)
```

- [ ] **Step 3: Support folder_id in chat update**

Update `ChatUpdate` schema in `backend/app/schemas/chat.py`:

```python
class ChatUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None  # public_id, or "none" to unfile
```

Update the `update_chat` endpoint in `backend/app/routers/chats.py`:

```python
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

    await db.commit()
    await db.refresh(chat)
    await db.refresh(chat, ["messages"])
    return ChatDetail.from_chat(chat)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/chats.py backend/app/schemas/chat.py
git commit -m "feat: add folder_id filter and update support to chat endpoints"
```

---

### Task 6: Frontend API Types and Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add folder types and API functions**

Add to `frontend/src/lib/api.ts` after the existing types section:

```typescript
// ── Folder Types ──

export interface FolderOut {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  position: number;
  chat_count: number;
}

export interface FolderCreate {
  name: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface FolderUpdate {
  name?: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

// ── Folder CRUD ──

export async function listFolders(): Promise<FolderOut[]> {
  const res = await authFetch(`${API_BASE}/api/folders`);
  if (!res.ok) throw new Error("Failed to list folders");
  return res.json();
}

export async function createFolder(folder: FolderCreate): Promise<FolderOut> {
  const res = await authFetch(`${API_BASE}/api/folders`, {
    method: "POST",
    body: JSON.stringify(folder),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create folder" }));
    throw new Error(err.detail || "Failed to create folder");
  }
  return res.json();
}

export async function updateFolder(
  folderId: string,
  updates: FolderUpdate
): Promise<FolderOut> {
  const res = await authFetch(`${API_BASE}/api/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update folder" }));
    throw new Error(err.detail || "Failed to update folder");
  }
  return res.json();
}

export async function deleteFolder(
  folderId: string,
  action: "move_up" | "delete_all"
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/folders/${folderId}?action=${action}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete folder");
}
```

- [ ] **Step 2: Update ChatSummary type**

Update the existing `ChatSummary` interface:

```typescript
export interface ChatSummary {
  id: string;
  title: string | null;
  updated_at: string;
  folder_id: string | null;
}
```

- [ ] **Step 3: Update listChats to support folder_id filter**

```typescript
export async function listChats(
  cursor?: string | null,
  limit = 20,
  folderId?: string | null
): Promise<ChatListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (folderId !== undefined && folderId !== null) params.set("folder_id", folderId);
  const res = await authFetch(`${API_BASE}/api/chats?${params}`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}
```

- [ ] **Step 4: Update updateChat to support folder_id**

```typescript
export async function updateChat(
  chatId: string,
  title?: string,
  folderId?: string | null
): Promise<ChatDetail> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (folderId !== undefined) body.folder_id = folderId === null ? "none" : folderId;
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add folder API types and functions, update chat API"
```

---

### Task 7: Folder Tree Component

**Files:**
- Create: `frontend/src/components/folder-tree.tsx`

- [ ] **Step 1: Install @dnd-kit dependencies**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 2: Create the folder tree component**

Create `frontend/src/components/folder-tree.tsx`. This component renders the collapsible folder tree in the sidebar, handling expand/collapse, drag-and-drop of chats into folders, and context menu triggers.

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FolderOut, ChatSummary } from "@/lib/api";
import {
  createFolder,
  updateFolder,
  deleteFolder,
  updateChat,
} from "@/lib/api";
import { FolderDeleteDialog } from "@/components/folder-delete-dialog";
import { FolderCustomizePopover } from "@/components/folder-customize-popover";

interface FolderNode {
  folder: FolderOut;
  children: FolderNode[];
}

function buildTree(folders: FolderOut[]): FolderNode[] {
  const map = new Map<string | null, FolderNode[]>();
  const nodeMap = new Map<string, FolderNode>();

  for (const f of folders) {
    const node: FolderNode = { folder: f, children: [] };
    nodeMap.set(f.id, node);
  }

  for (const f of folders) {
    const node = nodeMap.get(f.id)!;
    const parentId = f.parent_id;
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId)!.push(node);
  }

  // Attach children
  for (const node of nodeMap.values()) {
    node.children = map.get(node.folder.id) || [];
    node.children.sort((a, b) => a.folder.position - b.folder.position);
  }

  const roots = map.get(null) || [];
  roots.sort((a, b) => a.folder.position - b.folder.position);
  return roots;
}

interface FolderTreeProps {
  folders: FolderOut[];
  chats: ChatSummary[];
  activeChatId: string | null;
  onRefresh: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
}

export function FolderTree({
  folders,
  chats,
  activeChatId,
  onRefresh,
  onDeleteChat,
  onRenameChat,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("folder-expanded-state");
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    localStorage.setItem(
      "folder-expanded-state",
      JSON.stringify([...expanded])
    );
  }, [expanded]);

  const toggleExpanded = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const tree = buildTree(folders);

  // Group chats by folder
  const chatsByFolder = new Map<string | null, ChatSummary[]>();
  for (const chat of chats) {
    const key = chat.folder_id || null;
    if (!chatsByFolder.has(key)) chatsByFolder.set(key, []);
    chatsByFolder.get(key)!.push(chat);
  }

  const unfiledChats = chatsByFolder.get(null) || [];

  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <FolderNodeItem
          key={node.folder.id}
          node={node}
          depth={0}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          chatsByFolder={chatsByFolder}
          activeChatId={activeChatId}
          onRefresh={onRefresh}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
        />
      ))}
      {unfiledChats.length > 0 && (
        <>
          <div className="mt-2 px-3 py-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              Unfiled
            </p>
          </div>
          {unfiledChats.map((chat) => (
            <ChatInFolder
              key={chat.id}
              chat={chat}
              isActive={chat.id === activeChatId}
              depth={0}
              folders={folders}
              onDelete={() => onDeleteChat(chat.id)}
              onRename={(title) => onRenameChat(chat.id, title)}
              onMoveToFolder={async (folderId) => {
                await updateChat(chat.id, undefined, folderId);
                onRefresh();
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function FolderNodeItem({
  node,
  depth,
  expanded,
  toggleExpanded,
  chatsByFolder,
  activeChatId,
  onRefresh,
  onDeleteChat,
  onRenameChat,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  chatsByFolder: Map<string | null, ChatSummary[]>;
  activeChatId: string | null;
  onRefresh: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
}) {
  const { folder, children } = node;
  const isExpanded = expanded.has(folder.id);
  const folderChats = chatsByFolder.get(folder.id) || [];
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [dragOver, setDragOver] = useState(false);

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) {
      await updateFolder(folder.id, { name: trimmed });
      onRefresh();
    }
    setRenaming(false);
  };

  const handleCreateSubFolder = async () => {
    await createFolder({ name: "New Folder", parent_id: folder.id });
    if (!isExpanded) toggleExpanded(folder.id);
    onRefresh();
  };

  const handleDelete = async (action: "move_up" | "delete_all") => {
    await deleteFolder(folder.id, action);
    onRefresh();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const chatId = e.dataTransfer.getData("text/chat-id");
    const sourceFolderId = e.dataTransfer.getData("text/folder-id");
    if (chatId) {
      await updateChat(chatId, undefined, folder.id);
      onRefresh();
    } else if (sourceFolderId && sourceFolderId !== folder.id) {
      await updateFolder(sourceFolderId, { parent_id: folder.id });
      onRefresh();
    }
  };

  const Icon = isExpanded ? FolderOpen : FolderIcon;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer",
          dragOver && "ring-2 ring-primary/50 bg-primary/5"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => toggleExpanded(folder.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/folder-id", folder.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center"
        >
          {folder.icon ? (
            <span className="text-sm">{folder.icon}</span>
          ) : (
            <Icon
              className="h-4 w-4"
              style={folder.color ? { color: folder.color } : undefined}
            />
          )}
        </div>
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={handleRename}
            onClick={(e) => e.stopPropagation()}
            className="h-5 flex-1 truncate border-0 bg-transparent p-0 text-sm outline-none ring-0 focus:ring-0"
          />
        ) : (
          <span className="flex-1 truncate font-medium">{folder.name}</span>
        )}
        {folder.chat_count > 0 && !isExpanded && (
          <span className="text-[10px] text-muted-foreground/50">
            {folder.chat_count}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuItem onClick={() => handleCreateSubFolder()}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              New sub-folder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setRenameValue(folder.name);
                setRenaming(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCustomizeOpen(true)}>
              Customize
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <>
          {children.map((child) => (
            <FolderNodeItem
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              chatsByFolder={chatsByFolder}
              activeChatId={activeChatId}
              onRefresh={onRefresh}
              onDeleteChat={onDeleteChat}
              onRenameChat={onRenameChat}
            />
          ))}
          {folderChats.map((chat) => (
            <ChatInFolder
              key={chat.id}
              chat={chat}
              isActive={chat.id === activeChatId}
              depth={depth + 1}
              folders={[]}
              onDelete={() => onDeleteChat(chat.id)}
              onRename={(title) => onRenameChat(chat.id, title)}
              onMoveToFolder={async (folderId) => {
                await updateChat(chat.id, undefined, folderId);
                onRefresh();
              }}
            />
          ))}
          {children.length === 0 && folderChats.length === 0 && (
            <p
              className="py-1 text-xs text-muted-foreground/40"
              style={{ paddingLeft: `${(depth + 1) * 16 + 24}px` }}
            >
              Empty folder
            </p>
          )}
        </>
      )}

      <FolderDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        folderName={folder.name}
        onDelete={handleDelete}
      />
      <FolderCustomizePopover
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        color={folder.color}
        icon={folder.icon}
        onUpdate={async (color, icon) => {
          await updateFolder(folder.id, { color, icon });
          onRefresh();
        }}
      />
    </>
  );
}

function ChatInFolder({
  chat,
  isActive,
  depth,
  folders,
  onDelete,
  onRename,
  onMoveToFolder,
}: {
  chat: ChatSummary;
  isActive: boolean;
  depth: number;
  folders: FolderOut[];
  onDelete: () => void;
  onRename: (title: string) => void;
  onMoveToFolder: (folderId: string | null) => void;
}) {
  const router = useRouter();

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center rounded-lg py-1.5 pr-2 text-sm transition-colors hover:bg-accent",
        isActive && "bg-accent"
      )}
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
      onClick={() => router.push(`/chat/${chat.id}`)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/chat-id", chat.id);
      }}
    >
      <span className="flex-1 truncate">
        {chat.title || "New Chat"}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/folder-tree.tsx
git commit -m "feat: add folder tree component with drag-and-drop"
```

---

### Task 8: Folder Delete Dialog and Customize Popover

**Files:**
- Create: `frontend/src/components/folder-delete-dialog.tsx`
- Create: `frontend/src/components/folder-customize-popover.tsx`

- [ ] **Step 1: Create FolderDeleteDialog**

Create `frontend/src/components/folder-delete-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FolderDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  onDelete: (action: "move_up" | "delete_all") => Promise<void>;
}

export function FolderDeleteDialog({
  open,
  onOpenChange,
  folderName,
  onDelete,
}: FolderDeleteDialogProps) {
  const [loading, setLoading] = useState(false);

  const handle = async (action: "move_up" | "delete_all") => {
    setLoading(true);
    try {
      await onDelete(action);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{folderName}&rdquo;?</DialogTitle>
          <DialogDescription>
            Choose what happens to the conversations and sub-folders inside.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={() => handle("move_up")}
          >
            Move contents to parent folder
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            disabled={loading}
            onClick={() => handle("delete_all")}
          >
            Delete folder and all conversations
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create FolderCustomizePopover**

Create `frontend/src/components/folder-customize-popover.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const COLORS = [
  { name: "Default", value: "" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Green", value: "#22c55e" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

const ICONS = [
  "", "📁", "💼", "🏠", "🎯", "🔬", "📚", "💡", "🛠️", "🎨",
  "🚀", "📝", "🧪", "💬", "🌐", "📊", "🔒", "❤️", "⭐", "🎓",
];

interface FolderCustomizePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: string | null;
  icon: string | null;
  onUpdate: (color: string | null, icon: string | null) => Promise<void>;
}

export function FolderCustomizePopover({
  open,
  onOpenChange,
  color,
  icon,
  onUpdate,
}: FolderCustomizePopoverProps) {
  const [selectedColor, setSelectedColor] = useState(color || "");
  const [selectedIcon, setSelectedIcon] = useState(icon || "");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(
        selectedColor || null,
        selectedIcon || null
      );
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Customize Folder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Color</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSelectedColor(c.value)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all",
                    selectedColor === c.value
                      ? "border-foreground scale-110"
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                  title={c.name}
                >
                  {c.value ? (
                    <div
                      className="h-5 w-5 rounded-full"
                      style={{ backgroundColor: c.value }}
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-dashed border-muted-foreground/30" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Icon</p>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setSelectedIcon(ic)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all",
                    selectedIcon === ic
                      ? "bg-primary/10 ring-2 ring-primary/50"
                      : "hover:bg-accent"
                  )}
                >
                  {ic || "—"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/folder-delete-dialog.tsx frontend/src/components/folder-customize-popover.tsx
git commit -m "feat: add folder delete dialog and customize popover"
```

---

### Task 9: Update Sidebar with View Toggle and Folder Integration

**Files:**
- Modify: `frontend/src/components/sidebar-content.tsx`

- [ ] **Step 1: Update SidebarContent imports and state**

Add to the imports in `sidebar-content.tsx`:

```tsx
import { FolderPlus, List, FolderTree as FolderTreeIcon } from "lucide-react";
import { FolderTree } from "@/components/folder-tree";
import {
  listFolders,
  createFolder,
  type FolderOut,
} from "@/lib/api";
```

- [ ] **Step 2: Add folder state and view toggle to SidebarContent**

Inside the `SidebarContent` function, add state for view mode and folders:

After the existing state declarations (`chats`, `isLoading`, etc.), add:

```tsx
const [viewMode, setViewMode] = useState<"all" | "folders">(() => {
  try {
    return (localStorage.getItem("sidebar-view-mode") as "all" | "folders") || "all";
  } catch {
    return "all";
  }
});
const [folders, setFolders] = useState<FolderOut[]>([]);

useEffect(() => {
  localStorage.setItem("sidebar-view-mode", viewMode);
}, [viewMode]);

const fetchFolders = useCallback(async () => {
  if (!isAuthenticated) return;
  try {
    const data = await listFolders();
    setFolders(data);
  } catch (e) {
    console.error("Failed to fetch folders:", e);
  }
}, [isAuthenticated]);

useEffect(() => {
  fetchFolders();
}, [fetchFolders]);

const handleRefreshAll = useCallback(() => {
  fetchChats();
  fetchFolders();
}, [fetchChats, fetchFolders]);

const handleNewFolder = async () => {
  const authed = await requireAuth();
  if (!authed) return;
  try {
    await createFolder({ name: "New Folder" });
    await fetchFolders();
  } catch (e) {
    console.error("Failed to create folder:", e);
  }
};
```

- [ ] **Step 3: Replace the "Recent" section with view toggle and folder-aware rendering**

Replace the section that starts with `{isAuthenticated && (` (the "Recent" label, chat list, loading more indicator, and sentinel) with a new version that includes the view toggle:

```tsx
{isAuthenticated && (
  <>
    <div className="flex items-center justify-between px-5 pb-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setViewMode("all")}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
            viewMode === "all"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground/50 hover:text-muted-foreground"
          )}
        >
          All
        </button>
        <button
          onClick={() => setViewMode("folders")}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
            viewMode === "folders"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground/50 hover:text-muted-foreground"
          )}
        >
          Folders
        </button>
      </div>
      {viewMode === "folders" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground/50 hover:text-muted-foreground"
          onClick={handleNewFolder}
          title="New folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>

    <div className="flex-1 overflow-y-auto px-3 pb-3">
      {isLoading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg px-3 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-1.5 h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : viewMode === "all" ? (
        <>
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            onDelete={handleDelete}
            onRename={handleRename}
          />
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          <div ref={sentinelRef} className="h-1" />
        </>
      ) : (
        <FolderTree
          folders={folders}
          chats={chats}
          activeChatId={activeChatId}
          onRefresh={handleRefreshAll}
          onDeleteChat={handleDelete}
          onRenameChat={handleRename}
        />
      )}
    </div>
  </>
)}
```

- [ ] **Step 4: Add folders-cleared event listener**

In the existing `useEffect` that handles `chat-title-updated` and `chats-cleared` events, add a listener for folder refresh:

```tsx
window.addEventListener("chats-cleared", handleClear);
window.addEventListener("folders-changed", () => fetchFolders());
```

And in the cleanup:
```tsx
window.removeEventListener("folders-changed", () => fetchFolders());
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar-content.tsx
git commit -m "feat: add view toggle and folder tree integration to sidebar"
```

---

### Task 10: Update Chat handleRename Call Signature

**Files:**
- Modify: `frontend/src/components/sidebar-content.tsx`

- [ ] **Step 1: Update handleRename to match new updateChat signature**

The `updateChat` function now takes `(chatId, title?, folderId?)` instead of `(chatId, title)`. Update the `handleRename` call in `SidebarContent`:

```tsx
const handleRename = async (chatId: string, title: string) => {
  try {
    await updateChat(chatId, title);
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title } : c))
    );
  } catch (e) {
    console.error("Failed to rename chat:", e);
  }
};
```

This should work as-is since `folderId` is optional and defaults to `undefined`, meaning it won't be sent. Verify the existing call compiles correctly.

- [ ] **Step 2: Add handleDrop to root area for unfiling chats**

In the "Folders" view, add a drop zone for unfiling chats. Add this just after the FolderTree component inside the folders view:

```tsx
<div
  className="mt-2 min-h-[40px] rounded-lg border-2 border-dashed border-transparent transition-colors"
  onDragOver={(e) => {
    e.preventDefault();
    e.currentTarget.classList.add("border-muted-foreground/30");
  }}
  onDragLeave={(e) => {
    e.currentTarget.classList.remove("border-muted-foreground/30");
  }}
  onDrop={async (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("border-muted-foreground/30");
    const chatId = e.dataTransfer.getData("text/chat-id");
    if (chatId) {
      await updateChat(chatId, undefined, null);
      handleRefreshAll();
    }
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar-content.tsx
git commit -m "feat: add drop zone for unfiling chats in folder view"
```

---

### Task 11: End-to-End Smoke Test

- [ ] **Step 1: Start the dev stack**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant && make up`
Expected: All three containers start successfully.

- [ ] **Step 2: Run migration**

Run: `make migrate`
Expected: Migration 0022 applies.

- [ ] **Step 3: Test folder CRUD via curl**

```bash
# Create folder
curl -s -X POST http://localhost:8000/api/folders \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name": "Work"}' | python3 -m json.tool

# List folders
curl -s http://localhost:8000/api/folders -b cookies.txt | python3 -m json.tool

# Create sub-folder
curl -s -X POST http://localhost:8000/api/folders \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name": "Project X", "parent_id": "<FOLDER_ID>"}' | python3 -m json.tool

# Delete with move_up
curl -s -X DELETE "http://localhost:8000/api/folders/<FOLDER_ID>?action=move_up" -b cookies.txt
```

Expected: All operations succeed with correct responses.

- [ ] **Step 4: Test frontend**

Open `http://localhost:3000`, log in, and verify:
1. View toggle appears ("All" / "Folders")
2. "All" view shows flat chat list (same as before)
3. "Folders" view shows folder tree
4. Can create new folder via the + button
5. Can drag a chat into a folder
6. Folder expand/collapse works
7. Context menu: rename, customize, delete all work
8. Delete dialog shows both options

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address smoke test issues for folder feature"
```
