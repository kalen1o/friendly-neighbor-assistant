from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.cache.redis import close_redis, init_redis
from app.config import get_settings
from app.db.engine import dispose_engine, init_engine
from app.logging_config import setup_logging
from app.middleware.error_handler import register_error_handlers
from app.middleware.request_logging import RequestLoggingMiddleware
from app.routers.auth import router as auth_router
from app.routers.chats import router as chats_router
from app.routers.documents import router as documents_router
from app.routers.hooks import router as hooks_router
from app.routers.mcp import router as mcp_router
from app.routers.sharing import router as sharing_router
from app.routers.analytics import router as analytics_router
from app.routers.artifacts import router as artifacts_router
from app.routers.export import router as export_router

from app.routers.folders import router as folders_router
from app.routers.admin import router as admin_router
from app.routers.webhooks import router as webhooks_router
from app.routers.models import router as models_router
from app.routers.skills import router as skills_router
from app.routers.uploads import router as uploads_router
from app.routers.schedules import router as schedules_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(level=settings.log_level, environment=settings.environment)
    import os

    os.makedirs(settings.upload_dir, exist_ok=True)
    init_engine(settings)
    await init_redis(settings)
    # Clean up messages stuck in 'generating' status (e.g. from server restart)
    from app.db.session import get_session_factory
    from app.models.chat import Message
    from sqlalchemy import update
    from datetime import datetime, timedelta, timezone

    try:
        async with get_session_factory()() as db:
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
            result = await db.execute(
                update(Message)
                .where(Message.status == "generating", Message.created_at < cutoff)
                .values(
                    status="error",
                    content=Message.content + "\n\n[Response interrupted]",
                )
            )
            if result.rowcount > 0:
                await db.commit()
                import logging

                logging.getLogger(__name__).info(
                    f"Cleaned up {result.rowcount} stuck generating message(s)"
                )
    except Exception:
        pass  # Don't block startup

    # Start scheduled agents
    from app.scheduler.engine import start_scheduler, stop_scheduler
    try:
        await start_scheduler()
    except Exception:
        pass  # Don't block startup if scheduler fails

    yield

    # Stop scheduler before closing connections
    try:
        await stop_scheduler()
    except Exception:
        pass
    await close_redis()
    await dispose_engine()


app = FastAPI(title="Friendly Neighbor", lifespan=lifespan)

register_error_handlers(app)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(chats_router)
app.include_router(documents_router)
app.include_router(skills_router)
app.include_router(hooks_router)
app.include_router(mcp_router)
app.include_router(sharing_router)
app.include_router(artifacts_router)
app.include_router(export_router)
app.include_router(analytics_router)
app.include_router(folders_router)
app.include_router(uploads_router)
app.include_router(models_router)
app.include_router(admin_router)
app.include_router(webhooks_router)
app.include_router(schedules_router)
