# Multi-File Artifact Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file artifact system with a unified multi-file project format rendered via Sandpack. All artifacts become projects — even a single React component is a project with one file.

**Architecture:** All artifacts use `<artifact type="project">` with JSON manifest (files + dependencies + template). Backend stores files as JSON. Frontend always renders via Sandpack (file explorer + tabbed Code/Preview). Old `type="react"` and `type="html"` are removed.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), Next.js/React/Sandpack (frontend), Alembic (migrations), pytest (backend tests)

---

## File Map

**Backend — Create:**
- `backend/alembic/versions/0031_add_project_artifact_columns.py` — migration adding template/files/dependencies columns, making code nullable

**Backend — Modify:**
- `backend/app/agent/artifact_parser.py` — rewrite to parse only `type="project"` with JSON manifest
- `backend/app/models/artifact.py` — add template, files, dependencies columns; make code nullable
- `backend/app/schemas/artifact.py` — add new fields, make code optional
- `backend/app/routers/artifacts.py:56-78` — handle files updates in PATCH endpoint
- `backend/app/routers/chats.py:1036-1059` — include new fields in artifact creation + SSE event
- `backend/app/llm/provider.py:45-65` — rewrite system prompt for project-only format

**Backend — Test:**
- `backend/tests/test_artifact_parser.py` — rewrite for project-only parsing
- `backend/tests/test_artifacts_routes.py` — update fixtures and tests for project artifacts

**Frontend — Modify:**
- `frontend/package.json` — add `@codesandbox/sandpack-react`
- `frontend/src/lib/api.ts:901-934` — update ArtifactData type (project only, files required)
- `frontend/src/components/artifact-panel.tsx` — replace with Sandpack-only rendering
- `frontend/src/components/artifact-card.tsx` — update icon and download for project type
- `frontend/src/hooks/use-message-stream.ts:304-314` — map new fields when loading artifacts

**Frontend — Remove (dead code after migration):**
- `frontend/src/components/artifact-preview.tsx` — iframe-based preview no longer needed
- `frontend/src/components/code-editor.tsx` — Monaco editor no longer needed for artifacts (check if used elsewhere first)

---

### Task 1: Rewrite Artifact Parser for Project-Only Format

**Files:**
- Modify: `backend/app/agent/artifact_parser.py`
- Modify: `backend/tests/test_artifact_parser.py`

- [ ] **Step 1: Write new tests for project-only parsing**

Replace `backend/tests/test_artifact_parser.py`:

```python
import json

from app.agent.artifact_parser import parse_artifacts


def test_no_artifacts():
    text = "Here is some plain text response."
    cleaned, artifacts = parse_artifacts(text)
    assert cleaned == text
    assert artifacts == []


def test_single_file_react_project():
    files = {"/App.js": "export default function App() { return <h1>Hello</h1>; }"}
    manifest = json.dumps({"files": files})
    text = (
        "Here is your app:\n\n"
        f'<artifact type="project" title="Hello App" template="react">\n'
        f"{manifest}\n"
        "</artifact>\n\n"
        "Let me know if you want changes."
    )
    cleaned, artifacts = parse_artifacts(text)
    assert "artifact" not in cleaned.lower()
    assert "Let me know" in cleaned
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["type"] == "project"
    assert a["title"] == "Hello App"
    assert a["template"] == "react"
    assert a["files"] == files
    assert a["dependencies"] == {}


def test_multi_file_react_project_with_deps():
    files = {
        "/App.js": "import TodoList from './TodoList';\nexport default function App() { return <TodoList />; }",
        "/TodoList.js": "export default function TodoList() { return <ul><li>Learn React</li></ul>; }",
    }
    deps = {"uuid": "latest"}
    manifest = json.dumps({"files": files, "dependencies": deps})
    text = (
        f'<artifact type="project" title="Todo App" template="react">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["type"] == "project"
    assert a["template"] == "react"
    assert a["files"] == files
    assert a["dependencies"] == deps


def test_vanilla_project():
    files = {"/index.html": "<!DOCTYPE html><html><body>Hi</body></html>"}
    manifest = json.dumps({"files": files})
    text = (
        f'<artifact type="project" title="Static Site" template="vanilla">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["template"] == "vanilla"
    assert a["files"] == files
    assert a["dependencies"] == {}


def test_multiple_project_artifacts():
    files1 = {"/App.js": "function App() {}"}
    files2 = {"/index.html": "<div>hi</div>"}
    text = (
        f'<artifact type="project" title="React App" template="react">\n'
        f'{json.dumps({"files": files1})}\n'
        "</artifact>\n"
        "And also:\n"
        f'<artifact type="project" title="HTML Page" template="vanilla">\n'
        f'{json.dumps({"files": files2})}\n'
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 2
    assert artifacts[0]["title"] == "React App"
    assert artifacts[0]["files"] == files1
    assert artifacts[1]["title"] == "HTML Page"
    assert artifacts[1]["files"] == files2


def test_template_defaults_to_react():
    files = {"/App.js": "function App() {}"}
    manifest = json.dumps({"files": files})
    text = (
        f'<artifact type="project" title="No Template">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    assert artifacts[0]["template"] == "react"


def test_invalid_json_returns_empty():
    text = (
        '<artifact type="project" title="Bad" template="react">\n'
        "this is not json\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    # Invalid JSON — artifact is skipped (LLM error)
    assert artifacts == []
    assert cleaned.strip() == ""


def test_malformed_no_closing_tag():
    text = '<artifact type="project" title="Broken" template="react">\nsome code\n'
    cleaned, artifacts = parse_artifacts(text)
    assert artifacts == []
    assert "some code" in cleaned
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/test_artifact_parser.py -v`

Expected: FAIL — parser still uses old format.

- [ ] **Step 3: Implement the new parser**

Replace `backend/app/agent/artifact_parser.py`:

```python
"""Parse <artifact> tags from LLM response text."""

import json
import re
from typing import List, Tuple

_ARTIFACT_PATTERN = re.compile(
    r'<artifact\s+type="(?P<type>[^"]+)"\s+title="(?P<title>[^"]+)"'
    r'(?:\s+template="(?P<template>[^"]+)")?\s*>\s*\n?'
    r"(?P<content>.*?)"
    r"\s*</artifact>",
    re.DOTALL,
)


def parse_artifacts(text: str) -> Tuple[str, List[dict]]:
    """Parse artifact tags from LLM response.

    Returns:
        (cleaned_text, list of artifact dicts)
        Each artifact: {type, title, template, files, dependencies}
        Artifacts with invalid JSON are skipped.
    """
    artifacts = []

    for match in _ARTIFACT_PATTERN.finditer(text):
        title = match.group("title")
        template = match.group("template") or "react"
        content = match.group("content").strip()

        try:
            manifest = json.loads(content)
        except (json.JSONDecodeError, ValueError):
            continue

        artifacts.append(
            {
                "type": "project",
                "title": title,
                "template": template,
                "files": manifest.get("files", {}),
                "dependencies": manifest.get("dependencies", {}),
            }
        )

    cleaned = _ARTIFACT_PATTERN.sub("", text).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned, artifacts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/test_artifact_parser.py -v`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/artifact_parser.py backend/tests/test_artifact_parser.py
git commit -m "feat: rewrite artifact parser for project-only format with JSON manifest"
```

---

### Task 2: Extend Artifact Model and Migration

**Files:**
- Modify: `backend/app/models/artifact.py`
- Create: `backend/alembic/versions/0031_add_project_artifact_columns.py`

- [ ] **Step 1: Update the Artifact model**

Replace `backend/app/models/artifact.py`:

```python
from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import ForeignKey, JSON, String, Text, func
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
    artifact_type: Mapped[str] = mapped_column(String(20))
    code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    template: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    files: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    dependencies: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 2: Create Alembic migration**

Create `backend/alembic/versions/0031_add_project_artifact_columns.py`:

```python
"""add project artifact columns

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("template", sa.String(20), nullable=True))
    op.add_column("artifacts", sa.Column("files", sa.JSON(), nullable=True))
    op.add_column("artifacts", sa.Column("dependencies", sa.JSON(), nullable=True))
    op.alter_column("artifacts", "code", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.alter_column("artifacts", "code", existing_type=sa.Text(), nullable=False)
    op.drop_column("artifacts", "dependencies")
    op.drop_column("artifacts", "files")
    op.drop_column("artifacts", "template")
```

- [ ] **Step 3: Run existing route tests to verify model changes don't break anything**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/test_artifacts_routes.py -v`

Expected: All existing tests PASS (old fixtures still use `code` field which is still present).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/artifact.py backend/alembic/versions/0031_add_project_artifact_columns.py
git commit -m "feat: add template, files, dependencies columns to artifacts table"
```

---

### Task 3: Extend Schemas and API Endpoints

**Files:**
- Modify: `backend/app/schemas/artifact.py`
- Modify: `backend/app/routers/artifacts.py:56-78`
- Modify: `backend/tests/test_artifacts_routes.py`

- [ ] **Step 1: Write failing tests for project artifact CRUD**

Add to `backend/tests/test_artifacts_routes.py`:

```python
@pytest.fixture
async def chat_with_project_artifact(client, db_engine):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Project Chat"})
    chat_data = chat_resp.json()

    async with session_factory() as session:
        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_data["id"])
        )
        chat = result.scalar_one()

        msg = Message(chat_id=chat.id, role="assistant", content="Here is your project")
        session.add(msg)
        await session.flush()

        artifact = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=chat.user_id,
            title="Test Project",
            artifact_type="project",
            template="react",
            files={"/App.js": "function App() {}", "/utils.js": "export const x = 1;"},
            dependencies={"uuid": "latest"},
        )
        session.add(artifact)
        await session.commit()
        await session.refresh(artifact)

        return {
            "chat_id": chat_data["id"],
            "artifact_id": artifact.public_id,
        }


@pytest.mark.anyio
async def test_get_project_artifact(client, chat_with_project_artifact):
    response = await client.get(
        f"/api/artifacts/{chat_with_project_artifact['artifact_id']}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["artifact_type"] == "project"
    assert data["template"] == "react"
    assert data["files"] == {"/App.js": "function App() {}", "/utils.js": "export const x = 1;"}
    assert data["dependencies"] == {"uuid": "latest"}
    assert data["code"] is None


@pytest.mark.anyio
async def test_update_project_artifact_files(client, chat_with_project_artifact):
    new_files = {"/App.js": "function App() { return <h1>Updated</h1>; }"}
    response = await client.patch(
        f"/api/artifacts/{chat_with_project_artifact['artifact_id']}",
        json={"files": new_files},
    )
    assert response.status_code == 200
    assert response.json()["files"] == new_files
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/test_artifacts_routes.py::test_get_project_artifact backend/tests/test_artifacts_routes.py::test_update_project_artifact_files -v`

Expected: FAIL — schema doesn't include new fields, PATCH doesn't handle files.

- [ ] **Step 3: Update schemas**

Replace `backend/app/schemas/artifact.py`:

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
    code: Optional[str] = None
    template: Optional[str] = None
    files: Optional[dict] = None
    dependencies: Optional[dict] = None
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
            template=artifact.template,
            files=artifact.files,
            dependencies=artifact.dependencies,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )


class ArtifactUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    files: Optional[dict] = None
```

- [ ] **Step 4: Update PATCH endpoint to handle files**

In `backend/app/routers/artifacts.py`, add after the `if body.title is not None:` block (after line 75):

```python
    if body.files is not None:
        artifact.files = body.files
```

- [ ] **Step 5: Run all route tests**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/test_artifacts_routes.py -v`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/artifact.py backend/app/routers/artifacts.py backend/tests/test_artifacts_routes.py
git commit -m "feat: extend artifact schema and API for project artifacts"
```

---

### Task 4: Update SSE Emission and System Prompt

**Files:**
- Modify: `backend/app/routers/chats.py:1036-1059`
- Modify: `backend/app/llm/provider.py:45-65`

- [ ] **Step 1: Update artifact creation in SSE stream**

In `backend/app/routers/chats.py`, replace lines 1036-1059 (the `# Save and emit artifacts` block):

```python
                # Save and emit artifacts
                for art_data in found_artifacts:
                    artifact = Artifact(
                        message_id=assistant_msg.id,
                        chat_id=chat.id,
                        user_id=user_id,
                        title=art_data["title"],
                        artifact_type="project",
                        template=art_data.get("template", "react"),
                        files=art_data.get("files", {}),
                        dependencies=art_data.get("dependencies", {}),
                    )
                    db.add(artifact)
                    await db.commit()
                    await db.refresh(artifact)
                    await queue.put({
                        "event": "artifact",
                        "data": json.dumps(
                            {
                                "id": artifact.public_id,
                                "type": "project",
                                "title": artifact.title,
                                "template": artifact.template,
                                "files": artifact.files,
                                "dependencies": artifact.dependencies,
                            }
                        ),
                    })
```

- [ ] **Step 2: Update the system prompt**

In `backend/app/llm/provider.py`, replace the `SYSTEM_PROMPT` string (lines 45-65):

```python
SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely.\n\n"
    "When the user asks you to build, create, or generate a UI component, "
    "web page, or interactive application, wrap your code in an artifact tag.\n\n"
    "Always use the project format with a JSON manifest:\n\n"
    '<artifact type="project" title="Project Name" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "export default function App() { return <h1>Hello</h1>; }"\n'
    '  },\n'
    '  "dependencies": {}\n'
    '}\n'
    "</artifact>\n\n"
    "For multi-file projects:\n\n"
    '<artifact type="project" title="Todo App" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "import Counter from \'./Counter\';\\nexport default function App() { return <Counter />; }",\n'
    '    "/Counter.js": "export default function Counter() { ... }"\n'
    '  },\n'
    '  "dependencies": {\n'
    '    "uuid": "latest"\n'
    '  }\n'
    '}\n'
    "</artifact>\n\n"
    "Rules for artifacts:\n"
    "- Always use type=\"project\" with a JSON manifest.\n"
    "- template is \"react\" (default) or \"vanilla\" (plain HTML/JS).\n"
    "- React projects must include /App.js as the entry point.\n"
    "- Vanilla projects must include /index.html as the entry point.\n"
    "- The files object has file paths as keys (starting with /) and code strings as values.\n"
    "- The dependencies object maps npm package names to version strings. Use {} if none.\n"
    "- Even simple single-component UIs use this format (one file is fine).\n"
    "- Always include the artifact tag when generating UI code.\n"
    "- You can still include explanation text outside the artifact tag."
)
```

- [ ] **Step 3: Run all backend tests**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/ -v`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/chats.py backend/app/llm/provider.py
git commit -m "feat: update SSE artifact emission and system prompt for project-only format"
```

---

### Task 5: Install Sandpack and Update Frontend Types

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/api.ts:901-934`
- Modify: `frontend/src/hooks/use-message-stream.ts:304-314`

- [ ] **Step 1: Install Sandpack**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts/frontend && npm install @codesandbox/sandpack-react`

- [ ] **Step 2: Update ArtifactData type**

In `frontend/src/lib/api.ts`, replace lines 901-906:

```typescript
export interface ArtifactData {
  id: string;
  type: "project";
  title: string;
  template: string;
  files: Record<string, string>;
  dependencies: Record<string, string>;
}
```

- [ ] **Step 3: Update ArtifactOut type**

In `frontend/src/lib/api.ts`, replace lines 908-914:

```typescript
export interface ArtifactOut extends ArtifactData {
  message_id: string;
  chat_id: string;
  artifact_type: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Update updateArtifact function**

In `frontend/src/lib/api.ts`, replace lines 924-934:

```typescript
export async function updateArtifact(
  artifactId: string,
  updates: { title?: string; files?: Record<string, string> }
): Promise<ArtifactOut> {
  const res = await authFetch(`${API_BASE}/api/artifacts/${artifactId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update artifact");
  return res.json();
}
```

- [ ] **Step 5: Update artifact loading in use-message-stream**

In `frontend/src/hooks/use-message-stream.ts`, replace lines 304-314:

```typescript
      listArtifacts(chatId)
        .then((arts) => {
          setArtifacts(
            arts.map((a) => ({
              id: a.id,
              type: "project" as const,
              title: a.title,
              template: a.template ?? "react",
              files: a.files ?? {},
              dependencies: a.dependencies ?? {},
            }))
          );
        })
        .catch(() => {});
```

- [ ] **Step 6: Fix any remaining TypeScript references to old artifact types**

Search for `"react" | "html"` and `artifact.code` in frontend source files and update them to use the new type. Key places:
- `frontend/src/hooks/use-message-stream.ts:193-196` — the `onArtifact` callback. Update to:
```typescript
        onArtifact: (artifact) => {
          setArtifacts((prev) => [...prev, artifact]);
          setActiveArtifact(artifact);
        },
```
(This should work as-is since the SSE now sends the project format.)

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/api.ts frontend/src/hooks/use-message-stream.ts
git commit -m "feat: install Sandpack and update frontend types for project-only artifacts"
```

---

### Task 6: Implement Sandpack Artifact Panel

**Files:**
- Modify: `frontend/src/components/artifact-panel.tsx`

- [ ] **Step 1: Replace artifact-panel.tsx with Sandpack-only rendering**

Replace `frontend/src/components/artifact-panel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { X, Eye, Code, Copy, Check, RotateCw } from "lucide-react";
import {
  SandpackProvider,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { Button } from "@/components/ui/button";
import { updateArtifact, type ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ArtifactPanelProps {
  artifact: ArtifactData;
  onClose: () => void;
  onCodeChange?: (artifactId: string, code: string) => void;
}

/* ── Sandpack save bridge — watches file changes and auto-saves ── */

function SandpackSaveBridge({ artifactId }: { artifactId: string }) {
  const { sandpack } = useSandpack();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFilesRef = useRef<string>("");

  useEffect(() => {
    const currentFiles: Record<string, string> = {};
    for (const path of Object.keys(sandpack.files)) {
      currentFiles[path] = sandpack.files[path].code;
    }
    const serialized = JSON.stringify(currentFiles);

    if (prevFilesRef.current && serialized !== prevFilesRef.current) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifactId, { files: currentFiles }).catch(() =>
          toast.error("Failed to save project")
        );
      }, 1000);
    }
    prevFilesRef.current = serialized;
  });

  return null;
}

/* ── Main artifact panel ── */

export function ArtifactPanel({ artifact, onClose }: ArtifactPanelProps) {
  const [tab, setTab] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);

  const template = artifact.template === "vanilla" ? "vanilla" : "react";
  const fileCount = Object.keys(artifact.files).length;

  const handleCopy = () => {
    const text = Object.entries(artifact.files)
      .map(([path, code]) => `// ${path}\n${code}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium max-w-[160px]">
          {artifact.title}
        </span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </Badge>
        <span className="text-muted-foreground text-xs">·</span>
        <div className="flex items-center rounded-md bg-muted p-0.5">
          <button
            onClick={() => setTab("code")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-3 w-3" />
            Code
          </button>
          <button
            onClick={() => setTab("preview")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "preview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
          title="Copy all files"
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
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Sandpack */}
      <div className="flex-1 overflow-hidden">
        <SandpackProvider
          template={template}
          files={artifact.files}
          customSetup={{
            dependencies: artifact.dependencies ?? {},
          }}
          theme="dark"
          options={{
            activeFile: Object.keys(artifact.files)[0] ?? "/App.js",
          }}
        >
          <SandpackSaveBridge artifactId={artifact.id} />
          <div className="flex h-full">
            {/* File explorer */}
            <div className="w-[150px] shrink-0 overflow-y-auto border-r">
              <SandpackFileExplorer />
            </div>
            {/* Editor or Preview */}
            <div className="flex-1 overflow-hidden">
              {tab === "code" ? (
                <SandpackCodeEditor
                  showLineNumbers
                  showTabs={false}
                  style={{ height: "100%" }}
                />
              ) : (
                <SandpackPreview
                  showNavigator={false}
                  showRefreshButton
                  style={{ height: "100%" }}
                />
              )}
            </div>
          </div>
        </SandpackProvider>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remove dead imports and verify no other files import ArtifactPreview or CodeEditor for artifact use**

Check if `artifact-preview.tsx` and `code-editor.tsx` are used by anything other than the old artifact panel. If `code-editor.tsx` is used elsewhere (e.g., skill editor), leave it. Delete `artifact-preview.tsx` since it's only used by the old panel.

Run: `grep -r "artifact-preview" frontend/src/ --include="*.tsx" --include="*.ts"`
Run: `grep -r "code-editor" frontend/src/ --include="*.tsx" --include="*.ts"`

If `artifact-preview` is only imported in `artifact-panel.tsx` (which we just replaced), delete it:
```bash
rm frontend/src/components/artifact-preview.tsx
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/artifact-panel.tsx
git add -u  # picks up deleted files
git commit -m "feat: replace artifact panel with Sandpack-only rendering"
```

---

### Task 7: Update Artifact Card

**Files:**
- Modify: `frontend/src/components/artifact-card.tsx`

- [ ] **Step 1: Replace artifact-card.tsx with project-only version**

Replace `frontend/src/components/artifact-card.tsx`:

```tsx
"use client";

import { Layers, Download } from "lucide-react";
import type { ArtifactData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function downloadProject(artifact: ArtifactData) {
  const content = Object.entries(artifact.files)
    .map(([path, code]) => `// === ${path} ===\n${code}`)
    .join("\n\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ArtifactCard({
  artifact,
  onClick,
}: {
  artifact: ArtifactData;
  onClick: () => void;
}) {
  const fileCount = Object.keys(artifact.files).length;

  return (
    <div className="mt-2 flex w-full items-center gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50">
      <button
        onClick={onClick}
        className="flex flex-1 items-center gap-3 text-left min-w-0"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {artifact.title}
            </span>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Click to open</p>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          downloadProject(artifact);
        }}
        title="Download"
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/artifact-card.tsx
git commit -m "feat: update artifact card with Layers icon and file count for project format"
```

---

### Task 8: Final Build Verification and Cleanup

- [ ] **Step 1: Run all backend tests**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts && python3 -m pytest backend/tests/ -v`

Expected: All tests PASS.

- [ ] **Step 2: Run frontend build**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/.worktrees/multi-file-artifacts/frontend && npx next build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Search for any remaining references to old artifact types**

Run: `grep -rn '"react" | "html"' frontend/src/ --include="*.ts" --include="*.tsx"` to find any stale type references.
Run: `grep -rn 'artifact.code' frontend/src/ --include="*.ts" --include="*.tsx"` to find any stale code field usage.
Run: `grep -rn 'type="react"' backend/ --include="*.py"` to find any stale backend references.

Fix any found references.

- [ ] **Step 4: Commit cleanup if any changes were needed**

```bash
git add -A
git commit -m "chore: clean up stale artifact type references"
```
