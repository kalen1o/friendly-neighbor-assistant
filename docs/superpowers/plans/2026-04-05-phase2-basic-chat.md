# Phase 2: Basic Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional chat interface with persistent conversations, real-time SSE streaming, and auto-generated titles, connecting a Next.js frontend to the FastAPI backend.

**Architecture:** SQLAlchemy models for chats and messages with cascade deletes. FastAPI routes handle CRUD for chats and a streaming message endpoint using `sse-starlette`. The frontend is a Next.js App Router application with a sidebar for chat navigation and a main area for real-time message display via EventSource. Auto-title generation fires after the first assistant response using a quick LLM call.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), sse-starlette, Alembic, Next.js 14 (App Router), Tailwind CSS, shadcn/ui, react-markdown, EventSource API

---

## File Structure

```
backend/
├── app/
│   ├── main.py                 # Modify — remove /api/llm/test, add chat router
│   ├── models/
│   │   ├── __init__.py         # Create — empty
│   │   └── chat.py             # Create — Chat + Message models
│   ├── schemas/
│   │   ├── __init__.py         # Create — empty
│   │   └── chat.py             # Create — Pydantic schemas
│   └── routers/
│       ├── __init__.py         # Create — empty
│       └── chats.py            # Create — chat CRUD + streaming endpoint
├── alembic/
│   └── versions/
│       └── 0001_create_chats_and_messages.py  # Create — migration
└── tests/
    ├── conftest.py             # Modify — add db fixture with test database
    ├── test_chat_models.py     # Create — model unit tests
    └── test_chat_routes.py     # Create — route integration tests

frontend/
├── package.json                # Create — Next.js project
├── tsconfig.json               # Create
├── tailwind.config.ts          # Create
├── postcss.config.mjs          # Create
├── next.config.ts              # Create
├── components.json             # Create — shadcn/ui config
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Create — root layout with sidebar
│   │   ├── page.tsx            # Create — landing/empty state
│   │   ├── globals.css         # Create — Tailwind + shadcn globals
│   │   └── chat/
│   │       └── [id]/
│   │           └── page.tsx    # Create — chat view
│   ├── components/
│   │   ├── sidebar.tsx         # Create
│   │   ├── chat-list.tsx       # Create
│   │   ├── chat-messages.tsx   # Create
│   │   ├── chat-input.tsx      # Create
│   │   ├── message-bubble.tsx  # Create
│   │   └── ui/                 # Create — shadcn components (button, input, scroll-area, etc.)
│   └── lib/
│       ├── api.ts              # Create — fetch wrappers
│       └── utils.ts            # Create — cn() helper for shadcn
```

---

## Backend Tasks

---

### Task 1: Create Chat and Message SQLAlchemy models

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/chat.py`
- Modify: `backend/alembic/env.py` (import models so Alembic sees them)

- [ ] **Step 1: Create `backend/app/models/__init__.py`**

```python
```

(Empty file, marks the package.)

- [ ] **Step 2: Create `backend/app/models/chat.py`**

```python
from datetime import datetime

from sqlalchemy import ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column()  # "user" or "assistant"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    chat: Mapped["Chat"] = relationship(back_populates="messages")
```

- [ ] **Step 3: Update `backend/alembic/env.py` to import models**

Add this import right after the `from app.db.base import Base` line:

```python
import app.models.chat  # noqa: F401 — registers models with Base.metadata
```

- [ ] **Step 4: Verify — confirm models register with Base.metadata**

```bash
cd backend && python -c "
import app.models.chat
from app.db.base import Base
tables = list(Base.metadata.tables.keys())
assert 'chats' in tables, f'chats not found in {tables}'
assert 'messages' in tables, f'messages not found in {tables}'
print(f'OK: {tables}')
"
```

Expected output:
```
OK: ['chats', 'messages']
```

---

### Task 2: Create Alembic migration for chats and messages

**Files:**
- Create: `backend/alembic/versions/0001_create_chats_and_messages.py`

- [ ] **Step 1: Create the migration file `backend/alembic/versions/0001_create_chats_and_messages.py`**

```python
"""create chats and messages tables

Revision ID: 0001
Revises:
Create Date: 2026-04-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["chat_id"], ["chats.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_messages_chat_id", "messages", ["chat_id"])


def downgrade() -> None:
    op.drop_index("ix_messages_chat_id", table_name="messages")
    op.drop_table("messages")
    op.drop_table("chats")
```

- [ ] **Step 2: Run the migration against the database**

```bash
cd backend && docker compose -f ../docker-compose.yml exec backend alembic upgrade head
```

Expected: migration applies successfully, `chats` and `messages` tables exist.

---

### Task 3: Create Pydantic schemas

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/chat.py`

- [ ] **Step 1: Create `backend/app/schemas/__init__.py`**

```python
```

(Empty file.)

- [ ] **Step 2: Create `backend/app/schemas/chat.py`**

```python
from datetime import datetime

from pydantic import BaseModel


# ── Request schemas ──


class ChatCreate(BaseModel):
    title: str | None = None


class ChatUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str


# ── Response schemas ──


class MessageOut(BaseModel):
    id: int
    chat_id: int
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSummary(BaseModel):
    """Used in list endpoint — no messages."""

    id: int
    title: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatDetail(BaseModel):
    """Used in detail endpoint — includes messages."""

    id: int
    title: str | None
    created_at: datetime
    updated_at: datetime
    messages: list[MessageOut] = []

    model_config = {"from_attributes": True}
```

---

### Task 4: Write tests for chat models and schemas

**Files:**
- Create: `backend/tests/test_chat_models.py`
- Modify: `backend/tests/conftest.py` — add in-memory SQLite test database fixture

- [ ] **Step 1: Update `backend/tests/conftest.py` to add database fixtures**

Replace the full contents of `conftest.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app

# In-memory SQLite for tests (aiosqlite driver)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db(db_engine):
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
```

- [ ] **Step 2: Add `aiosqlite` to `backend/requirements.txt`**

Add this line under the `# Testing` section:

```
aiosqlite>=0.20.0
```

- [ ] **Step 3: Create `backend/tests/test_chat_models.py`**

```python
import pytest
from sqlalchemy import select

from app.models.chat import Chat, Message


@pytest.mark.anyio
async def test_create_chat(db):
    chat = Chat(title="Test Chat")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title == "Test Chat"
    assert chat.created_at is not None
    assert chat.updated_at is not None


@pytest.mark.anyio
async def test_create_chat_without_title(db):
    chat = Chat()
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title is None


@pytest.mark.anyio
async def test_create_message(db):
    chat = Chat(title="Test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Hello!")
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    assert msg.id is not None
    assert msg.chat_id == chat.id
    assert msg.role == "user"
    assert msg.content == "Hello!"
    assert msg.created_at is not None


@pytest.mark.anyio
async def test_chat_messages_relationship(db):
    chat = Chat(title="Relationship test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg1 = Message(chat_id=chat.id, role="user", content="Hi")
    msg2 = Message(chat_id=chat.id, role="assistant", content="Hello!")
    db.add_all([msg1, msg2])
    await db.commit()

    result = await db.execute(select(Chat).where(Chat.id == chat.id))
    loaded_chat = result.scalar_one()
    await db.refresh(loaded_chat, ["messages"])

    assert len(loaded_chat.messages) == 2
    assert loaded_chat.messages[0].role == "user"
    assert loaded_chat.messages[1].role == "assistant"


@pytest.mark.anyio
async def test_cascade_delete(db):
    chat = Chat(title="Delete test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Bye")
    db.add(msg)
    await db.commit()

    await db.delete(chat)
    await db.commit()

    result = await db.execute(select(Message))
    remaining = result.scalars().all()
    assert len(remaining) == 0
```

- [ ] **Step 4: Run model tests**

```bash
cd backend && python -m pytest tests/test_chat_models.py -v
```

Expected: all 5 tests pass.

---

### Task 5: Build the chat router — CRUD endpoints

**Files:**
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/chats.py`
- Modify: `backend/app/main.py` — add router, remove `/api/llm/test`

- [ ] **Step 1: Create `backend/app/routers/__init__.py`**

```python
```

(Empty file.)

- [ ] **Step 2: Create `backend/app/routers/chats.py`**

```python
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.config import Settings, get_settings
from app.db.session import get_db
from app.llm.provider import get_llm_response, stream_llm_response
from app.models.chat import Chat, Message
from app.schemas.chat import (
    ChatCreate,
    ChatDetail,
    ChatSummary,
    ChatUpdate,
    MessageCreate,
)

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.post("", status_code=201, response_model=ChatDetail)
async def create_chat(body: ChatCreate, db: AsyncSession = Depends(get_db)):
    chat = Chat(title=body.title)
    db.add(chat)
    await db.commit()
    await db.refresh(chat, ["messages"])
    return chat


@router.get("", response_model=list[ChatSummary])
async def list_chats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).order_by(Chat.updated_at.desc()))
    return result.scalars().all()


@router.get("/{chat_id}", response_model=ChatDetail)
async def get_chat(chat_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


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
    await db.refresh(chat, ["messages"])
    return chat


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

    # 3. Build message history for LLM
    await db.refresh(chat, ["messages"])
    llm_messages = [
        {"role": m.role, "content": m.content} for m in chat.messages
    ]

    # 4-7. Stream response via SSE
    async def event_generator():
        full_response = ""
        try:
            async for chunk in stream_llm_response(llm_messages, settings):
                full_response += chunk
                yield {"event": "message", "data": chunk}

            # 6. Save assistant message
            assistant_msg = Message(
                chat_id=chat_id, role="assistant", content=full_response
            )
            db.add(assistant_msg)

            # 7. Update chat.updated_at
            from sqlalchemy import func

            chat.updated_at = func.now()
            await db.commit()

            # Auto-title: if this is the first assistant response and no title set
            if chat.title is None:
                title = await _generate_title(
                    body.content, full_response, settings
                )
                chat.title = title
                await db.commit()
                yield {"event": "title", "data": title}

            yield {"event": "done", "data": ""}

        except Exception as e:
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
```

- [ ] **Step 3: Update `backend/app/main.py` — add router, remove test endpoint**

Replace the full contents of `main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.engine import dispose_engine, init_engine
from app.routers.chats import router as chats_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_engine(settings)
    yield
    await dispose_engine()


app = FastAPI(title="Friendly Neighbor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


app.include_router(chats_router)
```

---

### Task 6: Write tests for chat CRUD routes

**Files:**
- Create: `backend/tests/test_chat_routes.py`

- [ ] **Step 1: Create `backend/tests/test_chat_routes.py`**

```python
import pytest


@pytest.mark.anyio
async def test_create_chat(client):
    response = await client.post("/api/chats", json={"title": "My Chat"})
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "My Chat"
    assert data["id"] is not None
    assert data["messages"] == []


@pytest.mark.anyio
async def test_create_chat_no_title(client):
    response = await client.post("/api/chats", json={})
    assert response.status_code == 201
    data = response.json()
    assert data["title"] is None


@pytest.mark.anyio
async def test_list_chats(client):
    await client.post("/api/chats", json={"title": "Chat A"})
    await client.post("/api/chats", json={"title": "Chat B"})

    response = await client.get("/api/chats")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    # Most recently updated first
    assert data[0]["title"] == "Chat B"
    assert data[1]["title"] == "Chat A"


@pytest.mark.anyio
async def test_get_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Detail"})
    chat_id = create_resp.json()["id"]

    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Detail"
    assert data["messages"] == []


@pytest.mark.anyio
async def test_get_chat_not_found(client):
    response = await client.get("/api/chats/9999")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_update_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Old"})
    chat_id = create_resp.json()["id"]

    response = await client.patch(f"/api/chats/{chat_id}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


@pytest.mark.anyio
async def test_update_chat_not_found(client):
    response = await client.patch("/api/chats/9999", json={"title": "X"})
    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Delete Me"})
    chat_id = create_resp.json()["id"]

    response = await client.delete(f"/api/chats/{chat_id}")
    assert response.status_code == 204

    # Confirm it's gone
    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_chat_not_found(client):
    response = await client.delete("/api/chats/9999")
    assert response.status_code == 404
```

- [ ] **Step 2: Run all backend tests**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: all tests pass (model tests + route tests + existing health/config/llm tests).

- [ ] **Step 3: Commit backend work**

```bash
git add -A && git commit -m "feat: Phase 2 backend — chat models, schemas, CRUD routes, SSE streaming

- Add Chat and Message SQLAlchemy models with cascade delete
- Add Alembic migration for chats and messages tables
- Add Pydantic request/response schemas
- Add chat router with full CRUD + SSE streaming message endpoint
- Add auto-title generation after first assistant response
- Remove temporary /api/llm/test endpoint
- Add test database fixtures (aiosqlite) and comprehensive tests"
```

---

## Frontend Tasks

---

### Task 7: Initialize Next.js project with dependencies

**Files:**
- Create: `frontend/package.json` (via npx create-next-app)
- Modify: `frontend/Dockerfile` (already exists)

- [ ] **Step 1: Initialize Next.js project**

Run from the repo root:

```bash
cd frontend && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```

If the directory already has files, you may need to accept overwrite prompts. The `Dockerfile` is fine as-is since it runs `npm install` and `npm run dev`.

- [ ] **Step 2: Install additional dependencies**

```bash
cd frontend && npm install react-markdown remark-gfm lucide-react clsx tailwind-merge class-variance-authority tailwindcss-animate
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
cd frontend && npx shadcn@latest init -d
```

This creates `components.json` and updates `tailwind.config.ts` and `globals.css`.

- [ ] **Step 4: Add shadcn/ui components**

```bash
cd frontend && npx shadcn@latest add button input scroll-area separator textarea
```

---

### Task 8: Create the API client

**Files:**
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `frontend/src/lib/api.ts`**

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──

export interface ChatSummary {
  id: number;
  title: string | null;
  updated_at: string;
}

export interface MessageOut {
  id: number;
  chat_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatDetail {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: MessageOut[];
}

// ── Chat CRUD ──

export async function createChat(title?: string): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch(`${API_BASE}/api/chats`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}

export async function getChat(chatId: number): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`);
  if (!res.ok) throw new Error("Failed to get chat");
  return res.json();
}

export async function updateChat(
  chatId: number,
  title: string
): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}

export async function deleteChat(chatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

// ── Streaming messages ──

export interface SSECallbacks {
  onMessage: (chunk: string) => void;
  onTitle: (title: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export function sendMessage(
  chatId: number,
  content: string,
  callbacks: SSECallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        callbacks.onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const event = line.slice(7).trim();
            // Next line should be data:
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            // We need to determine the event type from the previous event: line
            // Let's re-parse using a different approach
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        callbacks.onError(e.message);
      }
    }
  })();

  return () => controller.abort();
}
```

Wait -- the SSE parsing above is incomplete. Let me use a proper approach with buffered event parsing.

Replace the full `sendMessage` function:

```typescript
export function sendMessage(
  chatId: number,
  content: string,
  callbacks: SSECallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        callbacks.onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          let eventType = "message";
          let data = "";

          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trimStart();
            }
          }

          switch (eventType) {
            case "message":
              callbacks.onMessage(data);
              break;
            case "title":
              callbacks.onTitle(data);
              break;
            case "done":
              callbacks.onDone();
              break;
            case "error":
              callbacks.onError(data);
              break;
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        callbacks.onError(e.message);
      }
    }
  })();

  return () => controller.abort();
}
```

So the final complete `frontend/src/lib/api.ts` is:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──

export interface ChatSummary {
  id: number;
  title: string | null;
  updated_at: string;
}

export interface MessageOut {
  id: number;
  chat_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatDetail {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: MessageOut[];
}

// ── Chat CRUD ──

export async function createChat(title?: string): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch(`${API_BASE}/api/chats`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}

export async function getChat(chatId: number): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`);
  if (!res.ok) throw new Error("Failed to get chat");
  return res.json();
}

export async function updateChat(
  chatId: number,
  title: string
): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}

export async function deleteChat(chatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

// ── Streaming messages ──

export interface SSECallbacks {
  onMessage: (chunk: string) => void;
  onTitle: (title: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export function sendMessage(
  chatId: number,
  content: string,
  callbacks: SSECallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        callbacks.onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          let eventType = "message";
          let data = "";

          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trimStart();
            }
          }

          switch (eventType) {
            case "message":
              callbacks.onMessage(data);
              break;
            case "title":
              callbacks.onTitle(data);
              break;
            case "done":
              callbacks.onDone();
              break;
            case "error":
              callbacks.onError(data);
              break;
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        callbacks.onError(e.message);
      }
    }
  })();

  return () => controller.abort();
}
```

---

### Task 9: Create the message bubble component

**Files:**
- Create: `frontend/src/components/message-bubble.tsx`

- [ ] **Step 1: Create `frontend/src/components/message-bubble.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted rounded-bl-md"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Task 10: Create the chat messages and chat input components

**Files:**
- Create: `frontend/src/components/chat-messages.tsx`
- Create: `frontend/src/components/chat-input.tsx`

- [ ] **Step 1: Create `frontend/src/components/chat-messages.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/message-bubble";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatMessagesProps {
  messages: DisplayMessage[];
  streamingContent: string;
}

export function ChatMessages({ messages, streamingContent }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
        {streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/chat-input.tsx`**

```tsx
"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SendHorizonal } from "lucide-react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="min-h-[44px] max-h-[200px] resize-none"
        />
        <Button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          size="icon"
          className="shrink-0"
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

---

### Task 11: Create the sidebar components

**Files:**
- Create: `frontend/src/components/chat-list.tsx`
- Create: `frontend/src/components/sidebar.tsx`

- [ ] **Step 1: Create `frontend/src/components/chat-list.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatListProps {
  chats: ChatSummary[];
  activeChatId: number | null;
  onDelete: (chatId: number) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ChatList({ chats, activeChatId, onDelete }: ChatListProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      {chats.map((chat) => (
        <div
          key={chat.id}
          onClick={() => router.push(`/chat/${chat.id}`)}
          className={cn(
            "group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-accent",
            chat.id === activeChatId && "bg-accent"
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {chat.title || "New Chat"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(chat.updated_at)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(chat.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {chats.length === 0 && (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          No conversations yet
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/sidebar.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageSquarePlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatList } from "@/components/chat-list";
import {
  createChat,
  deleteChat,
  listChats,
  type ChatSummary,
} from "@/lib/api";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [chats, setChats] = useState<ChatSummary[]>([]);

  const activeChatId = pathname.startsWith("/chat/")
    ? parseInt(pathname.split("/")[2], 10)
    : null;

  const fetchChats = useCallback(async () => {
    try {
      const data = await listChats();
      setChats(data);
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats, pathname]);

  const handleNewChat = async () => {
    try {
      const chat = await createChat();
      await fetchChats();
      router.push(`/chat/${chat.id}`);
    } catch (e) {
      console.error("Failed to create chat:", e);
    }
  };

  const handleDelete = async (chatId: number) => {
    try {
      await deleteChat(chatId);
      await fetchChats();
      if (activeChatId === chatId) {
        router.push("/");
      }
    } catch (e) {
      console.error("Failed to delete chat:", e);
    }
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-muted/30">
      <div className="p-3">
        <h1 className="mb-3 px-2 text-lg font-semibold">Friendly Neighbor</h1>

        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => router.push("/documents")}
        >
          <FileText className="h-4 w-4" />
          Docs
        </Button>
      </div>

      <Separator />

      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3 pb-3">
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onDelete={handleDelete}
        />
      </ScrollArea>
    </aside>
  );
}
```

---

### Task 12: Create the layout and pages

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/app/page.tsx`
- Create: `frontend/src/app/chat/[id]/page.tsx`

- [ ] **Step 1: Update `frontend/src/app/layout.tsx`**

Replace the full contents:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Friendly Neighbor",
  description: "Your friendly AI assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update `frontend/src/app/page.tsx`**

Replace the full contents:

```tsx
import { MessageSquarePlus } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <MessageSquarePlus className="h-12 w-12" />
      <h2 className="text-xl font-medium">Welcome to Friendly Neighbor</h2>
      <p className="text-sm">
        Create a new chat from the sidebar to get started.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/app/chat/[id]/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ChatMessages, type DisplayMessage } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { getChat, sendMessage } from "@/lib/api";

export default function ChatPage() {
  const params = useParams();
  const chatId = Number(params.id);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChat = useCallback(async () => {
    try {
      const chat = await getChat(chatId);
      setMessages(
        chat.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
      setError(null);
    } catch (e) {
      setError("Failed to load chat");
      console.error(e);
    }
  }, [chatId]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  const handleSend = (content: string) => {
    // Optimistically add user message
    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreamingContent("");
    setIsStreaming(true);
    setError(null);

    sendMessage(chatId, content, {
      onMessage: (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      },
      onTitle: () => {
        // Title update will be reflected when sidebar refetches
      },
      onDone: () => {
        setStreamingContent((prev) => {
          // Move streaming content into messages list
          if (prev) {
            setMessages((msgs) => [
              ...msgs,
              { role: "assistant", content: prev },
            ]);
          }
          return "";
        });
        setIsStreaming(false);
      },
      onError: (err) => {
        setError(err);
        setIsStreaming(false);
        setStreamingContent("");
      },
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <ChatMessages messages={messages} streamingContent={streamingContent} />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
```

- [ ] **Step 4: Verify the frontend builds**

```bash
cd frontend && npm run build
```

Expected: build completes successfully with no errors.

- [ ] **Step 5: Commit frontend work**

```bash
git add -A && git commit -m "feat: Phase 2 frontend — Next.js chat UI with SSE streaming

- Initialize Next.js 14 with App Router, Tailwind CSS, shadcn/ui
- Add API client with fetch wrappers and SSE stream parsing
- Add sidebar with chat list, new chat, and docs placeholder link
- Add chat page with real-time streaming message display
- Add message bubble component with markdown rendering
- Add chat input with Enter-to-send and Shift+Enter for newline"
```

---

### Task 13: End-to-end verification

- [ ] **Step 1: Start all services**

```bash
docker compose up --build -d
```

- [ ] **Step 2: Run the Alembic migration**

```bash
docker compose exec backend alembic upgrade head
```

- [ ] **Step 3: Run all backend tests**

```bash
docker compose exec backend python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 4: Manual smoke test**

1. Open http://localhost:3000 in a browser
2. Verify the landing page shows "Welcome to Friendly Neighbor"
3. Click "New Chat" in the sidebar
4. Type "Hello, what can you help me with?" and press Enter
5. Verify tokens stream in real-time
6. Verify the chat title auto-generates in the sidebar after the response completes
7. Click "New Chat" again, send a different message
8. Verify both chats appear in the sidebar, ordered by most recent
9. Click between chats to verify message history loads correctly
10. Delete a chat and verify it disappears from the sidebar

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: Phase 2 complete — basic chat with streaming and auto-titles"
```
