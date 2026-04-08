from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings

_state = {"engine": None, "session_factory": None}


def init_engine(settings: Settings):
    _state["engine"] = create_async_engine(settings.database_url, echo=False)
    _state["session_factory"] = async_sessionmaker(
        _state["engine"], class_=AsyncSession, expire_on_commit=False
    )


def get_engine():
    return _state["engine"]


def get_session_factory():
    return _state["session_factory"]


async def dispose_engine():
    if _state["engine"]:
        await _state["engine"].dispose()
