"""APScheduler 3.x-based cron scheduler for scheduled agent tasks."""

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.base import JobLookupError

from app.config import get_settings
from app.db.session import get_session_factory

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None


async def start_scheduler():
    """Initialize and start the APScheduler."""
    global _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.start()

    # Load all enabled tasks from DB
    async with get_session_factory()() as db:
        from sqlalchemy import select
        from app.models.scheduled_task import ScheduledTask

        result = await db.execute(
            select(ScheduledTask).where(ScheduledTask.enabled == True)  # noqa: E712
        )
        tasks = result.scalars().all()
        for task in tasks:
            _add_job(task.public_id, task.cron_expression)
        logger.info("Scheduler started with %d tasks", len(tasks))


async def stop_scheduler():
    """Stop the scheduler gracefully."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Scheduler stopped")


def _add_job(task_public_id: str, cron_expression: str):
    """Add or replace a job in the scheduler."""
    if not _scheduler:
        return
    parts = cron_expression.strip().split()
    if len(parts) != 5:
        logger.error(
            "Invalid cron expression for task %s: %s", task_public_id, cron_expression
        )
        return

    trigger = CronTrigger(
        minute=parts[0],
        hour=parts[1],
        day=parts[2],
        month=parts[3],
        day_of_week=parts[4],
    )
    job_id = f"sched_{task_public_id}"

    # Remove existing job if any
    try:
        _scheduler.remove_job(job_id)
    except JobLookupError:
        pass

    _scheduler.add_job(
        _run_scheduled_task,
        trigger=trigger,
        id=job_id,
        args=[task_public_id],
        replace_existing=True,
    )
    logger.info("Scheduled job %s with cron '%s'", job_id, cron_expression)


def remove_job(task_public_id: str):
    """Remove a job from the scheduler."""
    if not _scheduler:
        return
    job_id = f"sched_{task_public_id}"
    try:
        _scheduler.remove_job(job_id)
        logger.info("Removed scheduled job %s", job_id)
    except JobLookupError:
        pass


def update_job(task_public_id: str, cron_expression: str, enabled: bool):
    """Update or remove a job based on enabled state."""
    if enabled:
        _add_job(task_public_id, cron_expression)
    else:
        remove_job(task_public_id)


async def _run_scheduled_task(task_public_id: str):
    """Execute a scheduled task — runs the agent and saves results."""
    logger.info("Running scheduled task %s", task_public_id)
    settings = get_settings()

    async with get_session_factory()() as db:
        from sqlalchemy import select
        from app.models.scheduled_task import ScheduledTask
        from app.models.chat import Chat, Message
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
                result = await db.execute(select(Chat).where(Chat.id == task.chat_id))
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
                                "chat_id": chat.public_id
                                if hasattr(chat, "public_id")
                                else str(chat.id),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            },
                        )
                except Exception as e:
                    logger.warning("Webhook failed for task %s: %s", task_public_id, e)

            # Update task status
            task.last_run_at = datetime.now(timezone.utc)
            task.last_status = "success"
            task.last_error = None
            await db.commit()
            logger.info("Scheduled task %s completed successfully", task_public_id)

        except Exception as e:
            logger.error("Scheduled task %s failed: %s", task_public_id, e)
            task.last_run_at = datetime.now(timezone.utc)
            task.last_status = "error"
            task.last_error = str(e)
            await db.commit()
