from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.scheduled_task import ScheduledTask
from app.models.chat import Chat
from app.models.user import User
from app.schemas.scheduled_task import ScheduledTaskCreate, ScheduledTaskUpdate, ScheduledTaskOut
from app.scheduler.engine import update_job, remove_job, _run_scheduled_task

router = APIRouter(tags=["schedules"])


def _task_to_out(task: ScheduledTask, chat_public_id: str = None) -> ScheduledTaskOut:
    return ScheduledTaskOut(
        id=task.public_id,
        name=task.name,
        prompt=task.prompt,
        cron_expression=task.cron_expression,
        chat_id=chat_public_id,
        webhook_url=task.webhook_url,
        enabled=task.enabled,
        last_run_at=task.last_run_at,
        last_status=task.last_status,
        last_error=task.last_error,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("/api/schedules", response_model=List[ScheduledTaskOut])
async def list_schedules(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ScheduledTask)
        .where(ScheduledTask.user_id == user.id)
        .order_by(ScheduledTask.created_at.desc())
    )
    tasks = result.scalars().all()

    # Resolve chat public_ids
    out = []
    for task in tasks:
        chat_pid = None
        if task.chat_id:
            cr = await db.execute(select(Chat.public_id).where(Chat.id == task.chat_id))
            row = cr.scalar_one_or_none()
            if row:
                chat_pid = row
        out.append(_task_to_out(task, chat_pid))
    return out


@router.post("/api/schedules", response_model=ScheduledTaskOut, status_code=201)
async def create_schedule(
    body: ScheduledTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Validate cron expression (basic check)
    parts = body.cron_expression.strip().split()
    if len(parts) != 5:
        raise HTTPException(status_code=400, detail="Invalid cron expression. Expected 5 fields: minute hour day month weekday")

    task = ScheduledTask(
        user_id=user.id,
        name=body.name,
        prompt=body.prompt,
        cron_expression=body.cron_expression.strip(),
        webhook_url=body.webhook_url,
        enabled=True,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Register with scheduler
    update_job(task.public_id, task.cron_expression, True)

    return _task_to_out(task)


@router.patch("/api/schedules/{schedule_id}", response_model=ScheduledTaskOut)
async def update_schedule(
    schedule_id: str,
    body: ScheduledTaskUpdate,
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

    if body.name is not None:
        task.name = body.name
    if body.prompt is not None:
        task.prompt = body.prompt
    if body.cron_expression is not None:
        parts = body.cron_expression.strip().split()
        if len(parts) != 5:
            raise HTTPException(status_code=400, detail="Invalid cron expression")
        task.cron_expression = body.cron_expression.strip()
    if body.webhook_url is not None:
        task.webhook_url = body.webhook_url
    if body.enabled is not None:
        task.enabled = body.enabled

    await db.commit()
    await db.refresh(task)

    # Update scheduler
    update_job(task.public_id, task.cron_expression, task.enabled)

    chat_pid = None
    if task.chat_id:
        cr = await db.execute(select(Chat.public_id).where(Chat.id == task.chat_id))
        chat_pid = cr.scalar_one_or_none()

    return _task_to_out(task, chat_pid)


@router.delete("/api/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
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

    remove_job(task.public_id)
    await db.delete(task)
    await db.commit()


@router.post("/api/schedules/{schedule_id}/run", response_model=ScheduledTaskOut)
async def run_schedule_now(
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

    # Run in background
    import asyncio
    asyncio.ensure_future(_run_scheduled_task(task.public_id))

    return _task_to_out(task)
