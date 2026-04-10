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
from app.routers.artifacts import router as artifacts_router
from app.routers.skills import router as skills_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(level=settings.log_level, environment=settings.environment)
    init_engine(settings)
    await init_redis(settings)
    yield
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
