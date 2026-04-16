# Schedule Edit Dialog & Run History — Design Spec

**Date**: 2026-04-16
**Status**: Approved

## Overview

Add two capabilities to the scheduled agents feature:
1. **Edit dialog** — reuse the existing add dialog to edit a schedule's name, prompt, cron, and webhook
2. **Run history** — persist every execution as a row in a new table, displayed on a detail page with cursor-based pagination

## 1. Backend

### New model: `ScheduleRunHistory`

New table `schedule_run_history`:

| Column | Type | Notes |
|---|---|---|
| id | int PK | auto |
| task_id | int FK | → scheduled_tasks.id, indexed, CASCADE delete |
| status | string(20) | `running`, `success`, `error` |
| error | text nullable | error message if failed |
| started_at | datetime | when execution began |
| finished_at | datetime nullable | when execution ended |
| duration_ms | int nullable | wall-clock ms |

Migration: `0034_add_schedule_run_history.py`

### New endpoint: `GET /api/schedules/{id}/history`

Cursor-paginated by `started_at` descending.

Query params:
- `cursor` (ISO datetime string, optional) — return runs older than this
- `limit` (int, default 20, max 100)

Response:
```json
{
  "runs": [
    {
      "id": 1,
      "status": "success",
      "error": null,
      "started_at": "2026-04-16T09:00:00Z",
      "finished_at": "2026-04-16T09:00:12Z",
      "duration_ms": 12340
    }
  ],
  "next_cursor": "2026-04-15T09:00:00Z",
  "has_more": true
}
```

### New schema additions

- `ScheduleRunOut` — Pydantic model for a single run
- `ScheduleRunHistoryPage` — `{ runs: list[ScheduleRunOut], next_cursor: str | None, has_more: bool }`

### Modify `_run_scheduled_task` in `engine.py`

Before executing:
1. Insert a `ScheduleRunHistory` row with `status="running"`, `started_at=now()`

On success:
2. Update the row: `status="success"`, `finished_at=now()`, compute `duration_ms`

On error:
3. Update the row: `status="error"`, `error=str(e)`, `finished_at=now()`, compute `duration_ms`

The existing `last_run_at` / `last_status` / `last_error` fields on `scheduled_tasks` continue to be updated for quick access on the list page.

### No changes for edit

`PATCH /api/schedules/{id}` already supports updating `name`, `prompt`, `cron_expression`, `webhook_url`, and `enabled`. Frontend `updateSchedule()` already calls it. No backend changes needed.

## 2. Frontend

### Refactor: `AddScheduleDialog` → `ScheduleDialog`

Single component handles both create and edit modes.

Props:
- `open`, `onOpenChange` — dialog visibility
- `onSaved` — callback after create or update
- `schedule?: ScheduleData` — when provided, dialog opens in edit mode

Behavior:
- Edit mode: pre-fill all fields from `schedule`, title becomes "Edit Schedule", button becomes "Save Changes"
- Create mode: unchanged from current behavior
- On save in edit mode: call `updateSchedule(schedule.id, data)`
- On save in create mode: call `createSchedule(data)`

### New page: `/schedules/[id]/page.tsx`

**Header section:**
- Back arrow (← Schedules)
- Schedule name (large)
- Status badge (Active / Paused) + last status badge (success / error)
- Actions: Edit button (opens ScheduleDialog in edit mode), Run Now button, Delete button (with confirmation), Enabled toggle

**Info section:**
- Prompt (full text, not truncated)
- Schedule: human-readable cron + raw expression
- Webhook URL (if set)
- Created / last run timestamps

**Run history section:**
- Section heading "Run History" with run count
- Table columns: Status (icon + text), Started, Duration, Error
- Status icons: green check for success, red X for error, spinner for running
- Duration formatted as human-readable (e.g. "12.3s", "1m 24s")
- Error column: truncated with tooltip for full text
- "Load more" button at bottom when `has_more` is true
- Empty state: "No runs yet" with subtle icon

### Modify list page: `/schedules/page.tsx`

- Make schedule cards clickable — entire card navigates to `/schedules/[id]`
- Remove per-card action buttons (Play, Delete, External Link) — these move to detail page
- Keep the enabled toggle on the card for quick access
- Add a subtle chevron-right or arrow indicator on hover

### New API function in `api.ts`

```typescript
export interface ScheduleRun {
  id: number;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export async function getScheduleHistory(
  id: string,
  cursor?: string,
  limit?: number
): Promise<{ runs: ScheduleRun[]; next_cursor: string | null; has_more: boolean }>
```

## 3. Files

### New
- `backend/app/models/schedule_run_history.py` — SQLAlchemy model
- `backend/alembic/versions/0034_add_schedule_run_history.py` — migration
- `frontend/src/app/schedules/[id]/page.tsx` — schedule detail page

### Modified
- `backend/app/schemas/scheduled_task.py` — add `ScheduleRunOut`, `ScheduleRunHistoryPage`
- `backend/app/routers/schedules.py` — add history endpoint
- `backend/app/scheduler/engine.py` — insert/update run history rows during execution
- `frontend/src/components/add-schedule-dialog.tsx` — rename to `schedule-dialog.tsx`, refactor to `ScheduleDialog`, add edit mode
- `frontend/src/app/schedules/page.tsx` — make cards clickable, remove inline actions
- `frontend/src/lib/api.ts` — add `ScheduleRun` type and `getScheduleHistory` function
