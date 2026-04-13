"""Admin dashboard — user management, analytics, audit log, quotas."""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.admin import get_client_ip, get_current_admin, log_audit
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _parse_admin_emails(settings: Settings) -> set:
    """Return the set of env-configured admin emails (lowercased)."""
    if not settings.admin_emails:
        return set()
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


def _is_env_admin(email: str, settings: Settings) -> bool:
    return email.lower() in _parse_admin_emails(settings)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


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
                messages_this_month=usage.get("messages", 0),
                tokens_this_month=usage.get("tokens_total", 0),
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
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    env_admins = _parse_admin_emails(settings)
    admin_is_env = admin.email.lower() in env_admins
    target_is_env = target.email.lower() in env_admins

    # Env admins cannot be demoted
    if target_is_env and body.role is not None and body.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot demote an environment admin",
        )

    # Only env admins can demote or deactivate other admins
    if target.role == "admin" and not admin_is_env:
        if (body.role is not None and body.role != "admin") or body.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only environment admins can demote or deactivate other admins",
            )

    changes = {}
    if body.role is not None and body.role != target.role:
        changes["role"] = {"from": target.role, "to": body.role}
        target.role = body.role
    if body.is_active is not None and body.is_active != target.is_active:
        changes["is_active"] = {"from": target.is_active, "to": body.is_active}
        target.is_active = body.is_active

    await db.flush()

    await log_audit(
        db,
        action="user.update",
        user_id=admin.id,
        resource_type="user",
        resource_id=str(target.id),
        details=changes or None,
        ip_address=get_client_ip(request),
    )
    await db.commit()

    usage = await get_usage(target.id)
    return UserAdmin(
        id=target.public_id,
        email=target.email,
        name=target.name,
        role=target.role,
        is_active=target.is_active,
        is_env_admin=target_is_env,
        created_at=target.created_at,
        messages_this_month=usage.get("messages", 0),
        tokens_this_month=usage.get("tokens_total", 0),
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
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Users can't delete themselves
    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete yourself",
        )

    env_admins = _parse_admin_emails(settings)
    admin_is_env = admin.email.lower() in env_admins
    target_is_env = target.email.lower() in env_admins

    # Env admins cannot be deleted
    if target_is_env:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete an environment admin",
        )

    # Only env admins can delete other admin users
    if target.role == "admin" and not admin_is_env:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only environment admins can delete other admins",
        )

    await log_audit(
        db,
        action="user.delete",
        user_id=admin.id,
        resource_type="user",
        resource_id=str(target.id),
        details={"email": target.email},
        ip_address=get_client_ip(request),
    )

    await db.delete(target)
    await db.commit()


# ---------------------------------------------------------------------------
# System Analytics
# ---------------------------------------------------------------------------


@router.get("/analytics", response_model=SystemAnalytics)
async def system_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
    settings: Settings = Depends(get_settings),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Total users
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0

    # Active users (sent at least one message in period)
    active_sub = (
        select(Chat.user_id)
        .join(Message, Message.chat_id == Chat.id)
        .where(Message.created_at >= since, Message.role == "user")
        .distinct()
    )
    active_users = (
        await db.execute(select(func.count()).select_from(active_sub.subquery()))
    ).scalar() or 0

    # Aggregate message stats in period (assistant messages with tokens)
    agg = await db.execute(
        select(
            func.count(Message.id),
            func.coalesce(func.sum(Message.tokens_total), 0),
            func.coalesce(func.sum(Message.tokens_input), 0),
            func.coalesce(func.sum(Message.tokens_output), 0),
        )
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            Message.role == "assistant",
            Message.created_at >= since,
        )
    )
    row = agg.one()
    total_messages = row[0] or 0
    total_tokens = row[1] or 0
    total_input = row[2] or 0
    total_output = row[3] or 0
    total_cost = round(
        (total_input / 1_000_000) * settings.cost_per_million_input
        + (total_output / 1_000_000) * settings.cost_per_million_output,
        4,
    )

    # Daily breakdown
    daily_result = await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            func.count(Message.id).label("messages"),
            func.coalesce(func.sum(Message.tokens_total), 0).label("tokens"),
            func.coalesce(func.sum(Message.tokens_input), 0).label("tokens_in"),
            func.coalesce(func.sum(Message.tokens_output), 0).label("tokens_out"),
        )
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            Message.role == "assistant",
            Message.created_at >= since,
        )
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
    )
    daily = []
    for dr in daily_result.all():
        t_in = dr.tokens_in or 0
        t_out = dr.tokens_out or 0
        cost = round(
            (t_in / 1_000_000) * settings.cost_per_million_input
            + (t_out / 1_000_000) * settings.cost_per_million_output,
            4,
        )
        daily.append(
            {
                "date": str(dr.day),
                "messages": dr.messages,
                "tokens": dr.tokens or 0,
                "cost": cost,
            }
        )

    return SystemAnalytics(
        total_users=total_users,
        active_users_30d=active_users,
        total_messages=total_messages,
        total_tokens=total_tokens,
        total_cost=total_cost,
        daily=daily,
    )


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------


@router.get("/audit", response_model=AuditPage)
async def list_audit(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    q = (
        select(AuditLog, User.email, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
    )

    if action:
        q = q.where(AuditLog.action == action)

    if user_id:
        # Resolve public_id to internal id
        uid_result = await db.execute(select(User.id).where(User.public_id == user_id))
        uid = uid_result.scalar_one_or_none()
        if uid:
            q = q.where(AuditLog.user_id == uid)
        else:
            return AuditPage(entries=[], next_cursor=None, has_more=False)

    if cursor:
        try:
            cursor_id = int(cursor)
            q = q.where(AuditLog.id < cursor_id)
        except ValueError:
            pass

    q = q.order_by(AuditLog.id.desc()).limit(limit + 1)
    result = await db.execute(q)
    rows = result.all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    entries = [
        AuditEntry(
            id=log.id,
            user_email=email,
            user_name=name,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            details=log.details,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log, email, name in rows
    ]

    next_cursor = str(entries[-1].id) if has_more and entries else None

    return AuditPage(entries=entries, next_cursor=next_cursor, has_more=has_more)


# ---------------------------------------------------------------------------
# Quotas
# ---------------------------------------------------------------------------


@router.get("/quotas", response_model=List[UserQuotaOut])
async def list_quotas(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(UserQuota, User.public_id, User.email, User.name)
        .join(User, User.id == UserQuota.user_id)
        .order_by(User.email)
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
                messages_used=usage.get("messages", 0),
                tokens_used=usage.get("tokens_total", 0),
            )
        )
    return out


@router.put("/quotas/{user_id}", response_model=UserQuotaOut)
async def upsert_quota(
    user_id: str,
    body: UserQuotaUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    # Resolve public_id
    result = await db.execute(select(User).where(User.public_id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Upsert
    q_result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == target.id)
    )
    quota = q_result.scalar_one_or_none()

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
            user_id=target.id,
            messages_soft=body.messages_soft,
            messages_hard=body.messages_hard,
            tokens_soft=body.tokens_soft,
            tokens_hard=body.tokens_hard,
        )
        db.add(quota)

    await db.flush()

    await log_audit(
        db,
        action="quota.upsert",
        user_id=admin.id,
        resource_type="quota",
        resource_id=str(target.id),
        details=body.model_dump(exclude_none=True),
        ip_address=get_client_ip(request),
    )
    await db.commit()

    usage = await get_usage(target.id)
    return UserQuotaOut(
        user_id=target.public_id,
        user_email=target.email,
        user_name=target.name,
        messages_soft=quota.messages_soft,
        messages_hard=quota.messages_hard,
        tokens_soft=quota.tokens_soft,
        tokens_hard=quota.tokens_hard,
        messages_used=usage.get("messages", 0),
        tokens_used=usage.get("tokens_total", 0),
    )


@router.delete("/quotas/{user_id}", status_code=204)
async def delete_quota(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(User).where(User.public_id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    deleted = await db.execute(
        delete(UserQuota).where(UserQuota.user_id == target.id)
    )
    if deleted.rowcount == 0:
        raise HTTPException(status_code=404, detail="Quota not found")

    await log_audit(
        db,
        action="quota.delete",
        user_id=admin.id,
        resource_type="quota",
        resource_id=str(target.id),
        ip_address=get_client_ip(request),
    )
    await db.commit()
