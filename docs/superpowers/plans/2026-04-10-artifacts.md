# Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude-style artifacts — the AI generates React/HTML code that renders live in a right-side panel with an editable code view.

**Architecture:** Backend parses `<artifact>` tags from LLM responses, saves to DB, emits via SSE. Frontend renders in a sandboxed iframe with a split-panel layout. Code edits update the preview live and persist via API.

**Tech Stack:** SQLAlchemy model, artifact tag parser (regex), SSE `artifact` event, sandboxed iframe with React/Babel/Tailwind CDN, CodeMirror or textarea editor.

---

### Task 1: Artifact Model + Migration

**Files:**
- Create: `backend/app/models/artifact.py`
- Create: `backend/alembic/versions/0017_create_artifacts_table.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Create the Artifact model**

Create `backend/app/models/artifact.py`:

```python
from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "art")
    )
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    artifact_type: Mapped[str] = mapped_column(String(20))  # "react" or "html"
    code: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 2: Create the migration**

Create `backend/alembic/versions/0017_create_artifacts_table.py`:

```python
"""create artifacts table

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "artifacts",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "message_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("artifact_type", sa.String(20), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("artifacts")
```

- [ ] **Step 3: Add model import to conftest**

Add to `backend/tests/conftest.py` with the other model imports:

```python
from app.models.artifact import Artifact  # noqa: F401
```

- [ ] **Step 4: Verify import**

Run: `cd backend && python3 -c "from app.models.artifact import Artifact; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/artifact.py backend/alembic/versions/0017_create_artifacts_table.py backend/tests/conftest.py
git commit -m "feat: add Artifact model and migration"
```

---

### Task 2: Artifact Parser

**Files:**
- Create: `backend/app/agent/artifact_parser.py`
- Create: `backend/tests/test_artifact_parser.py`

- [ ] **Step 1: Write parser tests**

Create `backend/tests/test_artifact_parser.py`:

```python
from app.agent.artifact_parser import parse_artifacts


def test_no_artifacts():
    text = "Here is some plain text response."
    cleaned, artifacts = parse_artifacts(text)
    assert cleaned == text
    assert artifacts == []


def test_single_react_artifact():
    text = (
        'Here is your app:\n\n'
        '<artifact type="react" title="Todo App">\n'
        'export default function App() {\n'
        '  return <h1>Hello</h1>;\n'
        '}\n'
        '</artifact>\n\n'
        'Let me know if you want changes.'
    )
    cleaned, artifacts = parse_artifacts(text)
    assert "artifact" not in cleaned.lower()
    assert "Let me know" in cleaned
    assert len(artifacts) == 1
    assert artifacts[0]["type"] == "react"
    assert artifacts[0]["title"] == "Todo App"
    assert "export default" in artifacts[0]["code"]


def test_single_html_artifact():
    text = (
        '<artifact type="html" title="Landing Page">\n'
        '<!DOCTYPE html>\n<html><body>Hi</body></html>\n'
        '</artifact>'
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    assert artifacts[0]["type"] == "html"
    assert artifacts[0]["title"] == "Landing Page"
    assert "<!DOCTYPE html>" in artifacts[0]["code"]


def test_multiple_artifacts():
    text = (
        '<artifact type="react" title="App">\nfunction App() {}\n</artifact>\n'
        'Some text\n'
        '<artifact type="html" title="Page">\n<div>hi</div>\n</artifact>'
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 2
    assert artifacts[0]["title"] == "App"
    assert artifacts[1]["title"] == "Page"


def test_malformed_no_closing_tag():
    text = '<artifact type="react" title="Broken">\nsome code\n'
    cleaned, artifacts = parse_artifacts(text)
    # Should not extract anything if no closing tag
    assert artifacts == []
    assert "some code" in cleaned
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python3 -m pytest tests/test_artifact_parser.py -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the parser**

Create `backend/app/agent/artifact_parser.py`:

```python
"""Parse <artifact> tags from LLM response text.

Extracts artifact metadata and code, returns cleaned text with tags removed.
"""

import re
from typing import List, Tuple

_ARTIFACT_PATTERN = re.compile(
    r'<artifact\s+type="(?P<type>[^"]+)"\s+title="(?P<title>[^"]+)">\s*\n?'
    r"(?P<code>.*?)"
    r"\s*</artifact>",
    re.DOTALL,
)


def parse_artifacts(text: str) -> Tuple[str, List[dict]]:
    """Parse artifact tags from LLM response.

    Returns:
        (cleaned_text, list of {type, title, code} dicts)
    """
    artifacts = []

    for match in _ARTIFACT_PATTERN.finditer(text):
        artifacts.append(
            {
                "type": match.group("type"),
                "title": match.group("title"),
                "code": match.group("code").strip(),
            }
        )

    # Remove artifact tags from text
    cleaned = _ARTIFACT_PATTERN.sub("", text).strip()
    # Clean up extra blank lines left behind
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned, artifacts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python3 -m pytest tests/test_artifact_parser.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/artifact_parser.py backend/tests/test_artifact_parser.py
git commit -m "feat: add artifact tag parser"
```

---

### Task 3: Artifact Schemas + API Router

**Files:**
- Create: `backend/app/schemas/artifact.py`
- Create: `backend/app/routers/artifacts.py`
- Create: `backend/tests/test_artifacts_routes.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create schemas**

Create `backend/app/schemas/artifact.py`:

```python
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ArtifactOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    message_id: str
    chat_id: str
    title: str
    artifact_type: str
    code: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @classmethod
    def from_artifact(cls, artifact) -> "ArtifactOut":
        return cls(
            id=artifact.public_id,
            message_id=str(artifact.message_id),
            chat_id=str(artifact.chat_id),
            title=artifact.title,
            artifact_type=artifact.artifact_type,
            code=artifact.code,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )


class ArtifactUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
```

- [ ] **Step 2: Write route tests**

Create `backend/tests/test_artifacts_routes.py`:

```python
import pytest

from app.models.artifact import Artifact
from app.models.chat import Chat, Message


@pytest.fixture
async def chat_with_artifact(client, db_engine):
    """Create a chat with a message and an artifact for testing."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Create chat via API
    chat_resp = await client.post("/api/chats", json={"title": "Artifact Chat"})
    chat_data = chat_resp.json()

    # Insert message and artifact directly into DB
    async with session_factory() as session:
        from sqlalchemy import select

        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_data["id"])
        )
        chat = result.scalar_one()

        msg = Message(chat_id=chat.id, role="assistant", content="Here is your app")
        session.add(msg)
        await session.flush()

        artifact = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=chat.user_id,
            title="Test App",
            artifact_type="react",
            code='export default function App() { return <h1>Hi</h1>; }',
        )
        session.add(artifact)
        await session.commit()
        await session.refresh(artifact)

        return {
            "chat_id": chat_data["id"],
            "artifact_id": artifact.public_id,
        }


@pytest.mark.anyio
async def test_list_artifacts(client, chat_with_artifact):
    data = await chat_with_artifact
    response = await client.get(f"/api/chats/{data['chat_id']}/artifacts")
    assert response.status_code == 200
    artifacts = response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["title"] == "Test App"
    assert artifacts[0]["artifact_type"] == "react"


@pytest.mark.anyio
async def test_get_artifact(client, chat_with_artifact):
    data = await chat_with_artifact
    response = await client.get(f"/api/artifacts/{data['artifact_id']}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test App"


@pytest.mark.anyio
async def test_update_artifact_code(client, chat_with_artifact):
    data = await chat_with_artifact
    response = await client.patch(
        f"/api/artifacts/{data['artifact_id']}",
        json={"code": "export default function App() { return <h1>Updated</h1>; }"},
    )
    assert response.status_code == 200
    assert "Updated" in response.json()["code"]


@pytest.mark.anyio
async def test_get_nonexistent_artifact(client):
    response = await client.get("/api/artifacts/art-nonexist")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_artifacts_require_auth(anon_client):
    response = await anon_client.get("/api/chats/chat-fake/artifacts")
    assert response.status_code == 401
```

- [ ] **Step 3: Create the router**

Create `backend/app/routers/artifacts.py`:

```python
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.artifact import Artifact
from app.models.chat import Chat
from app.models.user import User
from app.schemas.artifact import ArtifactOut, ArtifactUpdate

router = APIRouter(tags=["artifacts"])


@router.get("/api/chats/{chat_id}/artifacts", response_model=List[ArtifactOut])
async def list_artifacts(
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
        select(Artifact)
        .where(Artifact.chat_id == chat.id)
        .order_by(Artifact.created_at)
    )
    artifacts = result.scalars().all()
    return [ArtifactOut.from_artifact(a) for a in artifacts]


@router.get("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_id, Artifact.user_id == user.id
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return ArtifactOut.from_artifact(artifact)


@router.patch("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def update_artifact(
    artifact_id: str,
    body: ArtifactUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_id, Artifact.user_id == user.id
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    if body.code is not None:
        artifact.code = body.code
    if body.title is not None:
        artifact.title = body.title
    await db.commit()
    await db.refresh(artifact)
    return ArtifactOut.from_artifact(artifact)
```

- [ ] **Step 4: Register router in main.py**

Add import to `backend/app/main.py`:

```python
from app.routers.artifacts import router as artifacts_router
```

Add after the last `include_router`:

```python
app.include_router(artifacts_router)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && python3 -m pytest tests/test_artifacts_routes.py -v`
Expected: All 5 tests PASS

- [ ] **Step 6: Lint + full suite**

Run: `cd backend && ruff check . && ruff format . && python3 -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/artifact.py backend/app/routers/artifacts.py backend/tests/test_artifacts_routes.py backend/app/main.py
git commit -m "feat: add artifact API endpoints"
```

---

### Task 4: System Prompt + SSE Integration

**Files:**
- Modify: `backend/app/llm/provider.py` (system prompt)
- Modify: `backend/app/routers/chats.py` (parse artifacts from response, save, emit SSE)

- [ ] **Step 1: Update the system prompt**

In `backend/app/llm/provider.py`, change the `SYSTEM_PROMPT` constant:

```python
SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely.\n\n"
    "When the user asks you to build, create, or generate a UI component, "
    "web page, or interactive application, wrap your code in an artifact tag:\n\n"
    '<artifact type="react" title="Component Name">\n'
    "export default function App() {\n"
    "  // Your React component here\n"
    "}\n"
    "</artifact>\n\n"
    'For plain HTML/CSS pages, use type="html":\n\n'
    '<artifact type="html" title="Page Name">\n'
    "<!DOCTYPE html>\n"
    "<html>...</html>\n"
    "</artifact>\n\n"
    "Rules for artifacts:\n"
    "- Use a single file. Put all styles inline or use Tailwind CSS classes.\n"
    "- React artifacts must export a default function component named App.\n"
    "- Always include the artifact tag when generating UI code.\n"
    "- You can still include explanation text outside the artifact tag."
)
```

- [ ] **Step 2: Wire artifact parsing into send_message**

In `backend/app/routers/chats.py`, add this import at the top with the other imports:

```python
from app.agent.artifact_parser import parse_artifacts
from app.models.artifact import Artifact
```

Then, in the `event_generator` function, find the section after `full_response` is complete (around the "Save assistant message" comment, after sources are built). Replace the assistant message saving block with:

Find this code (approximately lines 346-356):
```python
            # Save assistant message
            sources_json = json.dumps(sources_data) if skills_used else None
            assistant_msg = Message(
                chat_id=chat.id,
                role="assistant",
                content=full_response,
                sources_json=sources_json,
            )
            db.add(assistant_msg)
            chat.updated_at = func.now()
            await db.commit()
```

Replace with:
```python
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
```

- [ ] **Step 3: Lint + test**

Run: `cd backend && ruff check . && ruff format . && python3 -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/app/llm/provider.py backend/app/routers/chats.py
git commit -m "feat: parse artifacts from LLM response and emit via SSE"
```

---

### Task 5: Frontend API + SSE Handler

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add artifact types**

Add to `frontend/src/lib/api.ts` after the sharing section at the bottom:

```typescript
// ── Artifact Types ──

export interface ArtifactData {
  id: string;
  type: "react" | "html";
  title: string;
  code: string;
}

export interface ArtifactOut extends ArtifactData {
  message_id: string;
  chat_id: string;
  artifact_type: string;
  created_at: string;
  updated_at: string;
}

// ── Artifact API ──

export async function listArtifacts(chatId: string): Promise<ArtifactOut[]> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/artifacts`);
  if (!res.ok) throw new Error("Failed to list artifacts");
  return res.json();
}

export async function updateArtifact(
  artifactId: string,
  updates: { code?: string; title?: string }
): Promise<ArtifactOut> {
  const res = await authFetch(`${API_BASE}/api/artifacts/${artifactId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update artifact");
  return res.json();
}
```

- [ ] **Step 2: Add artifact callback to SSECallbacks**

In the `SSECallbacks` interface, add:

```typescript
  onArtifact?: (artifact: ArtifactData) => void;
```

- [ ] **Step 3: Handle artifact SSE event in sendMessage**

In the `sendMessage` function's switch statement (the `processEvents` function), add a case for `artifact`:

```typescript
            case "artifact":
              try {
                callbacks.onArtifact?.(JSON.parse(data));
              } catch {}
              break;
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add artifact types, API functions, and SSE handler"
```

---

### Task 6: Artifact Preview Component

**Files:**
- Create: `frontend/src/components/artifact-preview.tsx`

- [ ] **Step 1: Create the preview component**

Create `frontend/src/components/artifact-preview.tsx`:

```tsx
"use client";

import { useMemo } from "react";

interface ArtifactPreviewProps {
  code: string;
  type: "react" | "html";
}

const REACT_TEMPLATE = (code: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    #error { color: #dc2626; padding: 16px; font-family: monospace; white-space: pre-wrap; display: none; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error"></div>
  <script type="text/babel" data-type="module">
    try {
      ${code}

      const _App = typeof App !== 'undefined' ? App : (() => React.createElement('div', null, 'No App component found'));
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_App));
    } catch (e) {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = e.message + '\\n' + e.stack;
    }
  </script>
  <script>
    window.onerror = function(msg, src, line, col, err) {
      var el = document.getElementById('error');
      el.style.display = 'block';
      el.textContent = msg + '\\nLine: ' + line;
    };
  </script>
</body>
</html>`;

export function ArtifactPreview({ code, type }: ArtifactPreviewProps) {
  const srcdoc = useMemo(() => {
    if (type === "html") return code;
    return REACT_TEMPLATE(code);
  }, [code, type]);

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      title="Artifact preview"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/artifact-preview.tsx
git commit -m "feat: add artifact preview iframe component"
```

---

### Task 7: Artifact Panel Component

**Files:**
- Create: `frontend/src/components/artifact-panel.tsx`

- [ ] **Step 1: Create the panel component**

Create `frontend/src/components/artifact-panel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArtifactPreview } from "@/components/artifact-preview";
import { updateArtifact, type ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

interface ArtifactPanelProps {
  artifact: ArtifactData;
  onClose: () => void;
  onCodeChange?: (artifactId: string, code: string) => void;
}

export function ArtifactPanel({
  artifact,
  onClose,
  onCodeChange,
}: ArtifactPanelProps) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [localCode, setLocalCode] = useState(artifact.code);
  const [copied, setCopied] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when artifact changes (e.g., switching between artifacts)
  useEffect(() => {
    setLocalCode(artifact.code);
  }, [artifact.id, artifact.code]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setLocalCode(newCode);
      onCodeChange?.(artifact.id, newCode);

      // Debounced save to backend
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifact.id, { code: newCode }).catch(() => {});
      }, 1000);
    },
    [artifact.id, onCodeChange]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(localCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate max-w-[200px]">
            {artifact.title}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {artifact.type}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-3">
        <button
          onClick={() => setTab("preview")}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "preview"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
        <button
          onClick={() => setTab("code")}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "code"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code className="h-3.5 w-3.5" />
          Code
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "preview" ? (
          <ArtifactPreview code={localCode} type={artifact.type} />
        ) : (
          <textarea
            value={localCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            className="h-full w-full resize-none border-0 bg-muted/30 p-4 font-mono text-sm focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/artifact-panel.tsx
git commit -m "feat: add artifact panel with preview and code editor"
```

---

### Task 8: Artifact Card in Message Bubble

**Files:**
- Create: `frontend/src/components/artifact-card.tsx`

- [ ] **Step 1: Create the artifact card component**

Create `frontend/src/components/artifact-card.tsx`:

```tsx
"use client";

import { Code, Globe } from "lucide-react";
import type { ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

interface ArtifactCardProps {
  artifact: ArtifactData;
  onClick: () => void;
}

export function ArtifactCard({ artifact, onClick }: ArtifactCardProps) {
  return (
    <button
      onClick={onClick}
      className="mt-2 flex w-full items-center gap-3 rounded-lg border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {artifact.type === "react" ? (
          <Code className="h-5 w-5" />
        ) : (
          <Globe className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{artifact.title}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {artifact.type}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Click to open</p>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/artifact-card.tsx
git commit -m "feat: add artifact card component for message bubbles"
```

---

### Task 9: Wire Everything Into Chat Page

**Files:**
- Modify: `frontend/src/app/chat/[id]/page.tsx`

- [ ] **Step 1: Read the current chat page**

Read `frontend/src/app/chat/[id]/page.tsx` to understand the full layout before modifying.

- [ ] **Step 2: Add artifact imports and state**

Add imports at the top:

```tsx
import { ArtifactPanel } from "@/components/artifact-panel";
import { ArtifactCard } from "@/components/artifact-card";
import { listArtifacts, type ArtifactData } from "@/lib/api";
```

Add state inside `ChatPage`:

```tsx
const [artifacts, setArtifacts] = useState<ArtifactData[]>([]);
const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null);
```

- [ ] **Step 3: Load artifacts when chat loads**

In the effect that loads the chat (the `useEffect` that calls `getChat`), add after messages are set:

```tsx
// Load artifacts for this chat
listArtifacts(chatId).then(arts => {
  setArtifacts(arts.map(a => ({
    id: a.public_id || a.id,
    type: a.artifact_type as "react" | "html",
    title: a.title,
    code: a.code,
  })));
}).catch(() => {});
```

- [ ] **Step 4: Handle artifact SSE events**

In the `sendMessage` call's callbacks, add:

```tsx
onArtifact: (artifact) => {
  setArtifacts(prev => [...prev, artifact]);
  setActiveArtifact(artifact);
},
```

- [ ] **Step 5: Update the layout to split when artifact is active**

Wrap the main content in a grid that splits when an artifact is active. The exact implementation depends on the current JSX structure — read the file and wrap the chat area:

```tsx
<div className={`flex h-full ${activeArtifact ? "grid grid-cols-2" : ""}`}>
  {/* Existing chat content */}
  <div className="flex flex-col h-full overflow-hidden">
    {/* ... messages, input ... */}
  </div>

  {/* Artifact panel */}
  {activeArtifact && (
    <ArtifactPanel
      artifact={activeArtifact}
      onClose={() => setActiveArtifact(null)}
      onCodeChange={(id, code) => {
        setArtifacts(prev =>
          prev.map(a => (a.id === id ? { ...a, code } : a))
        );
        setActiveArtifact(prev =>
          prev && prev.id === id ? { ...prev, code } : prev
        );
      }}
    />
  )}
</div>
```

- [ ] **Step 6: Add artifact cards to messages**

In the message rendering, for assistant messages that have associated artifacts, render `ArtifactCard` components after the message bubble. Find where `DisplayMessage` objects are rendered and check if any artifact's `message_id` matches, or simply render artifact cards for the last message when artifacts arrive via SSE.

A simpler approach: render artifact cards at the end of any assistant message that was the source of an artifact. Since artifacts arrive via SSE after the message, attach them to the most recent assistant message:

```tsx
{/* After the message bubble, check for artifacts */}
{msg.role === "assistant" && artifacts
  .filter(a => /* associated with this message */)
  .map(a => (
    <ArtifactCard
      key={a.id}
      artifact={a}
      onClick={() => setActiveArtifact(a)}
    />
  ))
}
```

The exact wiring depends on how messages are rendered — read the file and adapt. The key states are: `artifacts`, `activeArtifact`, and the `onArtifact` callback.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/chat/[id]/page.tsx
git commit -m "feat: wire artifact panel into chat page with split layout"
```

---

### Task 10: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Backend lint + tests**

Run: `cd backend && ruff check . && ruff format --check . && python3 -m pytest tests/ -v`
Expected: All pass (60+ tests)

- [ ] **Step 2: Frontend type check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -v sidebar`
Expected: No new type errors

- [ ] **Step 3: Final format fix if needed**

Run: `cd backend && ruff format .`
Commit if any files changed.
