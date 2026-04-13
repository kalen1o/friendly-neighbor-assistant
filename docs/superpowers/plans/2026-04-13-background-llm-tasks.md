# Background LLM Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM response generation survive page reloads — users see a spinner while generating and a check icon + toast when done, even after navigating away and refreshing.

**Architecture:** Add a `status` column (`generating`/`completed`/`error`) to the `Message` model as source of truth. Backend sets it during the LLM pipeline. Frontend reads it via existing chat list polling (10s interval) and shows server-driven indicators instead of relying on in-memory stream state.

**Tech Stack:** SQLAlchemy (Alembic migration), FastAPI, Next.js, Sonner toasts, Tailwind CSS

---

### Task 1: Add `status` column to Message model + migration

**Files:**
- Modify: `backend/app/models/chat.py:60-82`
- Create: `backend/alembic/versions/0026_add_status_to_messages.py`

- [ ] **Step 1: Write the migration file**

Create `backend/alembic/versions/0026_add_status_to_messages.py`:

```python
"""add status to messages

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("status", sa.String(20), server_default="completed", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("messages", "status")
```

- [ ] **Step 2: Add `status` field to Message model**

In `backend/app/models/chat.py`, add to the `Message` class after `tokens_total`:

```python
status: Mapped[str] = mapped_column(
    String(20), server_default="completed", default="completed"
)
```

- [ ] **Step 3: Run migration**

Run: `make migrate` (or `cd backend && alembic upgrade head` locally)

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0026_add_status_to_messages.py backend/app/models/chat.py
git commit -m "feat: add status column to messages table"
```

---

### Task 2: Set message status in `_llm_background_task`

**Files:**
- Modify: `backend/app/routers/chats.py:846-857` (first chunk save)
- Modify: `backend/app/routers/chats.py:901-918` (final save)
- Modify: `backend/app/routers/chats.py:1002-1018` (error save)

- [ ] **Step 1: Set `status="generating"` on first chunk save**

In `backend/app/routers/chats.py`, find the assistant message creation (around line 848):

```python
# BEFORE:
assistant_msg = Message(chat_id=chat.id, role="assistant", content=full_response)

# AFTER:
assistant_msg = Message(chat_id=chat.id, role="assistant", content=full_response, status="generating")
```

- [ ] **Step 2: Set `status="completed"` on successful completion**

In `backend/app/routers/chats.py`, find the final save block (around line 903-917). Add `status="completed"` before the commit:

```python
# BEFORE (around line 905):
assistant_msg.content = cleaned_response
assistant_msg.sources_json = sources_json

# AFTER:
assistant_msg.content = cleaned_response
assistant_msg.sources_json = sources_json
assistant_msg.status = "completed"
```

Also handle the else branch where no progressive save happened (around line 909):

```python
# BEFORE:
assistant_msg = Message(
    chat_id=chat.id,
    role="assistant",
    content=cleaned_response,
    sources_json=sources_json,
)

# AFTER:
assistant_msg = Message(
    chat_id=chat.id,
    role="assistant",
    content=cleaned_response,
    sources_json=sources_json,
    status="completed",
)
```

- [ ] **Step 3: Set `status="error"` on error partial save**

In `backend/app/routers/chats.py`, find the error handler (around line 1006-1017):

```python
# BEFORE:
partial_msg = Message(
    chat_id=chat.id,
    role="assistant",
    content=full_response
    + "\n\n[Response interrupted due to an error]",
)

# AFTER:
partial_msg = Message(
    chat_id=chat.id,
    role="assistant",
    content=full_response
    + "\n\n[Response interrupted due to an error]",
    status="error",
)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/chats.py
git commit -m "feat: set message status during LLM generation lifecycle"
```

---

### Task 3: Add `is_generating` to chat list API + `status` to message API

**Files:**
- Modify: `backend/app/schemas/chat.py:30-41` (MessageOut)
- Modify: `backend/app/schemas/chat.py:80-88` (ChatSummary)
- Modify: `backend/app/routers/chats.py:95-178` (list_chats query)
- Test: `backend/tests/test_chat_routes.py`

- [ ] **Step 1: Write the failing test for `is_generating` in chat list**

Append to `backend/tests/test_chat_routes.py`:

```python
@pytest.mark.anyio
async def test_list_chats_is_generating_false_by_default(client):
    await client.post("/api/chats", json={"title": "Test"})
    response = await client.get("/api/chats")
    assert response.status_code == 200
    chats = response.json()["chats"]
    assert len(chats) == 1
    assert chats[0]["is_generating"] is False


@pytest.mark.anyio
async def test_list_chats_is_generating_true_when_message_generating(client, db):
    from app.models.chat import Chat, Message

    # Create chat with a generating message directly in DB
    create_resp = await client.post("/api/chats", json={"title": "Gen Test"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()
    msg = Message(chat_id=chat.id, role="assistant", content="partial...", status="generating")
    db.add(msg)
    await db.commit()

    response = await client.get("/api/chats")
    chats = response.json()["chats"]
    gen_chat = next(c for c in chats if c["id"] == chat_id)
    assert gen_chat["is_generating"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_chat_routes.py::test_list_chats_is_generating_false_by_default tests/test_chat_routes.py::test_list_chats_is_generating_true_when_message_generating -v`

Expected: FAIL — `is_generating` key missing from response.

- [ ] **Step 3: Add `status` to `MessageOut` schema**

In `backend/app/schemas/chat.py`, add `status` field to `MessageOut` class (after `files`):

```python
class MessageOut(BaseModel):
    id: str
    chat_id: str
    role: str
    content: str
    created_at: datetime
    sources: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[MessageMetrics] = None
    files: Optional[List[Dict[str, str]]] = None
    status: str = "completed"
```

In the `from_message` classmethod, add `status` to the return:

```python
return cls(
    id=msg.public_id,
    chat_id=msg.chat.public_id
    if hasattr(msg, "chat") and msg.chat
    else str(msg.chat_id),
    role=msg.role,
    content=msg.content,
    created_at=msg.created_at,
    sources=sources,
    metrics=metrics,
    files=files,
    status=getattr(msg, "status", "completed"),
)
```

- [ ] **Step 4: Add `is_generating` to `ChatSummary` schema**

In `backend/app/schemas/chat.py`, add to `ChatSummary`:

```python
class ChatSummary(BaseModel):
    id: str = Field(validation_alias="public_id")
    title: Optional[str]
    updated_at: datetime
    folder_id: Optional[str] = None
    model_id: Optional[str] = None
    has_notification: bool = False
    is_generating: bool = False

    model_config = {"from_attributes": True, "populate_by_name": True}
```

- [ ] **Step 5: Compute `is_generating` in `list_chats` endpoint**

In `backend/app/routers/chats.py`, in the `list_chats` function, add a subquery after the model resolution block (after line ~164) and before building `chat_summaries`:

```python
# Check which chats have a message with status='generating'
from sqlalchemy import exists

generating_chat_ids = set()
if chats:
    chat_internal_ids = [c.id for c in chats]
    gen_result = await db.execute(
        select(Message.chat_id)
        .where(Message.chat_id.in_(chat_internal_ids), Message.status == "generating")
        .distinct()
    )
    generating_chat_ids = set(gen_result.scalars().all())
```

Then add `is_generating` to each chat summary dict:

```python
chat_summaries = [
    {
        "public_id": c.public_id,
        "title": c.title,
        "updated_at": c.updated_at,
        "folder_id": folder_map.get(c.folder_id) if c.folder_id else None,
        "model_id": c.selected_model_slug or (model_map.get(c.user_model_id) if c.user_model_id else None),
        "has_notification": c.has_notification,
        "is_generating": c.id in generating_chat_ids,
    }
    for c in chats
]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_chat_routes.py -v`

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/chat.py backend/app/routers/chats.py backend/tests/test_chat_routes.py
git commit -m "feat: expose is_generating in chat list and status in message API"
```

---

### Task 4: Add `status` to `MessageOut` in `ChatDetail` response

**Files:**
- Modify: `backend/app/schemas/chat.py:97-114` (ChatDetail)
- Test: `backend/tests/test_chat_routes.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_chat_routes.py`:

```python
@pytest.mark.anyio
async def test_get_chat_message_status(client, db):
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Status Test"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()

    msg_completed = Message(chat_id=chat.id, role="assistant", content="done", status="completed")
    msg_generating = Message(chat_id=chat.id, role="assistant", content="in progress...", status="generating")
    db.add_all([msg_completed, msg_generating])
    await db.commit()

    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert messages[0]["status"] == "completed"
    assert messages[1]["status"] == "generating"
```

- [ ] **Step 2: Run test to verify it passes (should already pass from Task 3 changes)**

Run: `cd backend && python -m pytest tests/test_chat_routes.py::test_get_chat_message_status -v`

Expected: PASS (MessageOut already includes `status` from Task 3)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_chat_routes.py
git commit -m "test: verify message status in chat detail response"
```

---

### Task 5: Startup cleanup for stuck `generating` messages

**Files:**
- Modify: `backend/app/main.py:29-39` (lifespan)

- [ ] **Step 1: Add cleanup in lifespan startup**

In `backend/app/main.py`, add cleanup logic inside the `lifespan` function, after `await init_redis(settings)`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(level=settings.log_level, environment=settings.environment)
    import os

    os.makedirs(settings.upload_dir, exist_ok=True)
    init_engine(settings)
    await init_redis(settings)

    # Clean up messages stuck in 'generating' status (e.g. from server restart)
    from app.db.session import get_session_factory
    from app.models.chat import Message
    from sqlalchemy import select, update
    from datetime import datetime, timedelta, timezone

    try:
        async with get_session_factory()() as db:
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
            result = await db.execute(
                update(Message)
                .where(Message.status == "generating", Message.created_at < cutoff)
                .values(status="error")
            )
            if result.rowcount > 0:
                await db.commit()
                import logging
                logging.getLogger(__name__).info(
                    f"Cleaned up {result.rowcount} stuck generating message(s)"
                )
    except Exception:
        pass  # Don't block startup

    yield
    await close_redis()
    await dispose_engine()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: cleanup stuck generating messages on server startup"
```

---

### Task 6: Frontend — add `is_generating` to `ChatSummary` and `status` to `MessageOut`

**Files:**
- Modify: `frontend/src/lib/api.ts:110-117` (ChatSummary interface)
- Modify: `frontend/src/lib/api.ts:143-152` (MessageOut interface)

- [ ] **Step 1: Add `is_generating` to `ChatSummary`**

In `frontend/src/lib/api.ts`, update the `ChatSummary` interface:

```typescript
export interface ChatSummary {
  id: string;
  title: string | null;
  updated_at: string;
  folder_id: string | null;
  model_id: string | null;
  has_notification: boolean;
  is_generating: boolean;
}
```

- [ ] **Step 2: Add `status` to `MessageOut`**

In `frontend/src/lib/api.ts`, update the `MessageOut` interface:

```typescript
export interface MessageOut {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
  files?: MessageFileRef[] | null;
  status?: "generating" | "completed" | "error";
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add is_generating and message status to frontend types"
```

---

### Task 7: Frontend — server-driven sidebar indicators

**Files:**
- Modify: `frontend/src/components/chat-list.tsx:105-109`
- Modify: `frontend/src/components/chat-in-folder.tsx:89-92`
- Modify: `frontend/src/components/folder-tree.tsx:374`

- [ ] **Step 1: Update `chat-list.tsx` to use `chat.is_generating`**

In `frontend/src/components/chat-list.tsx`, replace the notification icon logic (lines 105-109):

```tsx
// BEFORE:
{chat.has_notification && (
  isStreamGenerating(chat.id)
    ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
    : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
)}

// AFTER:
{(chat.has_notification || chat.is_generating) && (
  chat.is_generating || isStreamGenerating(chat.id)
    ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
    : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
)}
```

This keeps the in-memory `isStreamGenerating` as a fallback for instant feedback (before the first poll), while `chat.is_generating` from the server covers the post-reload case.

- [ ] **Step 2: Update `chat-in-folder.tsx` to use `chat.is_generating`**

In `frontend/src/components/chat-in-folder.tsx`, replace the notification icon logic (lines 89-92):

```tsx
// BEFORE:
{chat.has_notification && (
  isStreamGenerating(chat.id)
    ? <Loader2 className="ml-1.5 h-3 w-3 shrink-0 animate-spin text-primary" />
    : <CheckCircle2 className="ml-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
)}

// AFTER:
{(chat.has_notification || chat.is_generating) && (
  chat.is_generating || isStreamGenerating(chat.id)
    ? <Loader2 className="ml-1.5 h-3 w-3 shrink-0 animate-spin text-primary" />
    : <CheckCircle2 className="ml-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
)}
```

- [ ] **Step 3: Update `folder-tree.tsx` to use `chat.is_generating`**

In `frontend/src/components/folder-tree.tsx`, replace the `hasGenerating` logic (line 374):

```tsx
// BEFORE:
const hasGenerating = notifChats.some((c) => isStreamGenerating(c.id));

// AFTER:
const hasGenerating = notifChats.some((c) => c.is_generating || isStreamGenerating(c.id));
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat-list.tsx frontend/src/components/chat-in-folder.tsx frontend/src/components/folder-tree.tsx
git commit -m "feat: use server-driven is_generating for sidebar indicators"
```

---

### Task 8: Frontend — toast on generation completion after reload

**Files:**
- Modify: `frontend/src/components/sidebar-content.tsx:128-154`

- [ ] **Step 1: Track `is_generating` transitions for toast**

In `frontend/src/components/sidebar-content.tsx`, add a ref to track previously generating chat IDs alongside the existing `prevNotifIdsRef` (after line 128):

```typescript
const prevGeneratingIdsRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: Detect generating→completed transitions in `fetchChats`**

In `frontend/src/components/sidebar-content.tsx`, update the `fetchChats` callback. After the existing notification detection block (lines 142-154), add generating-to-completed detection:

```typescript
const fetchChats = useCallback(async () => {
    if (!isAuthenticated) {
      setChats([]);
      if (!authLoading) setIsLoading(false);
      return;
    }
    try {
      const data = await listChats();
      setChats(data.chats);
      cursorRef.current = data.next_cursor;
      hasMoreRef.current = data.has_more;

      // Detect NEW notifications (not previously seen)
      const newNotifChats = data.chats.filter(
        (c) => c.has_notification && !c.is_generating && !prevNotifIdsRef.current.has(c.id)
      );

      // Detect generating→completed transitions (for post-reload toasts)
      const justFinished = data.chats.filter(
        (c) => !c.is_generating && prevGeneratingIdsRef.current.has(c.id)
      );

      // Show toast for newly finished chats (avoid duplicating with newNotifChats)
      const newNotifIds = new Set(newNotifChats.map((c) => c.id));
      for (const chat of justFinished) {
        if (!newNotifIds.has(chat.id) && pathname !== `/chat/${chat.id}`) {
          toast.success(`Response ready: ${chat.title || "New Chat"}`, {
            action: {
              label: "View",
              onClick: () => {
                window.dispatchEvent(
                  new CustomEvent("notification-navigate", { detail: { chatId: chat.id } })
                );
              },
            },
          });
        }
      }

      for (const chat of newNotifChats) {
        if (pathname !== `/chat/${chat.id}`) {
          toast.success(`Response ready: ${chat.title || "New Chat"}`, {
            action: {
              label: "View",
              onClick: () => {
                window.dispatchEvent(
                  new CustomEvent("notification-navigate", { detail: { chatId: chat.id } })
                );
              },
            },
          });
        }
      }

      // Update tracked IDs
      prevNotifIdsRef.current = new Set(
        data.chats.filter((c) => c.has_notification).map((c) => c.id)
      );
      prevGeneratingIdsRef.current = new Set(
        data.chats.filter((c) => c.is_generating).map((c) => c.id)
      );
    } catch (e) {
      console.error("Failed to fetch chats:", e);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, authLoading, pathname]);
```

Note: Add `pathname` to the dependency array of the `useCallback`. This is needed since we reference `pathname` inside the callback.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar-content.tsx
git commit -m "feat: toast notification when background generation completes after reload"
```

---

### Task 9: Frontend — poll for completion when viewing a generating chat

**Files:**
- Modify: `frontend/src/hooks/use-message-stream.ts:211-256`

- [ ] **Step 1: Add polling for generating status in `loadChat`**

In `frontend/src/hooks/use-message-stream.ts`, update the `loadChat` function. After the chat is loaded successfully (inside the `try` block starting at line 212), add a check for the last message's status:

```typescript
// Inside loadChat, after setting messages and chat data (after line 218):
try {
    const chat = await getChat(chatId, 20);
    setMessages(mapMessages(chat.messages));
    setHasMoreMessages(chat.has_more ?? false);
    nextCursorRef.current = chat.next_cursor ?? null;
    setChatModelId(chat.model_id ?? null);
    chatTitleRef.current = chat.title || "";

    // Check if last message is still generating (e.g. after page reload)
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg?.status === "generating") {
      setIsStreaming(true);
      setIsLoading(true);
      setActionText("Generating response...");

      // Poll every 3 seconds until generation completes
      const pollInterval = setInterval(async () => {
        try {
          const updated = await getChat(chatId, 20);
          const updatedLast = updated.messages[updated.messages.length - 1];
          if (updatedLast?.status !== "generating") {
            clearInterval(pollInterval);
            setMessages(mapMessages(updated.messages));
            setIsStreaming(false);
            setIsLoading(false);
            setActionText(null);
            chatTitleRef.current = updated.title || "";
          }
        } catch {
          clearInterval(pollInterval);
          setIsStreaming(false);
          setIsLoading(false);
          setActionText(null);
        }
      }, 3000);

      // Clean up on unmount
      const cleanup = () => clearInterval(pollInterval);
      window.addEventListener("beforeunload", cleanup);
      // Store cleanup for effect teardown
      (window as any).__bgPollCleanup = cleanup;
    }

    listArtifacts(chatId)
      .then((arts) => {
        setArtifacts(
          arts.map((a) => ({
            id: a.id,
            type: (a.artifact_type || a.type) as "react" | "html",
            title: a.title,
            code: a.code,
          }))
        );
      })
      .catch(() => {});
} catch (e) {
```

- [ ] **Step 2: Clean up poll interval on component unmount**

In `frontend/src/hooks/use-message-stream.ts`, update the existing cleanup effect (line 120) to also clear the background poll:

```typescript
// Update the cleanup effect:
useEffect(() => {
  return () => {
    stopTypewriter();
    const bgCleanup = (window as any).__bgPollCleanup;
    if (bgCleanup) {
      bgCleanup();
      delete (window as any).__bgPollCleanup;
    }
  };
}, [stopTypewriter]);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-message-stream.ts
git commit -m "feat: poll for message completion when viewing a generating chat"
```

---

### Task 10: Integration test — end-to-end flow

**Files:**
- Modify: `backend/tests/test_chat_routes.py`

- [ ] **Step 1: Write integration test for message status lifecycle**

Append to `backend/tests/test_chat_routes.py`:

```python
@pytest.mark.anyio
async def test_message_status_default_completed(client, db):
    """New user messages should default to 'completed' status."""
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Status Default"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()
    msg = Message(chat_id=chat.id, role="user", content="hello")
    db.add(msg)
    await db.commit()

    response = await client.get(f"/api/chats/{chat_id}")
    messages = response.json()["messages"]
    assert messages[0]["status"] == "completed"


@pytest.mark.anyio
async def test_is_generating_clears_after_completion(client, db):
    """is_generating should be false after message status changes to completed."""
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Gen Clear"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()

    # Start with generating
    msg = Message(chat_id=chat.id, role="assistant", content="...", status="generating")
    db.add(msg)
    await db.commit()

    response = await client.get("/api/chats")
    gen_chat = next(c for c in response.json()["chats"] if c["id"] == chat_id)
    assert gen_chat["is_generating"] is True

    # Complete the message
    await db.refresh(msg)
    msg.status = "completed"
    await db.commit()

    response = await client.get("/api/chats")
    gen_chat = next(c for c in response.json()["chats"] if c["id"] == chat_id)
    assert gen_chat["is_generating"] is False
```

- [ ] **Step 2: Run all tests**

Run: `cd backend && python -m pytest tests/test_chat_routes.py -v`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_chat_routes.py
git commit -m "test: integration tests for message status lifecycle"
```
