# Background LLM Tasks — Design Spec

## Problem

When a user sends a message, navigates to another chat, and reloads the page, the in-memory stream Map (`active-streams.ts`) is lost. The backend continues generating via its fire-and-forget asyncio task, but the frontend cannot detect that a response completed after the reload. The user sees no toast, no check icon, and must manually navigate back to discover the response.

## Solution

Add a `status` field to the `Message` model that tracks generation lifecycle (`generating` → `completed` / `error`). The backend sets this as the source of truth. The frontend uses it (via existing polling) to show spinners, check icons, and toast notifications — surviving page reloads without any in-memory state.

## Backend Changes

### 1. Message `status` column

Add `status` string column to the `messages` table:

- Values: `"generating"`, `"completed"`, `"error"`
- Default: `"completed"` (existing messages are unaffected, non-assistant messages are always completed)
- Migration: single `ALTER TABLE messages ADD COLUMN status VARCHAR(20) DEFAULT 'completed'`

### 2. Status lifecycle in `_llm_background_task`

In `routers/chats.py`:

- **First chunk saved** (assistant message creation): set `status = "generating"`
- **Successful completion** (after final content save, sources, artifacts): set `status = "completed"`, commit
- **Error with partial save**: set `status = "error"`, commit
- **Error creating partial message**: create message with `status = "error"`

### 3. `is_generating` in chat list API

Add `is_generating` boolean to `ChatSummary` response. Computed in the `list_chats` query:

- Subquery: for each chat, check if any message has `status = 'generating'`
- Returned alongside existing `has_notification` field
- No new column on the `chats` table — derived from message status

### 4. `status` in `MessageOut`

Add `status: str` field to `MessageOut` schema, populated from `msg.status`. Defaults to `"completed"` for backwards compatibility.

## Frontend Changes

### 5. `ChatSummary` type update

Add `is_generating: boolean` to the `ChatSummary` type in `lib/api.ts`.

### 6. `chat-list.tsx` — server-driven indicators

Replace the in-memory `isStreamGenerating(chat.id)` check with the server-driven `chat.is_generating`:

- `chat.is_generating` → show `Loader2` spinner
- `chat.has_notification && !chat.is_generating` → show `CheckCircle2` check icon
- Neither → no icon

This makes the indicator survive page reloads.

### 7. `sidebar-content.tsx` — toast on generation completion

Track `is_generating` state across polls to detect transitions:

- Maintain a `Set<string>` of chat IDs that were generating in the previous poll
- When a chat transitions from `is_generating: true` → `false` AND `has_notification: true`:
  - Show toast: `"Response ready: {title}"` with "View" action button
  - Only if user is not currently on that chat
- This replaces the sidebar's current notification detection for generating chats

### 8. `use-message-stream.ts` — generating indicator on load

When `loadChat` fetches messages and the last assistant message has `status === "generating"`:

- Show a loading/generating indicator in the chat (set `isLoading = true`, `actionText = "Generating response..."`)
- Poll every 3 seconds for the chat to check if the message status changed
- When status becomes `"completed"` or `"error"`, reload messages and clear indicator
- This handles the case where the user navigates back to a chat that is still generating after a reload

## Migration

Single Alembic migration:
- Add `status` column to `messages` table: `VARCHAR(20)`, server default `'completed'`, not null
- All existing messages get `'completed'` status automatically via default

## Edge Cases

- **Multiple rapid sends**: Each message tracks its own status independently. `is_generating` is true if *any* message in the chat is generating.
- **Server restart mid-generation**: Messages stuck in `generating` status. Add a startup cleanup: set any `generating` messages older than 10 minutes to `error` with content suffix `"[Response interrupted]"`.
- **Existing in-memory streams**: `active-streams.ts` continues to work for the no-reload case. The server-driven status is additive — it covers the reload case that in-memory can't.

## Files to Modify

| File | Change |
|------|--------|
| `backend/app/models/chat.py` | Add `status` column to `Message` |
| `backend/app/schemas/chat.py` | Add `status` to `MessageOut`, `is_generating` to `ChatSummary` |
| `backend/app/routers/chats.py` | Set status in `_llm_background_task`, compute `is_generating` in `list_chats` |
| `backend/alembic/versions/` | New migration for `status` column |
| `frontend/src/lib/api.ts` | Add `is_generating` to `ChatSummary` type, `status` to message types |
| `frontend/src/components/chat-list.tsx` | Use `chat.is_generating` instead of `isStreamGenerating()` |
| `frontend/src/components/sidebar-content.tsx` | Track generating→completed transitions for toast |
| `frontend/src/hooks/use-message-stream.ts` | Poll for status changes when last message is generating |
