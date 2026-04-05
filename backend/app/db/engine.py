from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings

engine = None
async_session_factory = None


def init_engine(settings: Settings):
    global engine, async_session_factory
    engine = create_async_engine(settings.database_url, echo=False)
    async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def dispose_engine():
    global engine
    if engine:
        await engine.dispose()
