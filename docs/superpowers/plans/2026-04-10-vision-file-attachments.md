# Vision & File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to attach images and files to chat messages. Images go to a vision LLM; PDFs/text have content extracted as context.

**Architecture:** Files are uploaded to local disk via `/api/uploads`, referenced by ID in messages. The LLM provider switches to a vision model when images are present, sending content as an array with text + image_url blocks. Frontend adds a paperclip button and Ctrl+V paste handler.

**Tech Stack:** FastAPI file upload, local filesystem storage, base64 image encoding for LLM, pypdf for PDF extraction (already installed).

---

### Task 1: Config + ChatFile Model + Migration

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/models/chat_file.py`
- Create: `backend/alembic/versions/0019_create_chat_files_table.py`
- Modify: `backend/tests/conftest.py`
- Modify: `.env.example`

- [ ] **Step 1: Add vision and upload settings to config**

In `backend/app/config.py`, add after the `context_recent_messages` line:

```python
    # Vision
    vision_model: str = ""
    vision_api_key: str = ""
    vision_base_url: str = ""

    # File uploads
    upload_dir: str = "uploads"
    max_upload_size_mb: int = 10
```

- [ ] **Step 2: Update .env.example**

Add to `.env.example` after the `EMBEDDING_BASE_URL=` section:

```env

# ── Vision (used when images are attached) ──
# Model name for vision tasks
VISION_MODEL=GLM-4.5V
# Leave empty to use OPENAI_API_KEY
VISION_API_KEY=
# Leave empty to use OPENAI_BASE_URL
VISION_BASE_URL=

# ── File Uploads ──
# Local directory for uploaded files
UPLOAD_DIR=uploads
# Max file size in MB
MAX_UPLOAD_SIZE_MB=10
```

- [ ] **Step 3: Create ChatFile model**

Create `backend/app/models/chat_file.py`:

```python
from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class ChatFile(Base):
    __tablename__ = "chat_files"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "file")
    )
    message_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    chat_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(100))
    file_size: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

- [ ] **Step 4: Create migration**

Create `backend/alembic/versions/0019_create_chat_files_table.py`:

```python
"""create chat_files table

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_files",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "message_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("chat_files")
```

- [ ] **Step 5: Add model import to conftest**

Add to `backend/tests/conftest.py` with the other model imports:

```python
from app.models.chat_file import ChatFile  # noqa: F401
```

- [ ] **Step 6: Verify import**

Run: `cd backend && python3 -c "from app.models.chat_file import ChatFile; print('OK')"`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/models/chat_file.py backend/alembic/versions/0019_create_chat_files_table.py backend/tests/conftest.py .env.example
git commit -m "feat: add ChatFile model, migration, vision config"
```

---

### Task 2: Upload Router + Tests

**Files:**
- Create: `backend/app/routers/uploads.py`
- Create: `backend/tests/test_uploads.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write upload tests**

Create `backend/tests/test_uploads.py`:

```python
import io

import pytest


@pytest.mark.anyio
async def test_upload_image(client):
    # Create a minimal 1x1 PNG
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    response = await client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["id"].startswith("file-")
    assert data["filename"] == "test.png"
    assert data["file_type"] == "image/png"
    assert data["file_size"] > 0


@pytest.mark.anyio
async def test_upload_unsupported_type(client):
    response = await client.post(
        "/api/uploads",
        files={"file": ("test.exe", io.BytesIO(b"binary"), "application/octet-stream")},
    )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_serve_uploaded_file(client):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    upload = await client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
    )
    file_id = upload.json()["id"]

    response = await client.get(f"/api/uploads/{file_id}")
    assert response.status_code == 200
    assert "image/png" in response.headers["content-type"]


@pytest.mark.anyio
async def test_upload_requires_auth(anon_client):
    response = await anon_client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(b"fake"), "image/png")},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_serve_nonexistent_file(client):
    response = await client.get("/api/uploads/file-nonexist")
    assert response.status_code == 404
```

- [ ] **Step 2: Create the upload router**

Create `backend/app/routers/uploads.py`:

```python
import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.chat_file import ChatFile
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

ALLOWED_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
}


@router.post("", status_code=201)
async def upload_file(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    # Validate MIME type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Allowed: images, PDFs, text files.",
        )

    # Read and validate size
    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.max_upload_size_mb}MB.",
        )

    # Generate storage path
    ext = os.path.splitext(file.filename or "file")[1] or ""
    unique_name = f"{uuid.uuid4().hex}{ext}"
    user_dir = os.path.join(settings.upload_dir, user.public_id)
    os.makedirs(user_dir, exist_ok=True)
    storage_path = os.path.join(user_dir, unique_name)

    # Write file to disk
    with open(storage_path, "wb") as f:
        f.write(content)

    # Save record
    chat_file = ChatFile(
        user_id=user.id,
        filename=file.filename or "file",
        file_type=content_type,
        file_size=len(content),
        storage_path=storage_path,
    )
    db.add(chat_file)
    await db.commit()
    await db.refresh(chat_file)

    return {
        "id": chat_file.public_id,
        "filename": chat_file.filename,
        "file_type": chat_file.file_type,
        "file_size": chat_file.file_size,
    }


@router.get("/{file_id}")
async def serve_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChatFile).where(
            ChatFile.public_id == file_id, ChatFile.user_id == user.id
        )
    )
    chat_file = result.scalar_one_or_none()
    if not chat_file:
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(chat_file.storage_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        chat_file.storage_path,
        media_type=chat_file.file_type,
        filename=chat_file.filename,
    )
```

- [ ] **Step 3: Register router in main.py**

Add import to `backend/app/main.py`:

```python
from app.routers.uploads import router as uploads_router
```

Add after the last `app.include_router(...)`:

```python
app.include_router(uploads_router)
```

- [ ] **Step 4: Create uploads dir on startup**

In `backend/app/main.py`, inside the `lifespan` function, add after `setup_logging`:

```python
    import os
    os.makedirs(settings.upload_dir, exist_ok=True)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && python3 -m pytest tests/test_uploads.py -v`
Expected: All 5 tests PASS

- [ ] **Step 6: Lint + full suite**

Run: `cd backend && ruff check . && ruff format . && python3 -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/uploads.py backend/tests/test_uploads.py backend/app/main.py
git commit -m "feat: add file upload and serve endpoints"
```

---

### Task 3: Vision-Aware LLM Provider

**Files:**
- Modify: `backend/app/llm/provider.py`

- [ ] **Step 1: Add vision model support**

Read `backend/app/llm/provider.py`. Make these changes:

Add a helper to build a vision-aware OpenAI client:

```python
def _build_vision_client(settings: Settings) -> openai.AsyncOpenAI:
    """Build an OpenAI client for vision requests, using vision-specific keys if set."""
    api_key = settings.vision_api_key or settings.openai_api_key
    base_url = settings.vision_base_url or settings.openai_base_url
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return openai.AsyncOpenAI(**kwargs)
```

Modify `stream_with_tools` to accept `vision: bool = False`:

```python
async def stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = None,
    vision: bool = False,
) -> AsyncIterator[str]:
```

In its body, when `vision=True` and provider is `openai`, pass `vision=True` to `_openai_stream_with_tools`.

Modify `_openai_stream_with_tools` to accept `vision: bool = False`:

```python
async def _openai_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    vision: bool = False,
) -> AsyncIterator[str]:
```

In its body:
- If `vision=True`, use `_build_vision_client(settings)` instead of `_build_openai_client(settings)`
- If `vision=True` and `settings.vision_model`, use `settings.vision_model` instead of `settings.openai_model`
- When vision is on, don't pass tools (vision models often don't support tool calling):

```python
    client = _build_vision_client(settings) if vision else _build_openai_client(settings)
    model = (settings.vision_model or settings.openai_model) if vision else settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    kwargs = {
        "model": model,
        "messages": full_messages,
        "stream": True,
    }
    if tools and not vision:
        kwargs["tools"] = tools
```

For Anthropic with vision, modify `_anthropic_stream` to handle content arrays — Anthropic uses a different image format. Add a helper:

```python
def _convert_to_anthropic_format(messages: list) -> list:
    """Convert OpenAI-style image_url content blocks to Anthropic format."""
    converted = []
    for msg in messages:
        if isinstance(msg.get("content"), list):
            new_content = []
            for block in msg["content"]:
                if block.get("type") == "image_url":
                    url = block["image_url"]["url"]
                    # Extract base64 data from data URL
                    if url.startswith("data:"):
                        parts = url.split(";base64,", 1)
                        media_type = parts[0].replace("data:", "")
                        data = parts[1]
                        new_content.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data,
                            },
                        })
                    else:
                        new_content.append(block)
                else:
                    new_content.append(block)
            converted.append({**msg, "content": new_content})
        else:
            converted.append(msg)
    return converted
```

Then in `_anthropic_stream`, convert messages if they contain content arrays:

```python
async def _anthropic_stream(
    messages: list[dict], settings: Settings
) -> AsyncIterator[str]:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    converted = _convert_to_anthropic_format(messages)
    async with client.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=converted,
    ) as stream:
        async for text in stream.text_stream:
            yield text
```

- [ ] **Step 2: Lint**

Run: `cd backend && ruff check . && ruff format .`

- [ ] **Step 3: Commit**

```bash
git add backend/app/llm/provider.py
git commit -m "feat: add vision model support to LLM provider"
```

---

### Task 4: Wire File Attachments Into Chat Router

**Files:**
- Modify: `backend/app/schemas/chat.py`
- Modify: `backend/app/routers/chats.py`

- [ ] **Step 1: Update MessageCreate schema**

In `backend/app/schemas/chat.py`, change `MessageCreate`:

```python
class MessageCreate(BaseModel):
    content: str
    mode: str = "balanced"
    file_ids: list[str] = []
```

- [ ] **Step 2: Add file processing to send_message**

In `backend/app/routers/chats.py`, add imports at the top:

```python
import base64
import os
from app.models.chat_file import ChatFile
```

In the `event_generator` function inside `send_message`, after the user message content is prepared (after `user_msg_content = ...`), add file processing logic before the LLM messages are built:

Find where `llm_messages` is built (the `build_context_messages` call). After that, add:

```python
        # Process file attachments
        has_vision = False
        if body.file_ids:
            from sqlalchemy import select as sa_select

            file_result = await db.execute(
                sa_select(ChatFile).where(
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
                    image_blocks.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{f.file_type};base64,{b64}"},
                    })
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
```

Then, when calling `stream_with_tools`, pass `vision=has_vision`:

Find the `stream_with_tools` call and add `vision=has_vision`:

```python
            async for chunk in stream_with_tools(
                llm_messages,
                settings,
                tools=tool_defs if tool_defs and not has_vision else None,
                tool_executor=tool_executor if not has_vision else None,
                on_tool_call=on_tool_call_track,
                max_tool_rounds=tool_rounds,
                vision=has_vision,
            ):
```

- [ ] **Step 3: Lint + test**

Run: `cd backend && ruff check . && ruff format . && python3 -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/chat.py backend/app/routers/chats.py
git commit -m "feat: wire file attachments into message flow with vision support"
```

---

### Task 5: Frontend API + sendMessage Update

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add upload API function**

Append to the end of `frontend/src/lib/api.ts`:

```typescript
// ── File Uploads ──

export interface ChatFileOut {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
}

export async function uploadChatFile(file: File): Promise<ChatFileOut> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: "Upload failed" } }));
    throw new Error(err.error?.message || err.detail || "Upload failed");
  }
  return res.json();
}

export function getFileUrl(fileId: string): string {
  return `${API_BASE}/api/uploads/${fileId}`;
}
```

- [ ] **Step 2: Update sendMessage to accept file_ids**

Change the `sendMessage` function signature:

```typescript
export function sendMessage(
  chatId: string,
  content: string,
  callbacks: SSECallbacks,
  mode: ChatMode = "balanced",
  fileIds: string[] = []
): () => void {
```

And change the body line:

```typescript
        body: JSON.stringify({ content, mode, file_ids: fileIds }),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add file upload API and file_ids to sendMessage"
```

---

### Task 6: Chat Input with Attach Button + Paste

**Files:**
- Modify: `frontend/src/components/chat-input.tsx`

- [ ] **Step 1: Update ChatInput component**

Read `frontend/src/components/chat-input.tsx` first. Make these changes:

Add imports:

```tsx
import { Paperclip, X as XIcon } from "lucide-react";
import { uploadChatFile, type ChatFileOut } from "@/lib/api";
```

Update the `ChatInputProps` interface:

```tsx
interface ChatInputProps {
  onSend: (content: string, mode: ChatMode, fileIds: string[]) => void;
  disabled: boolean;
  transparent?: boolean;
}
```

Add state for pending files:

```tsx
const [pendingFiles, setPendingFiles] = useState<
  { id: string; filename: string; file_type: string; previewUrl?: string }[]
>([]);
const [uploading, setUploading] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
```

Add file upload handler:

```tsx
const handleFileSelect = async (files: FileList | null) => {
  if (!files || files.length === 0) return;
  setUploading(true);
  try {
    for (const file of Array.from(files)) {
      const uploaded = await uploadChatFile(file);
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      setPendingFiles((prev) => [
        ...prev,
        {
          id: uploaded.id,
          filename: uploaded.filename,
          file_type: uploaded.file_type,
          previewUrl,
        },
      ]);
    }
  } catch {
    // ignore upload errors
  }
  setUploading(false);
  if (fileInputRef.current) fileInputRef.current.value = "";
};
```

Add paste handler:

```tsx
const handlePaste = (e: React.ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles: File[] = [];
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length > 0) {
    e.preventDefault();
    const dt = new DataTransfer();
    imageFiles.forEach((f) => dt.items.add(f));
    handleFileSelect(dt.files);
  }
};
```

Update `handleSend` to include file IDs:

```tsx
const handleSend = () => {
  const trimmed = value.trim();
  if ((!trimmed && pendingFiles.length === 0) || disabled) return;
  onSend(trimmed, mode, pendingFiles.map((f) => f.id));
  setValue("");
  setPendingFiles([]);
  if (textareaRef.current) {
    textareaRef.current.style.height = "auto";
  }
};
```

Add `onPaste={handlePaste}` to the Textarea.

Add the attach button before the send button:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*,.pdf,.txt,.md"
  multiple
  className="hidden"
  onChange={(e) => handleFileSelect(e.target.files)}
/>
<Button
  variant="ghost"
  size="icon"
  className="shrink-0 rounded-xl"
  onClick={() => fileInputRef.current?.click()}
  disabled={disabled || uploading}
  title="Attach file"
>
  <Paperclip className="h-4 w-4" />
</Button>
```

Add file preview area above the input (before the `<div className="flex items-center gap-2">`):

```tsx
{pendingFiles.length > 0 && (
  <div className="mb-2 flex flex-wrap gap-2">
    {pendingFiles.map((f) => (
      <div
        key={f.id}
        className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2 py-1"
      >
        {f.previewUrl ? (
          <img
            src={f.previewUrl}
            alt={f.filename}
            className="h-8 w-8 rounded object-cover"
          />
        ) : (
          <Paperclip className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="max-w-[120px] truncate text-xs">
          {f.filename}
        </span>
        <button
          onClick={() =>
            setPendingFiles((prev) => prev.filter((p) => p.id !== f.id))
          }
          className="text-muted-foreground hover:text-foreground"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: Update chat page to pass file_ids**

In `frontend/src/app/chat/[id]/page.tsx`, find where `onSend` is called or defined. The `ChatInput` component's `onSend` prop now has 3 arguments: `(content, mode, fileIds)`. Update the handler to pass `fileIds` to the `sendMessage` API call.

Find the `sendMessage` call and add the file IDs:

```tsx
sendMessage(chatId, content, callbacks, mode, fileIds);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat-input.tsx frontend/src/app/chat/[id]/page.tsx
git commit -m "feat: add file attach button and paste handler to chat input"
```

---

### Task 7: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Backend lint + tests**

Run: `cd backend && ruff check . && ruff format --check . && python3 -m pytest tests/ -v`
Expected: All pass (80+ tests)

- [ ] **Step 2: Frontend type check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -v sidebar`
Expected: No new type errors

- [ ] **Step 3: Final format fix if needed**

Run: `cd backend && ruff format .`
Commit if any files changed.
