# Scheduled Agents Design Spec

**Date**: 2026-04-16
**Status**: Approved

## Overview

Add recurring scheduled tasks that run the agent pipeline on a cron schedule. Results are saved to a dedicated chat per schedule and optionally sent via webhook. APScheduler with Redis persistence runs in-process — no extra container needed.

## Data Model

New `scheduled_tasks` table:

| Column | Type | Notes |
|---|---|---|
| id | int PK | auto |
| public_id | string(22) | unique, `sched-` prefix |
| user_id | int FK | owner |
| name | string(200) | display name |
| prompt | text | message to send to agent |
| cron_expression | string(100) | standard cron (e.g., `0 9 * * *`) |
| chat_id | int FK nullable | auto-created on first run |
| webhook_url | string(500) nullable | optional webhook for results |
| enabled | bool | default true |
| last_run_at | datetime nullable | |
| last_status | string(20) nullable | `success` or `error` |
| last_error | text nullable | |
| created_at | datetime | |
| updated_at | datetime | |

## Scheduler Engine

APScheduler 4 with Redis job store, running inside the FastAPI process.

- **Startup:** Load all enabled scheduled_tasks from DB, register with APScheduler.
- **Job execution:** Create async DB session → load task + user → create chat if needed → run agent (build_agent_context + create_tool_executor + get_llm_response) → save assistant message → send webhook if configured → update last_run_at/status/error.
- **Dynamic updates:** Create/edit/delete schedule → add/modify/remove APScheduler job immediately.
- **Error handling:** Save error to last_error, set status=error. Task stays enabled for next tick.

## API Endpoints

- `GET /api/schedules` — list user's schedules
- `POST /api/schedules` — create (name, prompt, cron_expression, webhook_url?)
- `PATCH /api/schedules/{id}` — update fields
- `DELETE /api/schedules/{id}` — delete + remove job
- `POST /api/schedules/{id}/run` — trigger immediately

## Frontend

- `/schedules` page — list of schedule cards (follows MCP page pattern)
- Each card: name, prompt preview, cron (human-readable), last run status/time, enabled toggle
- Add Schedule dialog: name, prompt, cron input with presets (hourly, daily 9am, weekly Monday, custom), optional webhook URL
- Click card → opens linked chat
- Sidebar: "Schedules" link with clock icon

## Dependencies

- `apscheduler[redis]` added to `backend/requirements.txt`

## Files

### New
- `backend/app/models/scheduled_task.py` — SQLAlchemy model
- `backend/app/routers/schedules.py` — API endpoints
- `backend/app/schemas/scheduled_task.py` — Pydantic schemas
- `backend/app/scheduler/engine.py` — APScheduler setup + job execution
- `backend/alembic/versions/0033_add_scheduled_tasks.py` — migration
- `frontend/src/app/schedules/page.tsx` — schedules page
- `frontend/src/components/schedule-card.tsx` — schedule card component
- `frontend/src/components/add-schedule-dialog.tsx` — create/edit dialog

### Modified
- `backend/app/main.py` — start/stop scheduler in lifespan
- `backend/requirements.txt` — add apscheduler
- `frontend/src/lib/api.ts` — schedule CRUD functions
- `frontend/src/components/sidebar-content.tsx` — add Schedules link
