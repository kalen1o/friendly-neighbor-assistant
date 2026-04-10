# Chat Sharing — Design Spec

## Overview

Allow users to share a read-only snapshot of a chat conversation via a link. The owner chooses whether the link is public (anyone with URL) or authenticated (login required). Links can be revoked at any time.

## Data Model

New `shared_chats` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK, autoincrement |
| `public_id` | String(22) | Unique share token, prefix `share-`. Used in the URL. |
| `chat_id` | int | FK → `chats.id`, ON DELETE CASCADE |
| `user_id` | int | FK → `users.id`, the owner who created the share |
| `visibility` | String | `"public"` or `"authenticated"` |
| `active` | bool | Default `true`. Set `false` on revoke. |
| `title` | String | Chat title at time of snapshot |
| `snapshot` | Text (JSON) | Frozen array of `{role, content, created_at}` messages |
| `created_at` | DateTime | Server default `now()` |

Indexes: `public_id` (unique), `chat_id` (for listing shares), `user_id` (for ownership checks).

Migration: `0015_create_shared_chats_table.py`

## API Endpoints

### `POST /api/chats/{chat_id}/share`

Create a share link. Requires auth. Only the chat owner can share.

**Request:**
```json
{"visibility": "public"}
```

**Response (201):**
```json
{
  "id": "share-a1b2c3d4",
  "chat_id": "chat-xyz",
  "visibility": "public",
  "active": true,
  "title": "My Chat",
  "created_at": "2026-04-10T12:00:00Z"
}
```

**Behavior:**
1. Verify chat exists and belongs to current user
2. Load chat with messages
3. Serialize messages to JSON snapshot: `[{role, content, created_at}]`
4. Create `SharedChat` record with snapshot
5. Return the share metadata (not the snapshot itself)

### `GET /api/shared/{share_id}`

View a shared chat. Auth depends on `visibility`.

**Response (200):**
```json
{
  "id": "share-a1b2c3d4",
  "title": "My Chat",
  "visibility": "public",
  "created_at": "2026-04-10T12:00:00Z",
  "messages": [
    {"role": "user", "content": "Hello", "created_at": "..."},
    {"role": "assistant", "content": "Hi there!", "created_at": "..."}
  ]
}
```

**Behavior:**
1. Look up `SharedChat` by `public_id`
2. If not found or `active=false` → 404
3. If `visibility == "authenticated"` → require valid auth (cookie or Bearer), else 401
4. If `visibility == "public"` → no auth needed
5. Return title + deserialized snapshot messages

### `GET /api/chats/{chat_id}/shares`

List active shares for a chat. Owner only.

**Response (200):**
```json
[
  {
    "id": "share-a1b2c3d4",
    "visibility": "public",
    "active": true,
    "created_at": "2026-04-10T12:00:00Z"
  }
]
```

### `DELETE /api/shared/{share_id}`

Revoke a share. Owner only. Sets `active=false`.

**Response:** 204 No Content

## Frontend

### Share Button
- Located in chat page header (next to chat title)
- Opens a dialog with:
  - Visibility toggle: Public / Authenticated
  - "Create Link" button
  - After creation: shows the URL with a copy button
  - List of existing shares with revoke buttons

### Shared Chat Page (`/shared/{share_id}`)
- Route: `/shared/[id]/page.tsx`
- Read-only view: renders messages in the same bubble format as the main chat
- No sidebar, no input box, minimal chrome
- Header shows chat title + "Shared conversation" label
- States:
  - Loading
  - Not found (revoked or invalid link)
  - Login required (authenticated share, user not logged in)

### URL Format
```
https://yourdomain.com/shared/share-a1b2c3d4
```

## Auth Logic for Shared View

```
GET /api/shared/{share_id}
  → share not found or inactive → 404
  → visibility == "public" → return snapshot (no auth)
  → visibility == "authenticated":
      → has valid access_token cookie or Bearer header → return snapshot
      → no auth → 401
```

The `get_current_user` dependency is NOT used here since public shares need no auth. Instead, the endpoint manually checks auth only when `visibility == "authenticated"`.

## Security

- Share tokens are `share-` + 8 random hex chars (same as other public IDs) — unguessable
- Revoking is immediate: sets `active=false`, link returns 404
- Snapshot is a frozen copy — no access to live chat data, no message IDs, no user IDs exposed
- Owner can create multiple shares of the same chat with different visibility levels
- Deleting a chat cascades to delete all its shares (FK ON DELETE CASCADE)

## Testing

- `test_sharing.py`:
  - Create a public share, verify accessible without auth
  - Create an authenticated share, verify 401 without auth, 200 with auth
  - Revoke a share, verify 404
  - Verify only chat owner can create/list/revoke shares
  - Verify snapshot content matches chat messages at creation time
  - Verify non-owner gets 404 when trying to share someone else's chat
