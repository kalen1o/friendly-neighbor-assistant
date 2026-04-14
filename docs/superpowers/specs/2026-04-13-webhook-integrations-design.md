# Webhook Integrations — Design Spec

**Date**: 2026-04-13
**Status**: Approved
**Approach**: Event Bus + Webhook Dispatcher — internal event system with per-user webhook subscriptions

## Overview

Add webhook integrations supporting Slack, Discord, and generic webhook URLs. Users configure their own integrations in the Settings UI. Supports both outbound notifications (events from the app) and inbound triggers (external messages routed to the agent).

## Database Schema

### New table: `webhook_integrations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment |
| `public_id` | varchar(24) | Unique, `wh_*` prefix |
| `user_id` | int FK | Owner |
| `name` | varchar(100) | Display name |
| `platform` | varchar(20) | `slack`, `discord`, `generic` |
| `direction` | varchar(10) | `outbound`, `inbound`, `both` |
| `webhook_url` | text | Outbound destination URL |
| `inbound_token` | varchar(64) | Secret token for verifying inbound requests |
| `subscribed_events` | text | JSON array of event types |
| `config_json` | text | Platform-specific config |
| `enabled` | bool | Default true |
| `created_at` | datetime | Timestamp |

## Event System

### Event Types

- `message_completed` — agent finished responding. Payload: `chat_id`, message preview (first 200 chars), `user_name`
- `document_processed` — document finished processing. Payload: `document_id`, `filename`, `status`, `chunk_count`
- `task_completed` — background LLM task finished. Payload: `chat_id`, task summary

### Emit + Dispatch Flow

```
Event source (chats.py, processing.py)
  → emit_event(event_type, payload, user_id)
  → dispatcher queries enabled integrations for this user + event type
  → POST to each webhook URL (async background task, fire-and-forget)
```

### Outbound Payload Format

Generic:
```json
{
  "event": "message_completed",
  "timestamp": "2026-04-14T...",
  "data": {
    "chat_id": "chat-xxx",
    "message": "First 200 chars...",
    "user": "kalen"
  }
}
```

Slack: Formatted as Block Kit message with event info.

Discord: Formatted as Discord embed with event info.

## Inbound Webhooks

### URL Pattern

```
POST /api/webhooks/slack/{inbound_token}
POST /api/webhooks/discord/{inbound_token}
POST /api/webhooks/generic/{inbound_token}
```

### Platform Parsing

- **Slack**: Events API payload. Extracts `event.text` and `event.channel`. Handles URL verification challenge.
- **Discord**: Interactions endpoint payload. Extracts message content. Handles ping verification.
- **Generic**: Expects `{"message": "text here"}` JSON body.

### Message Routing (config_json.channel_mode)

- `"new_chat"` — creates a new chat per inbound message
- `"persistent"` — uses a specific `chat_id` from config, all messages continue the same conversation

### Async Response Flow

```
External service sends message → /api/webhooks/{platform}/{token}
  → return 200 OK immediately
  → background task:
    → parse message text
    → create or find chat (based on channel_mode)
    → run agent
    → POST reply back to webhook_url
```

Returns 200 immediately to avoid Slack/Discord 3-second timeout. Agent runs in background task (same pattern as chats.py).

## API Endpoints

- `GET /api/webhooks` — list user's integrations (authenticated)
- `POST /api/webhooks` — create integration (authenticated)
- `PUT /api/webhooks/{id}` — update integration (authenticated)
- `DELETE /api/webhooks/{id}` — delete integration (authenticated)
- `POST /api/webhooks/{platform}/{token}` — inbound (no auth, verified by token)

## Frontend — Settings Integrations Tab

New "Integrations" tab in the Settings dialog.

### List View
- Shows user's webhook integrations with name, platform icon, enabled toggle
- "Add Integration" button

### Add/Edit Form
- Name (text input)
- Platform (dropdown: Slack, Discord, Generic)
- Direction (dropdown: Outbound only, Inbound only, Both)
- Webhook URL (text input — for outbound)
- Events (checkboxes: message completed, document processed, task completed)
- Channel mode (radio: New chat, Persistent — shown for inbound only)

After creating an inbound integration, displays the generated inbound URL for the user to copy into Slack/Discord config.

## File Changes

### New Files
- `backend/app/models/webhook.py` — WebhookIntegration model
- `backend/app/webhooks/events.py` — event emitter + outbound dispatcher
- `backend/app/webhooks/inbound.py` — platform-specific inbound parsers
- `backend/app/routers/webhooks.py` — CRUD + inbound endpoints
- `backend/app/schemas/webhook.py` — Pydantic schemas
- `backend/alembic/versions/0029_add_webhook_integrations.py` — migration
- `backend/tests/test_webhooks.py` — tests
- `frontend/src/components/integrations-settings.tsx` — integrations tab UI

### Modified Files
- `backend/app/main.py` — register webhooks router
- `backend/app/routers/chats.py` — emit `message_completed` event
- `backend/app/rag/processing.py` — emit `document_processed` event
- `frontend/src/components/settings-dialog.tsx` — add "Integrations" tab
- `frontend/src/lib/api.ts` — add webhook CRUD functions
- `README.md` — roadmap update

## Ownership

Per-user: each user configures their own integrations. Events only fire for the user's own actions (their chats, their documents). No instance-wide integrations.
