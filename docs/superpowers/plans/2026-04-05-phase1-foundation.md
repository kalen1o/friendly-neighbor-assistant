# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the backend foundation — FastAPI app, async database connection, Alembic migrations, and a dual-provider LLM abstraction (Anthropic + OpenAI) — so all future features snap into a working infrastructure.

**Architecture:** FastAPI app with async SQLAlchemy (asyncpg) talking to PostgreSQL 16 + pgvector. Configuration loaded from `.env` via pydantic-settings. LLM provider abstraction supports both Anthropic Claude and OpenAI GPT, switchable via `AI_PROVIDER` env var. All services run in Docker Compose.

**Tech Stack:** FastAPI 0.128+, SQLAlchemy 2.0+ (async), asyncpg, Alembic 1.14+, PostgreSQL 16 + pgvector, Anthropic SDK, OpenAI SDK, pydantic-settings

---

## File Structure

```
backend/
├── app/
│   ├── __init__.py           # Empty — marks package
│   ├── config.py             # Pydantic Settings, loads .env
│   ├── main.py               # FastAPI app, lifespan, CORS, health route
│   ├── db/
│   │   ├── __init__.py       # Empty
│   │   ├── base.py           # DeclarativeBase for all models
│   │   ├── engine.py         # Async engine + session factory
│   │   └── session.py        # get_db FastAPI dependency
│   └── llm/
│       ├── __init__.py       # Empty
│       └── provider.py       # get_llm_response + stream_llm_response
├── alembic.ini               # Alembic config pointing to DATABASE_URL
├── alembic/
│   ├── env.py                # Async Alembic env
│   ├── script.py.mako        # Migration template
│   └── versions/             # Migration files
├── tests/
│   ├── __init__.py
│   ├── conftest.py           # Shared fixtures (settings, db session, client)
│   ├── test_health.py        # Health endpoint test
│   ├── test_config.py        # Config loading test
│   └── test_llm_provider.py  # LLM provider tests
├── requirements.txt          # Already exists — will add pydantic-settings, anthropic, openai, httpx, pytest
└── Dockerfile                # Already exists
```

---

### Task 1: Add missing dependencies to requirements.txt

**Files:**
- Modify: `backend/requirements.txt`

Phase 1 uses direct Anthropic/OpenAI SDK calls (not Pydantic AI yet). We need `pydantic-settings` for config, the SDKs directly, `httpx` for test client, `pytest` + `pytest-asyncio` for testing, and `sse-starlette` for streaming (Phase 2 will use it, install now).

- [ ] **Step 1: Update requirements.txt**

Add these lines to `backend/requirements.txt`:

```python
# Config
pydantic-settings>=2.0.0

# LLM SDKs (direct calls in Phase 1, Pydantic AI takes over in Phase 4)
anthropic>=0.40.0
openai>=1.50.0

# SSE streaming
sse-starlette>=2.0.0

# Testing
pytest>=8.0.0
anyio[trio]>=4.0.0
pytest-asyncio>=0.24.0
httpx>=0.27.0
```

Also create `backend/pyproject.toml` for pytest config:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add pydantic-settings, anthropic, openai, test deps to requirements"
```

---

### Task 2: Create config module

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Test: `backend/tests/__init__.py`
- Test: `backend/tests/test_config.py`

- [ ] **Step 1: Create package init files**

Create `backend/app/__init__.py` (empty file):

```python
```

Create `backend/tests/__init__.py` (empty file):

```python
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_config.py`:

```python
import os

import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")

    from app.config import Settings

    settings = Settings()
    assert settings.ai_provider == "openai"
    assert settings.anthropic_api_key == "sk-ant-test"
    assert settings.openai_api_key == "sk-test"
    assert settings.database_url == "postgresql+asyncpg://user:pass@localhost/testdb"
    assert settings.embedding_model == "text-embedding-3-small"


def test_settings_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    from app.config import Settings

    settings = Settings()
    assert settings.ai_provider == "anthropic"
    assert settings.embedding_model == "text-embedding-3-small"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_config.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.config'`

- [ ] **Step 4: Write the implementation**

Create `backend/app/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_provider: str = "anthropic"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    database_url: str
    embedding_model: str = "text-embedding-3-small"


def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_config.py -v`

Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/__init__.py backend/app/config.py backend/tests/__init__.py backend/tests/test_config.py
git commit -m "feat: add config module with pydantic-settings"
```

---

### Task 3: Create database engine and session

**Files:**
- Create: `backend/app/db/__init__.py`
- Create: `backend/app/db/base.py`
- Create: `backend/app/db/engine.py`
- Create: `backend/app/db/session.py`

No unit tests for this task — the DB engine/session are integration-level (tested via health check in Task 4). These are thin wrappers around SQLAlchemy with no business logic.

- [ ] **Step 1: Create the DeclarativeBase**

Create `backend/app/db/__init__.py` (empty file):

```python
```

Create `backend/app/db/base.py`:

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

- [ ] **Step 2: Create the async engine and session factory**

Create `backend/app/db/engine.py`:

```python
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
```

- [ ] **Step 3: Create the FastAPI dependency**

Create `backend/app/db/session.py`:

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import async_session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/
git commit -m "feat: add async database engine, session factory, and DeclarativeBase"
```

---

### Task 4: Create FastAPI app with lifespan and health check

**Files:**
- Create: `backend/app/main.py`
- Test: `backend/tests/conftest.py`
- Test: `backend/tests/test_health.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/conftest.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

Create `backend/tests/test_health.py`:

```python
import pytest


@pytest.mark.anyio
async def test_health_check(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_health.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.engine import dispose_engine, init_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_engine(settings)
    yield
    await dispose_engine()


app = FastAPI(title="Friendly Neighbor", lifespan=lifespan)

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_health.py -v`

Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/conftest.py backend/tests/test_health.py
git commit -m "feat: add FastAPI app with lifespan, CORS, and health check endpoint"
```

---

### Task 5: Initialize Alembic for async migrations

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Create: `backend/alembic/versions/` (empty dir)

This task requires the Docker containers running. All commands run inside the backend container.

- [ ] **Step 1: Create alembic.ini**

Create `backend/alembic.ini`:

```ini
[alembic]
script_location = alembic
prepend_sys_path = .

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

Note: `sqlalchemy.url` is intentionally omitted — `env.py` reads it from `app.config`.

- [ ] **Step 2: Create the migration template**

Create `backend/alembic/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 3: Create async env.py**

Create `backend/alembic/env.py`:

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    settings = get_settings()
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    settings = get_settings()
    connectable = create_async_engine(settings.database_url)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 4: Create empty versions directory**

Run: `mkdir -p /Users/kalen_1o/startup/friendly-neighbor-assistant/backend/alembic/versions`

Create `backend/alembic/versions/.gitkeep` (empty file to track the directory in git).

- [ ] **Step 5: Verify Alembic works inside Docker**

Start the containers and test:

```bash
cd /Users/kalen_1o/startup/friendly-neighbor-assistant
make build
make up
# Wait a few seconds for DB to be ready
docker compose exec backend alembic current
```

Expected: No errors. Output shows no current revision (empty DB).

Then create and run an initial empty migration to verify the full pipeline:

```bash
docker compose exec backend alembic revision --autogenerate -m "initial empty"
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
```

Expected: Shows the revision ID as head.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic.ini backend/alembic/
git commit -m "feat: initialize Alembic with async PostgreSQL support"
```

---

### Task 6: Create LLM provider with Anthropic + OpenAI support

**Files:**
- Create: `backend/app/llm/__init__.py`
- Create: `backend/app/llm/provider.py`
- Test: `backend/tests/test_llm_provider.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_llm_provider.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from app.config import Settings


def _make_settings(provider: str = "anthropic") -> Settings:
    return Settings(
        ai_provider=provider,
        anthropic_api_key="sk-ant-test",
        openai_api_key="sk-test",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


@pytest.mark.anyio
async def test_get_llm_response_anthropic():
    settings = _make_settings("anthropic")
    messages = [{"role": "user", "content": "Hello"}]

    mock_response = AsyncMock()
    mock_response.content = [AsyncMock(text="Hi there!")]

    with patch("app.llm.provider.anthropic.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi there!"
        instance.messages.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_openai():
    settings = _make_settings("openai")
    messages = [{"role": "user", "content": "Hello"}]

    mock_choice = AsyncMock()
    mock_choice.message.content = "Hi from GPT!"
    mock_response = AsyncMock()
    mock_response.choices = [mock_choice]

    with patch("app.llm.provider.openai.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi from GPT!"
        instance.chat.completions.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_invalid_provider():
    settings = _make_settings("gemini")
    messages = [{"role": "user", "content": "Hello"}]

    from app.llm.provider import get_llm_response

    with pytest.raises(ValueError, match="Unsupported AI provider: gemini"):
        await get_llm_response(messages, settings)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_llm_provider.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/llm/__init__.py` (empty file):

```python
```

Create `backend/app/llm/provider.py`:

```python
from collections.abc import AsyncIterator

import anthropic
import openai

from app.config import Settings

SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely."
)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
OPENAI_MODEL = "gpt-4o"


async def get_llm_response(messages: list[dict], settings: Settings) -> str:
    if settings.ai_provider == "anthropic":
        return await _anthropic_response(messages, settings)
    elif settings.ai_provider == "openai":
        return await _openai_response(messages, settings)
    else:
        raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")


async def stream_llm_response(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    if settings.ai_provider == "anthropic":
        async for chunk in _anthropic_stream(messages, settings):
            yield chunk
    elif settings.ai_provider == "openai":
        async for chunk in _openai_stream(messages, settings):
            yield chunk
    else:
        raise ValueError(f"Unsupported AI provider: {settings.ai_provider}")


async def _anthropic_response(messages: list[dict], settings: Settings) -> str:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


async def _openai_response(messages: list[dict], settings: Settings) -> str:
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=full_messages,
    )
    return response.choices[0].message.content


async def _anthropic_stream(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    async with client.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def _openai_stream(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    stream = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=full_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/backend && python -m pytest tests/test_llm_provider.py -v`

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/ backend/tests/test_llm_provider.py
git commit -m "feat: add dual LLM provider supporting Anthropic Claude and OpenAI GPT"
```

---

### Task 7: Add a test LLM endpoint and verify full Docker stack

**Files:**
- Modify: `backend/app/main.py`

This adds a temporary `/api/llm/test` endpoint so you can verify the LLM provider works via Swagger (`/docs`). This endpoint will be removed when the chat endpoint is built in Phase 2.

- [ ] **Step 1: Add the test endpoint to main.py**

Add these imports and endpoint to `backend/app/main.py`, after the health check:

```python
from fastapi import FastAPI, Query
from app.config import get_settings
from app.llm.provider import get_llm_response


@app.get("/api/llm/test")
async def test_llm(message: str = Query(description="Message to send to the LLM")):
    """Temporary endpoint to test LLM provider. Remove in Phase 2."""
    settings = get_settings()
    messages = [{"role": "user", "content": message}]
    response = await get_llm_response(messages, settings)
    return {"provider": settings.ai_provider, "response": response}
```

- [ ] **Step 2: Rebuild and start Docker**

```bash
cd /Users/kalen_1o/startup/friendly-neighbor-assistant
make build
make up
```

Wait for containers to start, then check logs:

```bash
make logs-backend
```

Expected: Uvicorn shows `Application startup complete`

- [ ] **Step 3: Verify health check**

```bash
curl http://localhost:8000/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Verify LLM endpoint via Swagger**

Open `http://localhost:8000/docs` in a browser. Find the `/api/llm/test` endpoint. Try it with message: `"What is 2+2?"`

Expected: JSON response with `provider` and `response` fields. The response should contain "4".

- [ ] **Step 5: Verify Alembic migration runs**

```bash
make migrate
```

Expected: Alembic runs upgrade to head (may show "No new migrations" if already at head from Task 5).

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add temporary LLM test endpoint for verification"
```

---

## Phase 1 Checkpoint

At this point, you should have:

- [x] FastAPI app running in Docker at `http://localhost:8000`
- [x] Health check: `GET /api/health` → `{"status": "ok"}`
- [x] PostgreSQL + pgvector running, connected via async SQLAlchemy
- [x] Alembic migrations initialized and working
- [x] LLM provider returning responses from Anthropic or OpenAI (configurable via `.env`)
- [x] All tests passing: `make test`
- [x] API docs at `http://localhost:8000/docs`

**Next:** Phase 2 plan (Basic Chat — Backend + Frontend)
