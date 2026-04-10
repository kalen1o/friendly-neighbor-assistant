import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture(params=["asyncio"])
def anyio_backend(request):
    """Restrict anyio tests to asyncio only (skip trio)."""
    return request.param

from app.auth.jwt import create_access_token
from app.auth.password import hash_password
from app.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models.user import User  # noqa: F401
from app.models.refresh_token import RefreshToken  # noqa: F401
from app.models.shared_chat import SharedChat  # noqa: F401
from app.models.artifact import Artifact  # noqa: F401
from app.models.chat_file import ChatFile  # noqa: F401

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_test_settings = Settings(
    database_url=TEST_DATABASE_URL,
    jwt_secret="test-secret",
    redis_url="redis://localhost:6379/0",
)


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db(db_engine):
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_factory() as session:
            yield session

    def override_get_settings():
        return _test_settings

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = override_get_settings

    # Create a test user and get an access token
    async with session_factory() as session:
        user = User(
            email="test@example.com",
            password_hash=hash_password("Test1234"),
            name="Test User",
            public_id="user-test0001",
        )
        session.add(user)
        await session.commit()

    token = create_access_token("user-test0001", _test_settings)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"access_token": token},
    ) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture
async def anon_client(db_engine):
    """Unauthenticated client for testing auth endpoints."""
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_factory() as session:
            yield session

    def override_get_settings():
        return _test_settings

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = override_get_settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
