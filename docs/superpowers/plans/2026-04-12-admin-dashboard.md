# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enterprise admin dashboard with user management, audit logging, usage quotas, and system-wide analytics — protected by role-based access control.

**Architecture:** Add `role` field to User model with `ADMIN_EMAILS` env var for admin designation. New `audit_logs` and `user_quotas` tables. Single admin router at `/api/admin/*` with `get_current_admin()` dependency. Audit logging via explicit `log_audit()` calls in existing routers. Quota enforcement in `send_message`. Frontend `/admin/*` pages with overview, users, audit, and quotas sub-pages.

**Tech Stack:** SQLAlchemy + Alembic, FastAPI, Pydantic, React + recharts + shadcn/ui

---

## File Structure

### Backend (new files)
- `backend/app/models/audit_log.py` — AuditLog model
- `backend/app/models/user_quota.py` — UserQuota model
- `backend/app/schemas/admin.py` — Admin response schemas
- `backend/app/routers/admin.py` — Admin CRUD + analytics endpoints
- `backend/app/auth/admin.py` — `get_current_admin()` dependency + `log_audit()` helper
- `backend/alembic/versions/0024_admin_dashboard.py` — Migration

### Backend (modified files)
- `backend/app/models/user.py` — Add `role` field
- `backend/app/schemas/auth.py` — Add `role` to UserOut
- `backend/app/routers/auth.py` — Set admin role on register, add role to /me
- `backend/app/routers/chats.py` — Audit logging + quota enforcement in send_message
- `backend/app/config.py` — Add `admin_emails` setting
- `backend/app/main.py` — Register admin router

### Frontend (new files)
- `frontend/src/app/admin/page.tsx` — Overview dashboard
- `frontend/src/app/admin/users/page.tsx` — User management
- `frontend/src/app/admin/audit/page.tsx` — Audit log viewer
- `frontend/src/app/admin/quotas/page.tsx` — Quota management
- `frontend/src/components/admin-guard.tsx` — Admin role check wrapper

### Frontend (modified files)
- `frontend/src/lib/api.ts` — Admin API types + functions
- `frontend/src/components/sidebar.tsx` — Add Admin nav item (visible to admins)
- `frontend/src/components/sidebar-content.tsx` — Add Admin nav item
- `frontend/src/components/auth-guard.tsx` — Expose `role` from user context

---

### Task 1: Database Migration

**Files:**
- Create: `backend/alembic/versions/0024_admin_dashboard.py`

- [ ] **Step 1: Create migration file**

```python
"""admin dashboard: role, audit_logs, user_quotas

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add role to users
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="user"),
    )

    # Create audit_logs table
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("resource_type", sa.String(30), nullable=True),
        sa.Column("resource_id", sa.String(50), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_audit_logs_action_created",
        "audit_logs",
        ["action", "created_at"],
    )

    # Create user_quotas table
    op.create_table(
        "user_quotas",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("messages_soft", sa.Integer(), nullable=True),
        sa.Column("messages_hard", sa.Integer(), nullable=True),
        sa.Column("tokens_soft", sa.Integer(), nullable=True),
        sa.Column("tokens_hard", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("user_quotas")
    op.drop_index("ix_audit_logs_action_created", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_column("users", "role")
```

- [ ] **Step 2: Commit**

---

### Task 2: Models + Config

**Files:**
- Create: `backend/app/models/audit_log.py`
- Create: `backend/app/models/user_quota.py`
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/config.py`

- [ ] **Step 1: Create AuditLog model**

Create `backend/app/models/audit_log.py`:

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[Optional[str]] = mapped_column(String(30), default=None)
    resource_id: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    details: Mapped[Optional[str]] = mapped_column(Text, default=None)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

- [ ] **Step 2: Create UserQuota model**

Create `backend/app/models/user_quota.py`:

```python
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserQuota(Base):
    __tablename__ = "user_quotas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    messages_soft: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    messages_hard: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_soft: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    tokens_hard: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 3: Add role to User model**

In `backend/app/models/user.py`, add after `is_active`:

```python
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user")
```

Add `String` to the sqlalchemy imports if not already present.

- [ ] **Step 4: Add admin_emails to config**

In `backend/app/config.py`, add after `encryption_key`:

```python
    # Admin — emails that get admin role on registration
    admin_emails: str = ""  # comma-separated
```

- [ ] **Step 5: Commit**

---

### Task 3: Admin Auth + Audit Helper

**Files:**
- Create: `backend/app/auth/admin.py`
- Modify: `backend/app/schemas/auth.py`

- [ ] **Step 1: Create admin dependency and audit helper**

Create `backend/app/auth/admin.py`:

```python
import json
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Require the current user to be an admin."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def log_audit(
    db: AsyncSession,
    action: str,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Log an audit event."""
    try:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=json.dumps(details) if details else None,
            ip_address=ip_address,
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        logger.warning("Failed to log audit event: %s", e)


def get_client_ip(request: Request) -> str:
    """Extract client IP from request."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
```

- [ ] **Step 2: Update UserOut schema to include role**

In `backend/app/schemas/auth.py`, update `UserOut`:

```python
class UserOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    email: str
    name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
```

- [ ] **Step 3: Commit**

---

### Task 4: Admin Schemas

**Files:**
- Create: `backend/app/schemas/admin.py`

- [ ] **Step 1: Create admin schemas**

Create `backend/app/schemas/admin.py`:

```python
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


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


class UserAdminUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class SystemAnalytics(BaseModel):
    total_users: int
    active_users_30d: int
    total_messages: int
    total_tokens: int
    total_cost: float
    daily: List[dict]


class AuditEntry(BaseModel):
    id: int
    user_email: Optional[str]
    user_name: Optional[str]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: datetime


class AuditPage(BaseModel):
    entries: List[AuditEntry]
    next_cursor: Optional[str] = None
    has_more: bool = False


class UserQuotaOut(BaseModel):
    user_id: str
    user_email: str
    user_name: str
    messages_soft: Optional[int]
    messages_hard: Optional[int]
    tokens_soft: Optional[int]
    tokens_hard: Optional[int]
    messages_used: int
    tokens_used: int


class UserQuotaUpdate(BaseModel):
    messages_soft: Optional[int] = None
    messages_hard: Optional[int] = None
    tokens_soft: Optional[int] = None
    tokens_hard: Optional[int] = None
```

- [ ] **Step 2: Commit**

---

### Task 5: Admin Router

**Files:**
- Create: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the admin router**

Create `backend/app/routers/admin.py`:

```python
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.admin import get_current_admin, log_audit, get_client_ip
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.chat import Chat, Message
from app.models.user import User
from app.models.user_quota import UserQuota
from app.schemas.admin import (
    AuditEntry,
    AuditPage,
    SystemAnalytics,
    UserAdmin,
    UserAdminUpdate,
    UserQuotaOut,
    UserQuotaUpdate,
)
from app.usage import get_usage

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _is_env_admin(email: str, settings: Settings) -> bool:
    if not settings.admin_emails:
        return False
    return email.lower() in [e.strip().lower() for e in settings.admin_emails.split(",")]


# ── Users ──


@router.get("/users", response_model=List[UserAdmin])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
    settings: Settings = Depends(get_settings),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    out = []
    for u in users:
        usage = await get_usage(u.id)
        out.append(
            UserAdmin(
                id=u.public_id,
                email=u.email,
                name=u.name,
                role=u.role,
                is_active=u.is_active,
                is_env_admin=_is_env_admin(u.email, settings),
                created_at=u.created_at,
                messages_this_month=usage["messages"],
                tokens_this_month=usage["tokens_total"],
            )
        )
    return out


@router.patch("/users/{user_id}", response_model=UserAdmin)
async def update_user(
    user_id: str,
    body: UserAdminUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
    settings: Settings = Depends(get_settings),
):
    result = await db.execute(select(User).where(User.public_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_target_env_admin = _is_env_admin(user.email, settings)

    # Env admins cannot be demoted
    if body.role is not None and body.role != user.role:
        if is_target_env_admin:
            raise HTTPException(
                status_code=403, detail="Cannot change role of env admin"
            )
        if body.role not in ("user", "admin", "viewer"):
            raise HTTPException(status_code=400, detail="Invalid role")
        # Only env admins can demote other admins
        if user.role == "admin" and not _is_env_admin(admin.email, settings):
            raise HTTPException(
                status_code=403,
                detail="Only env admins can demote other admins",
            )
        old_role = user.role
        user.role = body.role
        await log_audit(
            db,
            action="admin_promote" if body.role == "admin" else "admin_demote",
            user_id=admin.id,
            resource_type="user",
            resource_id=user.public_id,
            details={"from": old_role, "to": body.role},
            ip_address=get_client_ip(request),
        )

    if body.is_active is not None and body.is_active != user.is_active:
        if is_target_env_admin and not body.is_active:
            raise HTTPException(
                status_code=403, detail="Cannot deactivate env admin"
            )
        user.is_active = body.is_active
        await log_audit(
            db,
            action="admin_disable_user" if not body.is_active else "admin_enable_user",
            user_id=admin.id,
            resource_type="user",
            resource_id=user.public_id,
            ip_address=get_client_ip(request),
        )

    await db.commit()
    await db.refresh(user)

    usage = await get_usage(user.id)
    return UserAdmin(
        id=user.public_id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        is_env_admin=is_target_env_admin,
        created_at=user.created_at,
        messages_this_month=usage["messages"],
        tokens_this_month=usage["tokens_total"],
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
    settings: Settings = Depends(get_settings),
):
    result = await db.execute(select(User).where(User.public_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if _is_env_admin(user.email, settings):
        raise HTTPException(status_code=403, detail="Cannot delete env admin")

    if user.role == "admin" and not _is_env_admin(admin.email, settings):
        raise HTTPException(
            status_code=403, detail="Only env admins can delete admin users"
        )

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    await log_audit(
        db,
        action="admin_delete_user",
        user_id=admin.id,
        resource_type="user",
        resource_id=user.public_id,
        details={"email": user.email},
        ip_address=get_client_ip(request),
    )

    await db.delete(user)
    await db.commit()


# ── System Analytics ──


@router.get("/analytics", response_model=SystemAnalytics)
async def system_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
    settings: Settings = Depends(get_settings),
):
    since = datetime.utcnow() - timedelta(days=days)

    # Total users
    total_users = (await db.execute(select(func.count(User.id)))).scalar()

    # Active users (sent a message in last 30 days)
    active_result = await db.execute(
        select(func.count(func.distinct(Chat.user_id))).where(
            Chat.updated_at >= datetime.utcnow() - timedelta(days=30)
        )
    )
    active_users = active_result.scalar()

    # Message stats in period
    msg_stats = await db.execute(
        select(
            func.count(Message.id),
            func.coalesce(func.sum(Message.tokens_total), 0),
            func.coalesce(func.sum(Message.tokens_input), 0),
            func.coalesce(func.sum(Message.tokens_output), 0),
        ).where(
            Message.created_at >= since,
            Message.role == "assistant",
        )
    )
    row = msg_stats.one()
    total_messages = row[0]
    total_tokens = row[1]
    tokens_input = row[2]
    tokens_output = row[3]

    cost = (
        tokens_input * settings.cost_per_million_input / 1_000_000
        + tokens_output * settings.cost_per_million_output / 1_000_000
    )

    # Daily breakdown
    from sqlalchemy import cast, Date

    daily_result = await db.execute(
        select(
            cast(Message.created_at, Date).label("date"),
            func.count(Message.id).label("messages"),
            func.coalesce(func.sum(Message.tokens_total), 0).label("tokens"),
        )
        .where(Message.created_at >= since, Message.role == "assistant")
        .group_by(cast(Message.created_at, Date))
        .order_by(cast(Message.created_at, Date))
    )
    daily = [
        {
            "date": str(r.date),
            "messages": r.messages,
            "tokens": r.tokens,
            "cost": round(r.tokens * (settings.cost_per_million_input + settings.cost_per_million_output) / 2 / 1_000_000, 4),
        }
        for r in daily_result.all()
    ]

    return SystemAnalytics(
        total_users=total_users,
        active_users_30d=active_users,
        total_messages=total_messages,
        total_tokens=total_tokens,
        total_cost=round(cost, 4),
        daily=daily,
    )


# ── Audit Log ──


@router.get("/audit", response_model=AuditPage)
async def list_audit(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    query = select(AuditLog, User.email, User.name).outerjoin(
        User, AuditLog.user_id == User.id
    ).order_by(AuditLog.created_at.desc())

    if action:
        query = query.where(AuditLog.action == action)

    if user_id:
        # Resolve public_id to internal id
        uid_result = await db.execute(
            select(User.id).where(User.public_id == user_id)
        )
        uid = uid_result.scalar_one_or_none()
        if uid:
            query = query.where(AuditLog.user_id == uid)

    if cursor:
        try:
            cursor_id = int(cursor)
            query = query.where(AuditLog.id < cursor_id)
        except ValueError:
            pass

    result = await db.execute(query.limit(limit + 1))
    rows = result.all()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    entries = [
        AuditEntry(
            id=row[0].id,
            user_email=row[1],
            user_name=row[2],
            action=row[0].action,
            resource_type=row[0].resource_type,
            resource_id=row[0].resource_id,
            details=row[0].details,
            ip_address=row[0].ip_address,
            created_at=row[0].created_at,
        )
        for row in rows
    ]

    next_cursor = str(entries[-1].id) if has_more and entries else None

    return AuditPage(entries=entries, next_cursor=next_cursor, has_more=has_more)


# ── Quotas ──


@router.get("/quotas", response_model=List[UserQuotaOut])
async def list_quotas(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(UserQuota, User.public_id, User.email, User.name)
        .join(User, UserQuota.user_id == User.id)
        .order_by(User.name)
    )
    rows = result.all()

    out = []
    for quota, pub_id, email, name in rows:
        usage = await get_usage(quota.user_id)
        out.append(
            UserQuotaOut(
                user_id=pub_id,
                user_email=email,
                user_name=name,
                messages_soft=quota.messages_soft,
                messages_hard=quota.messages_hard,
                tokens_soft=quota.tokens_soft,
                tokens_hard=quota.tokens_hard,
                messages_used=usage["messages"],
                tokens_used=usage["tokens_total"],
            )
        )
    return out


@router.put("/quotas/{user_id}", response_model=UserQuotaOut)
async def set_quota(
    user_id: str,
    body: UserQuotaUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    # Resolve user
    user_result = await db.execute(select(User).where(User.public_id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Upsert quota
    quota_result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user.id)
    )
    quota = quota_result.scalar_one_or_none()

    if quota:
        if body.messages_soft is not None:
            quota.messages_soft = body.messages_soft
        if body.messages_hard is not None:
            quota.messages_hard = body.messages_hard
        if body.tokens_soft is not None:
            quota.tokens_soft = body.tokens_soft
        if body.tokens_hard is not None:
            quota.tokens_hard = body.tokens_hard
    else:
        quota = UserQuota(
            user_id=user.id,
            messages_soft=body.messages_soft,
            messages_hard=body.messages_hard,
            tokens_soft=body.tokens_soft,
            tokens_hard=body.tokens_hard,
        )
        db.add(quota)

    await log_audit(
        db,
        action="admin_set_quota",
        user_id=admin.id,
        resource_type="user",
        resource_id=user.public_id,
        details={
            "messages_soft": body.messages_soft,
            "messages_hard": body.messages_hard,
            "tokens_soft": body.tokens_soft,
            "tokens_hard": body.tokens_hard,
        },
        ip_address=get_client_ip(request),
    )

    await db.commit()
    await db.refresh(quota)

    usage = await get_usage(user.id)
    return UserQuotaOut(
        user_id=user.public_id,
        user_email=user.email,
        user_name=user.name,
        messages_soft=quota.messages_soft,
        messages_hard=quota.messages_hard,
        tokens_soft=quota.tokens_soft,
        tokens_hard=quota.tokens_hard,
        messages_used=usage["messages"],
        tokens_used=usage["tokens_total"],
    )


@router.delete("/quotas/{user_id}", status_code=204)
async def delete_quota(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user_result = await db.execute(select(User).where(User.public_id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    quota_result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == user.id)
    )
    quota = quota_result.scalar_one_or_none()
    if quota:
        await db.delete(quota)
        await db.commit()
```

- [ ] **Step 2: Register router in main.py**

Add import: `from app.routers.admin import router as admin_router`
Add: `app.include_router(admin_router)`

- [ ] **Step 3: Commit**

---

### Task 6: Auth Integration — Admin Role on Register + Audit Logging

**Files:**
- Modify: `backend/app/routers/auth.py`

- [ ] **Step 1: Set admin role on registration**

In the `register` endpoint, after creating the user object but before `db.add(user)`, add:

```python
    # Check if email is an admin email
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if body.email.lower() in admin_list:
        user.role = "admin"
```

- [ ] **Step 2: Add audit logging to login/logout/register**

Add imports at top:
```python
from app.auth.admin import log_audit, get_client_ip
```

In `register`, after the commit:
```python
    await log_audit(db, "register", user_id=user.id, resource_type="user", resource_id=user.public_id, ip_address=get_client_ip(request))
```

Add `request: Request` to the register endpoint parameters (import Request from fastapi).

In `login`, after successful auth:
```python
    await log_audit(db, "login", user_id=user.id, resource_type="user", resource_id=user.public_id, ip_address=get_client_ip(request))
```

Add `request: Request` parameter to login.

In `logout`:
```python
    # Log before clearing (need user context)
```

Actually, logout doesn't have the user dependency. Add audit logging only where we have user context (login, register).

- [ ] **Step 3: Commit**

---

### Task 7: Quota Enforcement in send_message

**Files:**
- Modify: `backend/app/routers/chats.py`

- [ ] **Step 1: Add quota check before LLM call**

In `send_message`, inside `event_generator()`, after model resolution and before the pre_message hooks, add:

```python
        # Quota enforcement
        from app.models.user_quota import UserQuota as UQ
        quota_result = await db.execute(
            select(UQ).where(UQ.user_id == user.id)
        )
        user_quota = quota_result.scalar_one_or_none()
        if user_quota:
            from app.usage import get_usage as _get_usage
            current_usage = await _get_usage(user.id)
            msg_count = current_usage["messages"]
            tok_count = current_usage["tokens_total"]

            # Hard limit check
            if user_quota.messages_hard and msg_count >= user_quota.messages_hard:
                yield {"event": "error", "data": "Monthly message quota exceeded"}
                yield {"event": "done", "data": ""}
                return
            if user_quota.tokens_hard and tok_count >= user_quota.tokens_hard:
                yield {"event": "error", "data": "Monthly token quota exceeded"}
                yield {"event": "done", "data": ""}
                return

            # Soft limit warning
            if user_quota.messages_soft and msg_count >= user_quota.messages_soft:
                yield {"event": "warning", "data": f"You have used {msg_count} of {user_quota.messages_hard or 'unlimited'} messages this month"}
            elif user_quota.tokens_soft and tok_count >= user_quota.tokens_soft:
                yield {"event": "warning", "data": f"You have used {tok_count} of {user_quota.tokens_hard or 'unlimited'} tokens this month"}
```

- [ ] **Step 2: Add audit logging for send_message**

After the message is saved (after the `assistant_msg` commit), add:

```python
            from app.auth.admin import log_audit as _log_audit
            await _log_audit(
                db, "send_message",
                user_id=user.id,
                resource_type="chat",
                resource_id=chat_id,
                details={"tokens": metrics.get("tokens_total", 0)} if metrics else None,
            )
```

- [ ] **Step 3: Commit**

---

### Task 8: Frontend API Types and Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/auth-guard.tsx`

- [ ] **Step 1: Add admin types and API functions**

Add to `frontend/src/lib/api.ts`:

```typescript
// ── Admin Types ──

export interface UserAdmin {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  is_env_admin: boolean;
  created_at: string;
  messages_this_month: number;
  tokens_this_month: number;
}

export interface SystemAnalytics {
  total_users: number;
  active_users_30d: number;
  total_messages: number;
  total_tokens: number;
  total_cost: number;
  daily: { date: string; messages: number; tokens: number; cost: number }[];
}

export interface AuditEntry {
  id: number;
  user_email: string | null;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface UserQuotaOut {
  user_id: string;
  user_email: string;
  user_name: string;
  messages_soft: number | null;
  messages_hard: number | null;
  tokens_soft: number | null;
  tokens_hard: number | null;
  messages_used: number;
  tokens_used: number;
}

// ── Admin API ──

export async function adminListUsers(): Promise<UserAdmin[]> {
  const res = await authFetch(`${API_BASE}/api/admin/users`);
  if (!res.ok) throw new Error("Failed to list users");
  return res.json();
}

export async function adminUpdateUser(
  userId: string,
  updates: { role?: string; is_active?: boolean }
): Promise<UserAdmin> {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update user" }));
    throw new Error(err.detail || "Failed to update user");
  }
  return res.json();
}

export async function adminDeleteUser(userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to delete user" }));
    throw new Error(err.detail || "Failed to delete user");
  }
}

export async function adminGetAnalytics(days = 30): Promise<SystemAnalytics> {
  const res = await authFetch(`${API_BASE}/api/admin/analytics?days=${days}`);
  if (!res.ok) throw new Error("Failed to get system analytics");
  return res.json();
}

export async function adminGetAudit(
  cursor?: string | null,
  action?: string,
  userId?: string
): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (action) params.set("action", action);
  if (userId) params.set("user_id", userId);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}/api/admin/audit${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to get audit log");
  return res.json();
}

export async function adminListQuotas(): Promise<UserQuotaOut[]> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas`);
  if (!res.ok) throw new Error("Failed to list quotas");
  return res.json();
}

export async function adminSetQuota(
  userId: string,
  quota: { messages_soft?: number | null; messages_hard?: number | null; tokens_soft?: number | null; tokens_hard?: number | null }
): Promise<UserQuotaOut> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas/${userId}`, {
    method: "PUT",
    body: JSON.stringify(quota),
  });
  if (!res.ok) throw new Error("Failed to set quota");
  return res.json();
}

export async function adminDeleteQuota(userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete quota");
}
```

- [ ] **Step 2: Update UserInfo to include role**

Update the existing `UserInfo` interface:
```typescript
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}
```

- [ ] **Step 3: Expose role in auth-guard**

Read `frontend/src/components/auth-guard.tsx` and ensure the `user` object from `useAuth()` includes `role`. The `getMe()` call returns `UserInfo` which now has `role` — verify the auth context passes it through.

- [ ] **Step 4: Commit**

---

### Task 9: Admin Guard Component + Sidebar Nav

**Files:**
- Create: `frontend/src/components/admin-guard.tsx`
- Modify: `frontend/src/components/sidebar.tsx`
- Modify: `frontend/src/components/sidebar-content.tsx`

- [ ] **Step 1: Create AdminGuard**

Create `frontend/src/components/admin-guard.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-guard";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!isAuthenticated || user?.role !== "admin")) {
      router.replace("/");
    }
  }, [loading, isAuthenticated, user, router]);

  if (loading || !isAuthenticated || user?.role !== "admin") {
    return null;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Add Admin nav item to sidebar**

In `frontend/src/components/sidebar.tsx`, add `Shield` to lucide-react imports and add to NAV_ITEMS:

```typescript
import { Plus, FileText, Zap, Anchor, Plug, PanelLeft, PanelLeftClose, BarChart3, Shield } from "lucide-react";
```

The Admin nav item should be conditionally shown based on user role. Since the Sidebar component doesn't currently have access to auth context, add it:

```typescript
import { useAuth } from "@/components/auth-guard";
```

Inside the Sidebar function, add:
```typescript
const { user } = useAuth();
```

Add the Admin item conditionally after the NAV_ITEMS map but inside the nav container:

```tsx
{user?.role === "admin" && (
  <button
    onClick={() => router.push("/admin")}
    title={collapsed ? "Admin" : undefined}
    className={cn(
      "group flex items-center rounded-xl transition-all",
      collapsed
        ? cn("h-9 w-9 justify-center", pathname.startsWith("/admin") ? "bg-red-500/25" : "bg-red-500/10")
        : cn(
            "gap-3 border px-3 py-2.5 hover:shadow-md",
            pathname.startsWith("/admin")
              ? "border-red-500/30 bg-red-500/5 shadow-md"
              : "border-border/60 bg-card shadow-sm hover:border-red-500/30 hover:bg-accent"
          )
    )}
  >
    <div className={cn(
      "flex shrink-0 items-center justify-center rounded-lg transition-colors",
      collapsed ? "" : "h-8 w-8",
      !collapsed && (pathname.startsWith("/admin") ? "bg-red-500/25" : "bg-red-500/10")
    )}>
      <Shield className="h-4 w-4 text-red-500" />
    </div>
    {!collapsed && (
      <span className={cn(
        "truncate text-sm font-medium transition-colors",
        pathname.startsWith("/admin") ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
        Admin
      </span>
    )}
  </button>
)}
```

Do the same for `sidebar-content.tsx` NAV_ITEMS — add Admin conditionally after the existing items.

- [ ] **Step 3: Commit**

---

### Task 10: Admin Overview Page

**Files:**
- Create: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Create admin overview page**

Create `frontend/src/app/admin/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, MessageSquare, Zap, DollarSign, Activity } from "lucide-react";
import { AdminGuard } from "@/components/admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { adminGetAnalytics, adminGetAudit, type SystemAnalytics, type AuditEntry } from "@/lib/api";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const ACTION_COLORS: Record<string, string> = {
  login: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  logout: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  register: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  send_message: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  create_chat: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  delete_chat: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  admin_promote: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin_demote: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin_delete_user: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function AdminPage() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [stats, audit] = await Promise.all([
        adminGetAnalytics(30),
        adminGetAudit(),
      ]);
      setAnalytics(stats);
      setRecentAudit(audit.entries.slice(0, 20));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <AdminGuard>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <h1 className="mb-6 text-2xl font-bold">Admin Dashboard</h1>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : analytics ? (
          <>
            {/* Summary Cards */}
            <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
              {[
                { icon: Users, label: "Total Users", value: analytics.total_users },
                { icon: Activity, label: "Active (30d)", value: analytics.active_users_30d },
                { icon: MessageSquare, label: "Messages", value: formatNumber(analytics.total_messages) },
                { icon: Zap, label: "Tokens", value: formatNumber(analytics.total_tokens) },
                { icon: DollarSign, label: "Cost", value: `$${analytics.total_cost.toFixed(2)}` },
              ].map((card) => (
                <Card key={card.label}>
                  <CardContent className="p-4 text-center">
                    <card.icon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-2xl font-bold">{card.value}</p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Quick Links */}
            <div className="mb-8 flex flex-wrap gap-2">
              <button
                onClick={() => router.push("/admin/users")}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Manage Users
              </button>
              <button
                onClick={() => router.push("/admin/audit")}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Audit Log
              </button>
              <button
                onClick={() => router.push("/admin/quotas")}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Quotas
              </button>
            </div>

            {/* Recent Audit */}
            <h2 className="mb-3 text-lg font-semibold">Recent Activity</h2>
            <div className="space-y-1">
              {recentAudit.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50"
                >
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      ACTION_COLORS[entry.action] || "bg-muted text-muted-foreground"
                    }`}
                  >
                    {entry.action}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {entry.user_email || "system"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
              {recentAudit.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No activity yet
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Failed to load analytics</p>
        )}
      </div>
    </AdminGuard>
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 11: Admin Users Page

**Files:**
- Create: `frontend/src/app/admin/users/page.tsx`

- [ ] **Step 1: Create users management page**

Create `frontend/src/app/admin/users/page.tsx` with a table showing all users, role dropdowns, active toggles, and delete buttons. Use `adminListUsers`, `adminUpdateUser`, `adminDeleteUser` from api.ts. Wrap in `AdminGuard`. Show "Env Admin" badge for env admins with disabled role dropdown. Confirmation dialog for delete. Toast notifications for actions.

The page should include:
- Search input to filter by name/email
- Table columns: Name, Email, Role, Status, Messages, Tokens, Joined, Actions
- Role: Select dropdown (disabled for env admins)
- Status: Switch toggle (disabled for env admins)
- Delete: Button (hidden for env admins and self)

- [ ] **Step 2: Commit**

---

### Task 12: Admin Audit Page

**Files:**
- Create: `frontend/src/app/admin/audit/page.tsx`

- [ ] **Step 1: Create audit log page**

Create `frontend/src/app/admin/audit/page.tsx` with:
- Action filter dropdown (all, login, send_message, create_chat, etc.)
- Infinite scroll table using cursor-based pagination
- Columns: Time, User, Action (color badge), Resource, IP
- Expandable details row (JSON formatted)
- Wrap in `AdminGuard`

- [ ] **Step 2: Commit**

---

### Task 13: Admin Quotas Page

**Files:**
- Create: `frontend/src/app/admin/quotas/page.tsx`

- [ ] **Step 1: Create quotas management page**

Create `frontend/src/app/admin/quotas/page.tsx` with:
- Table of users with quotas
- Inline editable fields for soft/hard limits
- Progress bars showing usage vs limits (green < 50%, yellow 50-80%, red > 80%)
- "Add Quota" button to set quota for a user (user search dropdown)
- Delete quota button (resets to unlimited)
- Wrap in `AdminGuard`

- [ ] **Step 2: Commit**

---

### Task 14: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add admin env vars**

Add after the ENCRYPTION_KEY section:

```bash
# ── Admin ──
# Comma-separated emails that get admin role on registration
# These admins cannot be demoted or deleted from the dashboard
ADMIN_EMAILS=
```

- [ ] **Step 2: Commit**

---

### Task 15: Smoke Test

- [ ] **Step 1: Run migration**

Run: `make migrate`

- [ ] **Step 2: Set ADMIN_EMAILS and restart**

Add `ADMIN_EMAILS=your@email.com` to `.env`, restart backend.

- [ ] **Step 3: Register with admin email and verify**

Register with the admin email, verify `/api/auth/me` returns `role: "admin"`.

- [ ] **Step 4: Test admin endpoints**

```bash
curl -s http://localhost:8000/api/admin/users -b cookies.txt | python3 -m json.tool
curl -s http://localhost:8000/api/admin/analytics -b cookies.txt | python3 -m json.tool
curl -s http://localhost:8000/api/admin/audit -b cookies.txt | python3 -m json.tool
```

- [ ] **Step 5: Test frontend**

Navigate to `/admin`, verify dashboard loads with stats and recent activity.
Navigate to `/admin/users`, verify user list with role controls.
