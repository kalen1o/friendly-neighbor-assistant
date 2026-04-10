# Chat Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to share a read-only snapshot of a chat via a link, with public or authenticated visibility and revocable links.

**Architecture:** New `SharedChat` model stores a frozen JSON snapshot of messages. A dedicated router handles share CRUD and public viewing. Frontend gets a `/shared/[id]` page for read-only display and a share dialog in the chat UI.

**Tech Stack:** SQLAlchemy model, Alembic migration, FastAPI router, Pydantic schemas, Next.js page + dialog component.

---

### Task 1: SharedChat Model + Migration

**Files:**
- Create: `backend/app/models/shared_chat.py`
- Create: `backend/alembic/versions/0015_create_shared_chats_table.py`

- [ ] **Step 1: Create the SharedChat model**

Create `backend/app/models/shared_chat.py`:

```python
from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class SharedChat(Base):
    __tablename__ = "shared_chats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "share")
    )
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    visibility: Mapped[str] = mapped_column(String(20))  # "public" or "authenticated"
    active: Mapped[bool] = mapped_column(default=True)
    title: Mapped[Optional[str]] = mapped_column(default=None)
    snapshot: Mapped[str] = mapped_column(Text)  # JSON array of messages
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 2: Create the migration**

Create `backend/alembic/versions/0015_create_shared_chats_table.py`:

```python
"""create shared_chats table

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shared_chats",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("visibility", sa.String(20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("snapshot", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("shared_chats")
```

- [ ] **Step 3: Import model in conftest so tests can create the table**

Add to `backend/tests/conftest.py` with the other model imports:

```python
from app.models.shared_chat import SharedChat  # noqa: F401
```

- [ ] **Step 4: Verify import works**

Run: `cd backend && python3 -c "from app.models.shared_chat import SharedChat; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/shared_chat.py backend/alembic/versions/0015_create_shared_chats_table.py backend/tests/conftest.py
git commit -m "feat: add SharedChat model and migration"
```

---

### Task 2: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/shared_chat.py`

- [ ] **Step 1: Create the schemas**

Create `backend/app/schemas/shared_chat.py`:

```python
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ShareCreate(BaseModel):
    visibility: str = "public"  # "public" or "authenticated"


class ShareOut(BaseModel):
    id: str
    chat_id: str
    visibility: str
    active: bool
    title: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_shared(cls, shared) -> "ShareOut":
        return cls(
            id=shared.public_id,
            chat_id=str(shared.chat_id),
            visibility=shared.visibility,
            active=shared.active,
            title=shared.title,
            created_at=shared.created_at,
        )


class SharedMessage(BaseModel):
    role: str
    content: str
    created_at: datetime


class SharedChatView(BaseModel):
    id: str
    title: Optional[str]
    visibility: str
    created_at: datetime
    messages: List[SharedMessage]
```

- [ ] **Step 2: Verify import works**

Run: `cd backend && python3 -c "from app.schemas.shared_chat import ShareCreate, ShareOut, SharedChatView; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/shared_chat.py
git commit -m "feat: add chat sharing schemas"
```

---

### Task 3: Sharing Router + Tests (TDD)

**Files:**
- Create: `backend/tests/test_sharing.py`
- Create: `backend/app/routers/sharing.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_sharing.py`:

```python
import pytest


@pytest.mark.anyio
async def test_create_public_share(client):
    # Create a chat first
    chat = await client.post("/api/chats", json={"title": "Share Me"})
    chat_id = chat.json()["id"]

    response = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["visibility"] == "public"
    assert data["active"] is True
    assert data["id"].startswith("share-")


@pytest.mark.anyio
async def test_view_public_share(anon_client, client):
    # Create chat and share
    chat = await client.post("/api/chats", json={"title": "Public Chat"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]

    # View without auth
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Public Chat"
    assert isinstance(data["messages"], list)


@pytest.mark.anyio
async def test_view_authenticated_share_requires_auth(anon_client, client):
    chat = await client.post("/api/chats", json={"title": "Auth Chat"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "authenticated"}
    )
    share_id = share.json()["id"]

    # Without auth → 401
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 401

    # With auth → 200
    response = await client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200


@pytest.mark.anyio
async def test_revoke_share(client):
    chat = await client.post("/api/chats", json={"title": "Revoke Me"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]

    # Revoke
    response = await client.delete(f"/api/shared/{share_id}")
    assert response.status_code == 204

    # Now returns 404
    response = await client.get(f"/api/shared/{share_id}")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_list_shares(client):
    chat = await client.post("/api/chats", json={"title": "List Shares"})
    chat_id = chat.json()["id"]
    await client.post(f"/api/chats/{chat_id}/share", json={"visibility": "public"})
    await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "authenticated"}
    )

    response = await client.get(f"/api/chats/{chat_id}/shares")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.anyio
async def test_share_nonexistent_chat(client):
    response = await client.post(
        "/api/chats/chat-nonexist/share", json={"visibility": "public"}
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_snapshot_is_frozen(client, anon_client):
    """Snapshot should contain messages at time of sharing, not after."""
    chat = await client.post("/api/chats", json={"title": "Snapshot"})
    chat_id = chat.json()["id"]

    # Share the empty chat
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]

    # View — should have 0 messages (snapshot was taken when chat was empty)
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200
    assert len(response.json()["messages"]) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python3 -m pytest tests/test_sharing.py -v`
Expected: All tests FAIL (no route defined yet)

- [ ] **Step 3: Create the sharing router**

Create `backend/app/routers/sharing.py`:

```python
import json
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
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
        raise HTTPException(status_code=400, detail="visibility must be 'public' or 'authenticated'")

    result = await db.execute(
        select(Chat)
        .where(Chat.public_id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # Build snapshot
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
        select(SharedChat).where(SharedChat.public_id == share_id, SharedChat.active == True)
    )
    shared = result.scalar_one_or_none()
    if not shared:
        raise HTTPException(status_code=404, detail="Shared chat not found")

    # Check auth for authenticated shares
    if shared.visibility == "authenticated":
        token = access_token
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if not token or decode_access_token(token, settings) is None:
            raise HTTPException(status_code=401, detail="Login required to view this shared chat")

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
```

- [ ] **Step 4: Register the router in main.py**

Add to `backend/app/main.py` after the other router imports:

```python
from app.routers.sharing import router as sharing_router
```

And after the other `include_router` calls:

```python
app.include_router(sharing_router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python3 -m pytest tests/test_sharing.py -v`
Expected: All 7 tests PASS

- [ ] **Step 6: Run full test suite + lint**

Run: `cd backend && ruff check . && ruff format --check . && python3 -m pytest tests/ -v`
Expected: All checks pass, all tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/sharing.py backend/tests/test_sharing.py backend/app/main.py
git commit -m "feat: add chat sharing API with public/authenticated visibility"
```

---

### Task 4: Frontend API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add sharing types and API functions**

Add to the end of `frontend/src/lib/api.ts`:

```typescript
// ── Sharing Types ──

export interface ShareOut {
  id: string;
  chat_id: string;
  visibility: "public" | "authenticated";
  active: boolean;
  title: string | null;
  created_at: string;
}

export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SharedChatView {
  id: string;
  title: string | null;
  visibility: "public" | "authenticated";
  created_at: string;
  messages: SharedMessage[];
}

// ── Sharing API ──

export async function createShare(
  chatId: string,
  visibility: "public" | "authenticated" = "public"
): Promise<ShareOut> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/share`, {
    method: "POST",
    body: JSON.stringify({ visibility }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: "Failed to share" } }));
    throw new Error(err.error?.message || err.detail || "Failed to share");
  }
  return res.json();
}

export async function listShares(chatId: string): Promise<ShareOut[]> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/shares`);
  if (!res.ok) throw new Error("Failed to list shares");
  return res.json();
}

export async function viewSharedChat(shareId: string): Promise<SharedChatView> {
  // Use credentials: include so authenticated shares work, but public shares also work
  const res = await fetch(`${API_BASE}/api/shared/${shareId}`, {
    credentials: "include",
  });
  if (res.status === 401) throw new Error("LOGIN_REQUIRED");
  if (!res.ok) throw new Error("NOT_FOUND");
  return res.json();
}

export async function revokeShare(shareId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/shared/${shareId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to revoke share");
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add sharing API functions to frontend"
```

---

### Task 5: Share Dialog Component

**Files:**
- Create: `frontend/src/components/share-dialog.tsx`

- [ ] **Step 1: Create the share dialog**

Create `frontend/src/components/share-dialog.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createShare,
  listShares,
  revokeShare,
  type ShareOut,
} from "@/lib/api";
import { Check, Copy, Globe, Lock, Trash2, Loader2 } from "lucide-react";

interface ShareDialogProps {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ chatId, open, onOpenChange }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "authenticated">(
    "public"
  );
  const [copied, setCopied] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listShares(chatId);
      setShares(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    if (open) fetchShares();
  }, [open, fetchShares]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createShare(chatId, visibility);
      await fetchShares();
    } catch {
      // ignore
    }
    setCreating(false);
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      // ignore
    }
  };

  const handleCopy = (shareId: string) => {
    const url = `${window.location.origin}/shared/${shareId}`;
    navigator.clipboard.writeText(url);
    setCopied(shareId);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Share conversation</DialogTitle>
        </DialogHeader>

        {/* Create new share */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setVisibility("public")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all ${
                  visibility === "public"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                Public
              </button>
              <button
                type="button"
                onClick={() => setVisibility("authenticated")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all ${
                  visibility === "authenticated"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                Logged-in only
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {visibility === "public"
              ? "Anyone with the link can view this conversation."
              : "Only logged-in users with the link can view this conversation."}
          </p>
          <Button onClick={handleCreate} disabled={creating} className="w-full">
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create share link
          </Button>
        </div>

        {/* Existing shares */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Active links</Label>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No active share links
            </p>
          ) : (
            shares.map((share) => (
              <div
                key={share.id}
                className="flex items-center gap-2 rounded-lg border p-2.5"
              >
                {share.visibility === "public" ? (
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-sm font-mono">
                  {share.id}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleCopy(share.id)}
                >
                  {copied === share.id ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleRevoke(share.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/share-dialog.tsx
git commit -m "feat: add share dialog component"
```

---

### Task 6: Add Share Button to Chat Page

**Files:**
- Modify: `frontend/src/app/chat/[id]/page.tsx`

- [ ] **Step 1: Add share button and dialog to the chat page**

Add imports at the top of `frontend/src/app/chat/[id]/page.tsx`:

```tsx
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share-dialog";
```

Add state inside the `ChatPage` component (with the other `useState` calls):

```tsx
const [shareOpen, setShareOpen] = useState(false);
```

Find where the chat header/title area is rendered and add a share button next to it. The exact location depends on the current layout — look for the chat title rendering and add adjacent to it:

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-8 w-8"
  onClick={() => setShareOpen(true)}
  title="Share conversation"
>
  <Share2 className="h-4 w-4" />
</Button>

<ShareDialog
  chatId={chatId}
  open={shareOpen}
  onOpenChange={setShareOpen}
/>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/chat/[id]/page.tsx
git commit -m "feat: add share button to chat page"
```

---

### Task 7: Shared Chat View Page

**Files:**
- Create: `frontend/src/app/shared/[id]/page.tsx`

- [ ] **Step 1: Create the shared chat page**

Create `frontend/src/app/shared/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { viewSharedChat, type SharedChatView } from "@/lib/api";
import { MessageBubble } from "@/components/message-bubble";
import { Globe, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-guard";

type PageState = "loading" | "ready" | "not_found" | "login_required";

export default function SharedChatPage() {
  const params = useParams();
  const shareId = params.id as string;
  const { requireAuth } = useAuth();

  const [state, setState] = useState<PageState>("loading");
  const [chat, setChat] = useState<SharedChatView | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await viewSharedChat(shareId);
        setChat(data);
        setState("ready");
      } catch (e) {
        if (e instanceof Error && e.message === "LOGIN_REQUIRED") {
          setState("login_required");
        } else {
          setState("not_found");
        }
      }
    };
    load();
  }, [shareId]);

  const handleLogin = async () => {
    const ok = await requireAuth();
    if (ok) {
      setState("loading");
      try {
        const data = await viewSharedChat(shareId);
        setChat(data);
        setState("ready");
      } catch {
        setState("not_found");
      }
    }
  };

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">
          This shared conversation doesn&apos;t exist or has been revoked.
        </p>
      </div>
    );
  }

  if (state === "login_required") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Login required</h1>
        <p className="text-sm text-muted-foreground">
          You need to be logged in to view this conversation.
        </p>
        <Button onClick={handleLogin}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 border-b pb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {chat?.visibility === "public" ? (
            <Globe className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>Shared conversation</span>
        </div>
        <h1 className="text-xl font-semibold">{chat?.title || "Untitled"}</h1>
      </div>

      {/* Messages */}
      <div className="space-y-4">
        {chat?.messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "shared"`
Expected: No errors related to the shared page (pre-existing sidebar errors are OK)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/shared/[id]/page.tsx
git commit -m "feat: add shared chat view page"
```

---

### Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run backend lint**

Run: `cd backend && ruff check . && ruff format --check .`
Expected: All checks passed

- [ ] **Step 2: Run full backend test suite**

Run: `cd backend && python3 -m pytest tests/ -v`
Expected: All tests pass (52+ tests)

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -v sidebar`
Expected: No new type errors

- [ ] **Step 4: Final commit if any formatting fixes needed**

Run: `cd backend && ruff format .`
Then commit if any files changed.
