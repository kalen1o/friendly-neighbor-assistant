# Schedule Edit Dialog & Run History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit-in-place for scheduled agents and a persistent run history log with a detail page and cursor-based pagination.

**Architecture:** New `schedule_run_history` table tracks every execution. A new `/schedules/[id]` detail page shows full schedule info, edit button, and paginated run history. The existing add dialog is refactored to handle both create and edit modes.

**Tech Stack:** SQLAlchemy (async), Alembic, FastAPI, Next.js App Router, Tailwind CSS, shadcn/ui

---

### Task 1: Backend — ScheduleRunHistory model + migration

**Files:**
- Create: `backend/app/models/schedule_run_history.py`
- Create: `backend/alembic/versions/0034_add_schedule_run_history.py`
- Modify: `backend/tests/conftest.py` (add model import)

- [ ] **Step 1: Create the ScheduleRunHistory model**

Create `backend/app/models/schedule_run_history.py`:

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, func, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScheduleRunHistory(Base):
    __tablename__ = "schedule_run_history"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("scheduled_tasks.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20))  # running, success, error
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
```

- [ ] **Step 2: Create the Alembic migration**

Create `backend/alembic/versions/0034_add_schedule_run_history.py`:

```python
"""add schedule run history table

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedule_run_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["scheduled_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedule_run_history_task_id", "schedule_run_history", ["task_id"])
    op.create_index(
        "ix_schedule_run_history_task_started",
        "schedule_run_history",
        ["task_id", "started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_schedule_run_history_task_started")
    op.drop_index("ix_schedule_run_history_task_id")
    op.drop_table("schedule_run_history")
```

- [ ] **Step 3: Register model in test conftest**

In `backend/tests/conftest.py`, add this import alongside the other model imports (after line 18):

```python
from app.models.schedule_run_history import ScheduleRunHistory  # noqa: F401
```

- [ ] **Step 4: Run migration and verify**

```bash
cd backend && alembic upgrade head
```

Expected: Migration applies cleanly, `schedule_run_history` table exists.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/schedule_run_history.py backend/alembic/versions/0034_add_schedule_run_history.py backend/tests/conftest.py
git commit -m "feat: add ScheduleRunHistory model and migration"
```

---

### Task 2: Backend — Schemas + history API endpoint

**Files:**
- Modify: `backend/app/schemas/scheduled_task.py`
- Modify: `backend/app/routers/schedules.py`

- [ ] **Step 1: Add run history schemas**

In `backend/app/schemas/scheduled_task.py`, add after the existing classes:

```python
class ScheduleRunOut(BaseModel):
    id: int
    status: str
    error: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None

    model_config = {"from_attributes": True}


class ScheduleRunHistoryPage(BaseModel):
    runs: list[ScheduleRunOut]
    next_cursor: Optional[str] = None
    has_more: bool
```

- [ ] **Step 2: Add the history endpoint**

In `backend/app/routers/schedules.py`, add this import at the top:

```python
from datetime import datetime as dt_datetime
```

Add these imports to the existing import from `app.schemas.scheduled_task`:

```python
from app.schemas.scheduled_task import (
    ScheduledTaskCreate, ScheduledTaskUpdate, ScheduledTaskOut,
    ScheduleRunOut, ScheduleRunHistoryPage,
)
```

Add this import:

```python
from app.models.schedule_run_history import ScheduleRunHistory
```

Add the endpoint after the existing `run_schedule_now` endpoint:

```python
@router.get("/api/schedules/{schedule_id}/history", response_model=ScheduleRunHistoryPage)
async def get_schedule_history(
    schedule_id: str,
    cursor: str = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify ownership
    result = await db.execute(
        select(ScheduledTask).where(
            ScheduledTask.public_id == schedule_id,
            ScheduledTask.user_id == user.id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Schedule not found")

    limit = min(limit, 100)

    query = (
        select(ScheduleRunHistory)
        .where(ScheduleRunHistory.task_id == task.id)
        .order_by(ScheduleRunHistory.started_at.desc())
    )

    if cursor:
        cursor_dt = dt_datetime.fromisoformat(cursor)
        query = query.where(ScheduleRunHistory.started_at < cursor_dt)

    query = query.limit(limit + 1)
    result = await db.execute(query)
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    runs = rows[:limit]

    next_cursor = None
    if has_more and runs:
        next_cursor = runs[-1].started_at.isoformat()

    return ScheduleRunHistoryPage(
        runs=[ScheduleRunOut.model_validate(r) for r in runs],
        next_cursor=next_cursor,
        has_more=has_more,
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/scheduled_task.py backend/app/routers/schedules.py
git commit -m "feat: add schedule run history API endpoint"
```

---

### Task 3: Backend — Record run history in scheduler engine

**Files:**
- Modify: `backend/app/scheduler/engine.py`

- [ ] **Step 1: Modify `_run_scheduled_task` to record history**

In `backend/app/scheduler/engine.py`, replace the `_run_scheduled_task` function (lines 103-209) with:

```python
async def _run_scheduled_task(task_public_id: str):
    """Execute a scheduled task — runs the agent and saves results."""
    logger.info("Running scheduled task %s", task_public_id)
    settings = get_settings()

    async with get_session_factory()() as db:
        from sqlalchemy import select
        from app.models.scheduled_task import ScheduledTask
        from app.models.schedule_run_history import ScheduleRunHistory
        from app.models.chat import Chat, Message
        from app.agent.agent import build_agent_context, create_tool_executor
        from app.llm.provider import get_llm_response
        from sqlalchemy import func as sa_func

        # Load task
        result = await db.execute(
            select(ScheduledTask).where(ScheduledTask.public_id == task_public_id)
        )
        task = result.scalar_one_or_none()
        if not task or not task.enabled:
            logger.warning("Scheduled task %s not found or disabled", task_public_id)
            return

        # Create run history entry
        run_start = datetime.now(timezone.utc)
        run = ScheduleRunHistory(
            task_id=task.id,
            status="running",
            started_at=run_start,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        try:
            # Create chat if needed
            if not task.chat_id:
                chat = Chat(
                    user_id=task.user_id,
                    title=f"[Scheduled] {task.name}",
                )
                db.add(chat)
                await db.commit()
                await db.refresh(chat)
                task.chat_id = chat.id
                await db.commit()
            else:
                result = await db.execute(
                    select(Chat).where(Chat.id == task.chat_id)
                )
                chat = result.scalar_one_or_none()
                if not chat:
                    chat = Chat(
                        user_id=task.user_id,
                        title=f"[Scheduled] {task.name}",
                    )
                    db.add(chat)
                    await db.commit()
                    await db.refresh(chat)
                    task.chat_id = chat.id
                    await db.commit()

            # Save user message
            user_msg = Message(
                chat_id=chat.id,
                role="user",
                content=f"[Scheduled: {task.name}] {task.prompt}",
                status="completed",
            )
            db.add(user_msg)
            await db.commit()

            # Build messages for LLM
            messages = [{"role": "user", "content": task.prompt}]

            # Get response (non-streaming for scheduled tasks)
            response = await get_llm_response(messages, settings)

            # Save assistant message
            assistant_msg = Message(
                chat_id=chat.id,
                role="assistant",
                content=response,
                status="completed",
            )
            db.add(assistant_msg)
            chat.updated_at = sa_func.now()
            await db.commit()

            # Send webhook if configured
            if task.webhook_url:
                try:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(
                            task.webhook_url,
                            json={
                                "task_name": task.name,
                                "prompt": task.prompt,
                                "response": response[:2000],
                                "chat_id": chat.public_id if hasattr(chat, "public_id") else str(chat.id),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            },
                        )
                except Exception as e:
                    logger.warning("Webhook failed for task %s: %s", task_public_id, e)

            # Update task status
            run_end = datetime.now(timezone.utc)
            duration_ms = int((run_end - run_start).total_seconds() * 1000)

            task.last_run_at = run_end
            task.last_status = "success"
            task.last_error = None

            run.status = "success"
            run.finished_at = run_end
            run.duration_ms = duration_ms

            await db.commit()
            logger.info("Scheduled task %s completed successfully", task_public_id)

        except Exception as e:
            logger.error("Scheduled task %s failed: %s", task_public_id, e)
            run_end = datetime.now(timezone.utc)
            duration_ms = int((run_end - run_start).total_seconds() * 1000)

            task.last_run_at = run_end
            task.last_status = "error"
            task.last_error = str(e)

            run.status = "error"
            run.error = str(e)
            run.finished_at = run_end
            run.duration_ms = duration_ms

            await db.commit()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/scheduler/engine.py
git commit -m "feat: record run history on each scheduled task execution"
```

---

### Task 4: Backend — Tests for schedule history endpoint

**Files:**
- Create: `backend/tests/test_schedules_routes.py`

- [ ] **Step 1: Write tests**

Create `backend/tests/test_schedules_routes.py`:

```python
import pytest


@pytest.mark.anyio
async def test_create_schedule(client):
    res = await client.post(
        "/api/schedules",
        json={
            "name": "Test Schedule",
            "prompt": "Say hello",
            "cron_expression": "0 9 * * *",
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Test Schedule"
    assert data["cron_expression"] == "0 9 * * *"
    assert data["enabled"] is True
    assert data["id"].startswith("sched-")


@pytest.mark.anyio
async def test_update_schedule(client):
    create = await client.post(
        "/api/schedules",
        json={
            "name": "Original",
            "prompt": "Say hello",
            "cron_expression": "0 9 * * *",
        },
    )
    schedule_id = create.json()["id"]

    res = await client.patch(
        f"/api/schedules/{schedule_id}",
        json={"name": "Updated", "prompt": "Say goodbye", "cron_expression": "0 10 * * *"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Updated"
    assert data["prompt"] == "Say goodbye"
    assert data["cron_expression"] == "0 10 * * *"


@pytest.mark.anyio
async def test_list_schedules(client):
    await client.post(
        "/api/schedules",
        json={"name": "S1", "prompt": "P1", "cron_expression": "0 9 * * *"},
    )
    await client.post(
        "/api/schedules",
        json={"name": "S2", "prompt": "P2", "cron_expression": "0 10 * * *"},
    )
    res = await client.get("/api/schedules")
    assert res.status_code == 200
    assert len(res.json()) >= 2


@pytest.mark.anyio
async def test_delete_schedule(client):
    create = await client.post(
        "/api/schedules",
        json={"name": "To Delete", "prompt": "P", "cron_expression": "0 9 * * *"},
    )
    schedule_id = create.json()["id"]
    res = await client.delete(f"/api/schedules/{schedule_id}")
    assert res.status_code == 204

    res = await client.get("/api/schedules")
    ids = [s["id"] for s in res.json()]
    assert schedule_id not in ids


@pytest.mark.anyio
async def test_history_empty(client):
    create = await client.post(
        "/api/schedules",
        json={"name": "History Test", "prompt": "P", "cron_expression": "0 9 * * *"},
    )
    schedule_id = create.json()["id"]
    res = await client.get(f"/api/schedules/{schedule_id}/history")
    assert res.status_code == 200
    data = res.json()
    assert data["runs"] == []
    assert data["has_more"] is False
    assert data["next_cursor"] is None


@pytest.mark.anyio
async def test_history_not_found(client):
    res = await client.get("/api/schedules/sched-nonexist/history")
    assert res.status_code == 404


@pytest.mark.anyio
async def test_update_schedule_invalid_cron(client):
    create = await client.post(
        "/api/schedules",
        json={"name": "Bad Cron", "prompt": "P", "cron_expression": "0 9 * * *"},
    )
    schedule_id = create.json()["id"]
    res = await client.patch(
        f"/api/schedules/{schedule_id}",
        json={"cron_expression": "bad"},
    )
    assert res.status_code == 400
```

- [ ] **Step 2: Run the tests**

```bash
cd backend && python -m pytest tests/test_schedules_routes.py -v
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_schedules_routes.py
git commit -m "test: add schedule CRUD and history endpoint tests"
```

---

### Task 5: Frontend — API client + refactor dialog to ScheduleDialog

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/add-schedule-dialog.tsx` (rename to `schedule-dialog.tsx`)

- [ ] **Step 1: Add `getScheduleHistory` and `getSchedule` to api.ts**

In `frontend/src/lib/api.ts`, add after the existing schedule functions at the end of the file:

```typescript
export interface ScheduleRun {
  id: number;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface ScheduleRunHistoryPage {
  runs: ScheduleRun[];
  next_cursor: string | null;
  has_more: boolean;
}

export async function getSchedule(id: string): Promise<ScheduleData> {
  const res = await authFetch(`${API_BASE}/api/schedules/${id}`);
  if (!res.ok) throw new Error("Failed to load schedule");
  return res.json();
}

export async function getScheduleHistory(
  id: string,
  cursor?: string,
  limit: number = 20
): Promise<ScheduleRunHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await authFetch(`${API_BASE}/api/schedules/${id}/history?${params}`);
  if (!res.ok) throw new Error("Failed to load schedule history");
  return res.json();
}
```

- [ ] **Step 2: Refactor AddScheduleDialog → ScheduleDialog**

Rename `frontend/src/components/add-schedule-dialog.tsx` to `frontend/src/components/schedule-dialog.tsx`.

Update the component to accept an optional `schedule` prop for edit mode. Key changes:

- Props interface adds `schedule?: ScheduleData`
- Rename export from `AddScheduleDialog` to `ScheduleDialog`
- Rename callback from `onCreated` to `onSaved`
- When `schedule` prop is set: pre-fill fields in a `useEffect`, title becomes "Edit Schedule", button becomes "Save Changes"
- On submit in edit mode: call `updateSchedule(schedule.id, data)` instead of `createSchedule(data)`
- Import `updateSchedule` and `type ScheduleData` from `@/lib/api`

The full component (replace entire file contents of `schedule-dialog.tsx`):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Clock, ChevronDown, Repeat, CalendarDays, BriefcaseBusiness, Calendar1, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createSchedule, updateSchedule, type ScheduleData } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *", icon: Timer, description: "Runs at the top of every hour" },
  { label: "Daily at 9 AM", value: "0 9 * * *", icon: CalendarDays, description: "Every day at 9:00 AM" },
  { label: "Weekdays at 9 AM", value: "0 9 * * 1-5", icon: BriefcaseBusiness, description: "Monday through Friday at 9:00 AM" },
  { label: "Weekly on Monday", value: "0 9 * * 1", icon: Repeat, description: "Every Monday at 9:00 AM" },
  { label: "Monthly on the 1st", value: "0 0 1 * *", icon: Calendar1, description: "First day of each month at midnight" },
];

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  schedule?: ScheduleData;
}

export function ScheduleDialog({ open, onOpenChange, onSaved, schedule }: ScheduleDialogProps) {
  const isEdit = !!schedule;
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("0 9 * * *");
  const [customCron, setCustomCron] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

  // Pre-fill fields when editing
  useEffect(() => {
    if (schedule && open) {
      setName(schedule.name);
      setPrompt(schedule.prompt);
      setWebhookUrl(schedule.webhook_url || "");
      setShowAdvanced(!!schedule.webhook_url);
      const matchesPreset = CRON_PRESETS.some((p) => p.value === schedule.cron_expression);
      if (matchesPreset) {
        setSelectedPreset(schedule.cron_expression);
        setIsCustom(false);
      } else {
        setIsCustom(true);
        setCustomCron(schedule.cron_expression);
      }
    } else if (!schedule && open) {
      setName("");
      setPrompt("");
      setSelectedPreset("0 9 * * *");
      setCustomCron("");
      setIsCustom(false);
      setWebhookUrl("");
      setShowAdvanced(false);
    }
  }, [schedule, open]);

  const cron = isCustom ? customCron : selectedPreset;

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim() || !cron.trim()) {
      toast.error("Name, prompt, and schedule are required");
      return;
    }
    setLoading(true);
    try {
      const data = {
        name: name.trim(),
        prompt: prompt.trim(),
        cron_expression: cron.trim(),
        webhook_url: webhookUrl.trim() || undefined,
      };
      if (isEdit) {
        await updateSchedule(schedule.id, data);
        toast.success("Schedule updated");
      } else {
        await createSchedule(data);
        toast.success("Schedule created");
      }
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(isEdit ? "Failed to update schedule" : "Failed to create schedule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10">
              <Clock className="h-5 w-5 text-teal-500" />
            </div>
            <div>
              <DialogTitle>{isEdit ? "Edit Schedule" : "New Scheduled Agent"}</DialogTitle>
              <DialogDescription>
                {isEdit
                  ? "Update the schedule's name, prompt, frequency, or webhook."
                  : "Automate a recurring task — the agent will run on your chosen schedule."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Name</Label>
            <Input
              id="sched-name"
              placeholder="e.g. Daily AI News Digest"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-prompt">Prompt</Label>
            <Textarea
              id="sched-prompt"
              className="min-h-[80px] resize-none"
              placeholder="Search the web for the latest AI news and summarize the top 5 stories with links"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground/60">
              The agent will execute this prompt each time the schedule fires.
            </p>
          </div>

          {/* Schedule presets */}
          <div className="space-y-2">
            <Label>Schedule</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {CRON_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const active = !isCustom && selectedPreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setSelectedPreset(preset.value);
                      setIsCustom(false);
                    }}
                    className={cn(
                      "group flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all",
                      active
                        ? "border-teal-500/40 bg-teal-500/5 ring-1 ring-teal-500/20"
                        : "border-border hover:border-muted-foreground/30 hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={cn(
                        "h-3.5 w-3.5",
                        active ? "text-teal-500" : "text-muted-foreground/60"
                      )} />
                      <span className={cn(
                        "text-xs font-medium",
                        active ? "text-teal-700 dark:text-teal-400" : "text-foreground"
                      )}>
                        {preset.label}
                      </span>
                    </div>
                  </button>
                );
              })}
              {/* Custom option */}
              <button
                type="button"
                onClick={() => setIsCustom(true)}
                className={cn(
                  "group flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all",
                  isCustom
                    ? "border-teal-500/40 bg-teal-500/5 ring-1 ring-teal-500/20"
                    : "border-border hover:border-muted-foreground/30 hover:bg-accent/50"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Clock className={cn(
                    "h-3.5 w-3.5",
                    isCustom ? "text-teal-500" : "text-muted-foreground/60"
                  )} />
                  <span className={cn(
                    "text-xs font-medium",
                    isCustom ? "text-teal-700 dark:text-teal-400" : "text-foreground"
                  )}>
                    Custom
                  </span>
                </div>
              </button>
            </div>

            {isCustom && (
              <div className="space-y-1.5 pt-1">
                <Input
                  placeholder="*/5 * * * *"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Use standard cron syntax: minute hour day month weekday
                </p>
              </div>
            )}

            {!isCustom && selectedPreset && (
              <p className="text-[11px] text-muted-foreground/60">
                {CRON_PRESETS.find((p) => p.value === selectedPreset)?.description}
              </p>
            )}
          </div>

          {/* Advanced toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={cn(
                "h-3.5 w-3.5 transition-transform",
                showAdvanced && "rotate-180"
              )} />
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="sched-webhook">Webhook URL</Label>
                <Input
                  id="sched-webhook"
                  placeholder="https://hooks.slack.com/services/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Optionally post results to a Slack or webhook endpoint.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !prompt.trim() || !cron.trim()}
          >
            {loading ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create Schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git mv frontend/src/components/add-schedule-dialog.tsx frontend/src/components/schedule-dialog.tsx
git add frontend/src/components/schedule-dialog.tsx
git commit -m "feat: add getScheduleHistory API, refactor dialog to support edit mode"
```

---

### Task 6: Frontend — Schedule detail page

**Files:**
- Create: `frontend/src/app/schedules/[id]/page.tsx`

- [ ] **Step 1: Create the detail page**

Create `frontend/src/app/schedules/[id]/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft, Clock, Play, Trash2, Pencil, ExternalLink,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getSchedule,
  getScheduleHistory,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  type ScheduleData,
  type ScheduleRun,
} from "@/lib/api";
import { ScheduleDialog } from "@/components/schedule-dialog";

const CRON_PRESETS: Record<string, string> = {
  "0 * * * *": "Every hour",
  "0 9 * * *": "Daily at 9:00 AM",
  "0 9 * * 1": "Weekly on Monday at 9:00 AM",
  "0 9 * * 1-5": "Weekdays at 9:00 AM",
  "0 0 1 * *": "Monthly on the 1st",
};

function humanCron(expr: string): string {
  return CRON_PRESETS[expr] || expr;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

export default function ScheduleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const scheduleId = params.id as string;

  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSchedule = useCallback(async () => {
    try {
      const data = await getSchedule(scheduleId);
      setSchedule(data);
    } catch {
      toast.error("Schedule not found");
      router.push("/schedules");
    }
  }, [scheduleId, router]);

  const fetchHistory = useCallback(async (cursor?: string) => {
    try {
      const data = await getScheduleHistory(scheduleId, cursor);
      if (cursor) {
        setRuns((prev) => [...prev, ...data.runs]);
      } else {
        setRuns(data.runs);
      }
      setNextCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch {
      toast.error("Failed to load run history");
    }
  }, [scheduleId]);

  useEffect(() => {
    Promise.all([fetchSchedule(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchSchedule, fetchHistory]);

  const handleToggle = async () => {
    if (!schedule) return;
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await fetchSchedule();
    } catch {
      toast.error("Failed to update schedule");
    }
  };

  const handleDelete = async () => {
    if (!schedule) return;
    if (!confirm("Delete this schedule? This cannot be undone.")) return;
    try {
      await deleteSchedule(schedule.id);
      toast.success("Schedule deleted");
      router.push("/schedules");
    } catch {
      toast.error("Failed to delete schedule");
    }
  };

  const handleRun = async () => {
    if (!schedule) return;
    try {
      await runScheduleNow(schedule.id);
      toast.success("Schedule triggered — results will appear in the linked chat");
      await fetchSchedule();
      // Refresh history after a short delay to let the run start
      setTimeout(() => fetchHistory(), 2000);
    } catch {
      toast.error("Failed to run schedule");
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchHistory(nextCursor);
    setLoadingMore(false);
  };

  const handleSaved = async () => {
    await fetchSchedule();
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!schedule) return null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Back link */}
        <button
          onClick={() => router.push("/schedules")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Schedules
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/10">
              <Clock className="h-5 w-5 text-teal-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{schedule.name}</h1>
                <Badge variant={schedule.enabled ? "default" : "secondary"} className="text-[10px]">
                  {schedule.enabled ? "Active" : "Paused"}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {humanCron(schedule.cron_expression)}
                {schedule.cron_expression !== humanCron(schedule.cron_expression) && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground/50">
                    ({schedule.cron_expression})
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch checked={schedule.enabled} onCheckedChange={handleToggle} />
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={handleRun}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run Now
            </Button>
            {schedule.chat_id && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/chat/${schedule.chat_id}`)}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Chat
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Info card */}
        <Card className="p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
            <p className="text-sm whitespace-pre-wrap">{schedule.prompt}</p>
          </div>
          {schedule.webhook_url && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Webhook</p>
              <p className="text-sm font-mono text-muted-foreground break-all">{schedule.webhook_url}</p>
            </div>
          )}
          <div className="flex gap-6 text-xs text-muted-foreground">
            <span>Created {new Date(schedule.created_at).toLocaleDateString()}</span>
            {schedule.last_run_at && (
              <span>Last run {new Date(schedule.last_run_at).toLocaleString()}</span>
            )}
          </div>
        </Card>

        {/* Run history */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Run History</h2>
          {runs.length === 0 ? (
            <Card className="flex flex-col items-center justify-center p-8 text-center">
              <Clock className="mb-3 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No runs yet. This schedule hasn&apos;t executed.
              </p>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {/* Table header */}
              <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-3 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span className="w-5" />
                <span>Started</span>
                <span>Duration</span>
                <span>Error</span>
              </div>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className={cn(
                    "grid grid-cols-[auto_1fr_auto_1fr] items-center gap-3 rounded-lg border px-3 py-2.5",
                    run.status === "error" ? "border-red-500/20 bg-red-500/5" : "border-border"
                  )}
                >
                  <StatusIcon status={run.status} />
                  <span className="text-sm">
                    {new Date(run.started_at).toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(run.duration_ms)}
                  </span>
                  <span className="text-sm text-red-500 truncate" title={run.error || undefined}>
                    {run.error || "—"}
                  </span>
                </div>
              ))}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <ScheduleDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={handleSaved}
          schedule={schedule}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/schedules/\[id\]/page.tsx
git commit -m "feat: add schedule detail page with run history"
```

---

### Task 7: Frontend — Update list page (clickable cards, update imports)

**Files:**
- Modify: `frontend/src/app/schedules/page.tsx`

- [ ] **Step 1: Rewrite the schedules list page**

Replace the full contents of `frontend/src/app/schedules/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listSchedules,
  updateSchedule,
  type ScheduleData,
} from "@/lib/api";
import { ScheduleDialog } from "@/components/schedule-dialog";

const CRON_PRESETS: Record<string, string> = {
  "0 * * * *": "Every hour",
  "0 9 * * *": "Daily at 9:00 AM",
  "0 9 * * 1": "Weekly on Monday at 9:00 AM",
  "0 9 * * 1-5": "Weekdays at 9:00 AM",
  "0 0 1 * *": "Monthly on the 1st",
};

function humanCron(expr: string): string {
  return CRON_PRESETS[expr] || expr;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  const fetchSchedules = useCallback(async () => {
    try {
      setSchedules(await listSchedules());
    } catch {
      toast.error("Failed to load schedules");
    }
  }, []);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const handleToggle = async (e: React.MouseEvent, schedule: ScheduleData) => {
    e.stopPropagation();
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await fetchSchedules();
    } catch {
      toast.error("Failed to update schedule");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Scheduled Agents</h1>
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Schedule
          </Button>
        </div>

        {schedules.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-8 text-center">
            <Clock className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No scheduled tasks yet. Create one to automate recurring agent tasks.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <Card
                key={s.id}
                className="group cursor-pointer p-4 transition-colors hover:bg-accent/50"
                onClick={() => router.push(`/schedules/${s.id}`)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-500/10">
                    <Clock className="h-5 w-5 text-teal-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px]">
                        {s.enabled ? "Active" : "Paused"}
                      </Badge>
                      {s.last_status && (
                        <Badge
                          variant={s.last_status === "success" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {s.last_status}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">{s.prompt}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{humanCron(s.cron_expression)}</span>
                      {s.last_run_at && (
                        <span>Last run: {new Date(s.last_run_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={() => handleToggle({ stopPropagation: () => {} } as React.MouseEvent, s)}
                    />
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
                </div>
              </Card>
            ))}
          </div>
        )}

        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={fetchSchedules}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/schedules/page.tsx
git commit -m "feat: make schedule cards clickable, navigate to detail page"
```

---

### Task 8: Backend — Add GET single schedule endpoint

The detail page calls `getSchedule(id)` which needs `GET /api/schedules/{id}`.

**Files:**
- Modify: `backend/app/routers/schedules.py`

- [ ] **Step 1: Add the endpoint**

In `backend/app/routers/schedules.py`, add after `list_schedules` (after line 57):

```python
@router.get("/api/schedules/{schedule_id}", response_model=ScheduledTaskOut)
async def get_schedule(
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ScheduledTask).where(
            ScheduledTask.public_id == schedule_id,
            ScheduledTask.user_id == user.id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Schedule not found")

    chat_pid = None
    if task.chat_id:
        cr = await db.execute(select(Chat.public_id).where(Chat.id == task.chat_id))
        chat_pid = cr.scalar_one_or_none()

    return _task_to_out(task, chat_pid)
```

- [ ] **Step 2: Add test for get single schedule**

In `backend/tests/test_schedules_routes.py`, add:

```python
@pytest.mark.anyio
async def test_get_schedule(client):
    create = await client.post(
        "/api/schedules",
        json={"name": "Get Test", "prompt": "P", "cron_expression": "0 9 * * *"},
    )
    schedule_id = create.json()["id"]
    res = await client.get(f"/api/schedules/{schedule_id}")
    assert res.status_code == 200
    assert res.json()["name"] == "Get Test"


@pytest.mark.anyio
async def test_get_schedule_not_found(client):
    res = await client.get("/api/schedules/sched-nonexist")
    assert res.status_code == 404
```

- [ ] **Step 3: Run tests**

```bash
cd backend && python -m pytest tests/test_schedules_routes.py -v
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/schedules.py backend/tests/test_schedules_routes.py
git commit -m "feat: add GET single schedule endpoint"
```

---

### Task 9: Verify end-to-end

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: All tests pass including the new schedule tests.

- [ ] **Step 2: Start the dev servers and verify in browser**

```bash
make local-backend  # in one terminal
make local-frontend # in another terminal
```

Verify:
1. Navigate to `/schedules` — cards are clickable, show chevron on hover
2. Click a card → navigates to `/schedules/[id]` detail page
3. Detail page shows schedule info, prompt, cron
4. Click "Edit" → dialog opens pre-filled with schedule data
5. Change name → Save → name updates on detail page
6. Run history section shows "No runs yet" for new schedules
7. Click "Run Now" → after a few seconds, refresh shows a run in history
8. "Load more" button appears when > 20 runs exist
9. Back arrow returns to list page
10. Enabled toggle works on both list and detail pages

- [ ] **Step 3: Run the migration on Docker if needed**

```bash
make migrate
```

- [ ] **Step 4: Final commit if any fixes needed**

---

Plan complete and saved to `docs/superpowers/plans/2026-04-16-schedule-edit-and-run-history.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?