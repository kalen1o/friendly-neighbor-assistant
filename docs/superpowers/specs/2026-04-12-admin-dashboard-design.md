# Admin Dashboard Design

Enterprise admin dashboard with user management, audit logging, usage quotas, and system-wide analytics. Role-based access control with three roles (admin, user, viewer). Admin emails configured via `ADMIN_EMAILS` env var.

## Data Model

### User Table Changes

Add column:
- `role` (str(20), NOT NULL, default `"user"`) — values: `user`, `admin`, `viewer`

`viewer` role can read chats but not create/send messages.

### New Table: `audit_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | auto-increment |
| `user_id` | int, FK → users.id, nullable | null for system events |
| `action` | str(50), NOT NULL | e.g. `login`, `send_message`, `delete_chat` |
| `resource_type` | str(30), nullable | e.g. `chat`, `document`, `user`, `skill` |
| `resource_id` | str(50), nullable | public_id of affected resource |
| `details` | text, nullable | JSON with extra context |
| `ip_address` | str(45), nullable | client IP |
| `created_at` | datetime(tz) | auto |

Indexes: `(user_id, created_at)`, `(action, created_at)`.

### New Table: `user_quotas`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | auto-increment |
| `user_id` | int, FK → users.id, unique | one per user |
| `messages_soft` | int, nullable | warning threshold per month |
| `messages_hard` | int, nullable | block threshold per month |
| `tokens_soft` | int, nullable | token warning threshold |
| `tokens_hard` | int, nullable | token block threshold |
| `updated_at` | datetime(tz) | auto |

### Config Changes

Add to Settings:
- `admin_emails: str = ""` — comma-separated, grants admin role on registration

## API Endpoints

All `/api/admin/*` endpoints require `role == "admin"`.

### Users

| Method | Path | Response | Notes |
|---|---|---|---|
| `GET` | `/api/admin/users` | UserAdmin[] | All users with monthly usage stats, pagination |
| `GET` | `/api/admin/users/{id}` | UserAdminDetail | Full detail + recent activity |
| `PATCH` | `/api/admin/users/{id}` | UserAdmin | Update role, is_active |
| `DELETE` | `/api/admin/users/{id}` | 204 | Delete user + all data |

### System Analytics

| Method | Path | Response | Notes |
|---|---|---|---|
| `GET` | `/api/admin/analytics` | SystemAnalytics | Aggregate: total users, messages, tokens, costs, daily breakdown |
| `GET` | `/api/admin/analytics/users` | UserUsage[] | Per-user usage for a period |

### Audit Log

| Method | Path | Response | Notes |
|---|---|---|---|
| `GET` | `/api/admin/audit` | AuditPage | Paginated, filterable by user/action/date |

### Quotas

| Method | Path | Response | Notes |
|---|---|---|---|
| `GET` | `/api/admin/quotas` | UserQuota[] | All quotas |
| `PUT` | `/api/admin/quotas/{user_id}` | UserQuota | Set/update |
| `DELETE` | `/api/admin/quotas/{user_id}` | 204 | Remove (unlimited) |

### Response Schemas

```python
class UserAdmin(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    is_env_admin: bool
    created_at: datetime
    messages_this_month: int
    tokens_this_month: int

class UserAdminDetail(UserAdmin):
    chats_count: int
    documents_count: int
    recent_audit: list[AuditEntry]

class SystemAnalytics(BaseModel):
    total_users: int
    active_users_30d: int
    total_messages: int
    total_tokens: int
    total_cost: float
    daily: list  # [{date, messages, tokens, cost, active_users}]

class AuditEntry(BaseModel):
    id: int
    user_email: str | None
    user_name: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    details: str | None
    ip_address: str | None
    created_at: datetime

class AuditPage(BaseModel):
    entries: list[AuditEntry]
    next_cursor: str | None
    has_more: bool

class UserQuota(BaseModel):
    user_id: str
    user_email: str
    user_name: str
    messages_soft: int | None
    messages_hard: int | None
    tokens_soft: int | None
    tokens_hard: int | None
    messages_used: int
    tokens_used: int
```

## Audit Logging

### log_audit Function

```python
async def log_audit(
    db: AsyncSession,
    action: str,
    user_id: int | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
):
```

Called explicitly from endpoint handlers, not middleware.

### Events Logged

| Action | Router | Resource |
|---|---|---|
| `login` | auth.py | user |
| `logout` | auth.py | user |
| `register` | auth.py | user |
| `send_message` | chats.py | chat |
| `create_chat` | chats.py | chat |
| `delete_chat` | chats.py | chat |
| `upload_document` | documents.py | document |
| `delete_document` | documents.py | document |
| `create_skill` | skills.py | skill |
| `delete_skill` | skills.py | skill |
| `create_model` | models.py | model |
| `delete_model` | models.py | model |
| `tool_call` | chats.py | chat |
| `admin_promote` | admin.py | user |
| `admin_demote` | admin.py | user |
| `admin_delete_user` | admin.py | user |
| `admin_set_quota` | admin.py | user |
| `admin_disable_user` | admin.py | user |

IP address from `request.client.host`.

## Admin Role Rules

- **Env admins** (emails in `ADMIN_EMAILS`): permanent admins, cannot be demoted or deleted from dashboard
- **Promoted admins** (given admin via dashboard): can be demoted to `user` by any admin
- **Only env admins** can delete other admin users
- Registration checks `ADMIN_EMAILS` and sets `role = "admin"` if email matches

## Quota Enforcement

### In send_message

Before the LLM call:
1. Load `user_quotas` for user (if exists)
2. Load current month usage from Redis
3. If `messages >= messages_hard` or `tokens >= tokens_hard` → reject 429 "Monthly quota exceeded"
4. If `messages >= messages_soft` or `tokens >= tokens_soft` → allow, emit `warning` SSE event
5. No quota record → unlimited

### SSE Warning Event

```
event: warning
data: You have used 950 of 1000 messages this month
```

Frontend shows as non-blocking toast.

### GET /api/auth/me Changes

Add to response:
- `role: str` — user's role
- `quota_warning: str | None` — warning message if near soft limit, null otherwise

## Frontend UI

### Sidebar

New "Admin" nav item with shield icon, visible only to admins. Appears after Analytics.

### /admin — Overview

- Summary cards: Total Users, Active Users (30d), Messages Today, Tokens This Month, Monthly Cost
- Daily usage chart (recharts)
- Recent audit entries (last 20)

### /admin/users — User Management

- Table: Name, Email, Role, Status, Messages, Tokens, Joined, Actions
- Actions: role dropdown, toggle active, set quotas, delete
- Env admin emails shown with "Env Admin" badge, locked from demotion/deletion
- Search by email/name

### /admin/audit — Audit Log

- Table: Timestamp, User, Action, Resource, Details, IP
- Filters: action type, user search, date range
- Cursor-based pagination
- Color-coded action badges (auth=blue, data=green, admin=red)

### /admin/quotas — Quota Management

- Table: User, Messages Soft/Hard, Tokens Soft/Hard, Current Usage
- Inline editing for limits
- Progress bars (green/yellow/red)
- "Set for all" bulk action

### Auth Guard

`GET /api/auth/me` includes `role`. Frontend checks role on `/admin/*` pages, redirects non-admins to `/`.

## Migration

Migration `0024_admin_dashboard.py`:
1. Add `role` column to `users` (default `"user"`)
2. Create `audit_logs` table with indexes
3. Create `user_quotas` table
