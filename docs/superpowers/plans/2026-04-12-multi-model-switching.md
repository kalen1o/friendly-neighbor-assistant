# Multi-Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add custom LLM models with their own API keys, set a personal default, and override the model per-chat — with three-level fallback: per-chat → user default → project default.

**Architecture:** New `user_models` table stores user-configured models with Fernet-encrypted API keys. A `ModelConfig` dataclass abstracts provider details so `provider.py` can accept any model config. Chat table gains `model_id` FK. Frontend adds a Models tab in Settings and a model picker next to the chat input.

**Tech Stack:** SQLAlchemy + Alembic, Fernet encryption (`cryptography`), FastAPI router, Pydantic schemas, React components with shadcn/ui

---

## File Structure

### Backend (new files)
- `backend/app/models/user_model.py` — UserModel SQLAlchemy model
- `backend/app/schemas/user_model.py` — Pydantic request/response schemas
- `backend/app/routers/models.py` — Model CRUD + test endpoints
- `backend/app/llm/encryption.py` — Fernet encrypt/decrypt helpers
- `backend/app/llm/model_config.py` — ModelConfig dataclass + resolution logic
- `backend/alembic/versions/0023_create_user_models_table.py` — Migration

### Backend (modified files)
- `backend/app/models/chat.py` — Add `model_id` FK
- `backend/app/schemas/chat.py` — Add `model_id` to ChatSummary, ChatUpdate
- `backend/app/routers/chats.py` — Resolve model config at send_message time
- `backend/app/llm/provider.py` — Accept optional `ModelConfig` in all LLM functions
- `backend/app/config.py` — Add `encryption_key` setting
- `backend/app/main.py` — Register models router

### Frontend (new files)
- `frontend/src/components/model-settings.tsx` — Models tab content for settings dialog
- `frontend/src/components/model-picker.tsx` — Chat input model selector dropdown

### Frontend (modified files)
- `frontend/src/lib/api.ts` — Add model types + CRUD functions, update chat types
- `frontend/src/components/settings-dialog.tsx` — Add Models tab
- `frontend/src/components/chat-input.tsx` — Integrate model picker

---

### Task 1: Database Migration

**Files:**
- Create: `backend/alembic/versions/0023_create_user_models_table.py`

- [ ] **Step 1: Create migration file**

```python
"""create user_models table and add model_id to chats

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_models",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model_id", sa.String(100), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("base_url", sa.String(500), nullable=True),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.add_column(
        "chats",
        sa.Column(
            "user_model_id",
            sa.Integer(),
            sa.ForeignKey("user_models.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("chats", "user_model_id")
    op.drop_table("user_models")
```

- [ ] **Step 2: Commit**

```bash
git add backend/alembic/versions/0023_create_user_models_table.py
git commit -m "feat: add user_models migration (0023)"
```

---

### Task 2: Encryption Helpers

**Files:**
- Create: `backend/app/llm/encryption.py`
- Modify: `backend/app/config.py`

- [ ] **Step 1: Add encryption_key to config**

In `backend/app/config.py`, add to the `Settings` class after the `log_level` field:

```python
    # Encryption for user API keys
    encryption_key: str = ""  # Fernet key; if empty, custom models disabled
```

- [ ] **Step 2: Create encryption module**

Create `backend/app/llm/encryption.py`:

```python
from cryptography.fernet import Fernet, InvalidToken


def encrypt_api_key(key: str, encryption_key: str) -> str:
    """Encrypt an API key using Fernet symmetric encryption."""
    f = Fernet(encryption_key.encode())
    return f.encrypt(key.encode()).decode()


def decrypt_api_key(encrypted: str, encryption_key: str) -> str:
    """Decrypt an API key. Raises ValueError if decryption fails."""
    try:
        f = Fernet(encryption_key.encode())
        return f.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception) as e:
        raise ValueError(f"Failed to decrypt API key: {e}")
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/llm/encryption.py backend/app/config.py
git commit -m "feat: add Fernet encryption for API keys"
```

---

### Task 3: UserModel + ModelConfig

**Files:**
- Create: `backend/app/models/user_model.py`
- Create: `backend/app/llm/model_config.py`
- Modify: `backend/app/models/chat.py`

- [ ] **Step 1: Create UserModel**

Create `backend/app/models/user_model.py`:

```python
from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class UserModel(Base):
    __tablename__ = "user_models"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(22), unique=True, default=partial(generate_public_id, "umod")
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[Optional[str]] = mapped_column(String(500), default=None)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

- [ ] **Step 2: Create ModelConfig dataclass**

Create `backend/app/llm/model_config.py`:

```python
from dataclasses import dataclass
from typing import Optional

from app.config import Settings
from app.llm.encryption import decrypt_api_key


@dataclass
class ModelConfig:
    """Everything needed to make an LLM call to a specific model."""
    provider: str       # "anthropic", "openai", "openai_compatible"
    model_id: str       # e.g. "gpt-4o", "claude-sonnet-4-20250514"
    api_key: str        # decrypted key
    base_url: Optional[str] = None  # custom endpoint


def resolve_model_config(
    user_model=None,
    settings: Settings = None,
    encryption_key: str = "",
) -> Optional[ModelConfig]:
    """Build a ModelConfig from a UserModel (decrypting the key).

    Returns None if no user_model is provided (caller should use project default).
    """
    if user_model is None:
        return None

    api_key = decrypt_api_key(user_model.api_key_encrypted, encryption_key)

    # openai_compatible uses the openai client with a custom base_url
    provider = user_model.provider
    base_url = user_model.base_url

    return ModelConfig(
        provider=provider,
        model_id=user_model.model_id,
        api_key=api_key,
        base_url=base_url,
    )
```

- [ ] **Step 3: Add user_model_id to Chat model**

In `backend/app/models/chat.py`, add after the `folder_id` field:

```python
    user_model_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("user_models.id", ondelete="SET NULL"), default=None, nullable=True
    )
```

Add to imports (inside `TYPE_CHECKING`):

```python
    from app.models.user_model import UserModel
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/user_model.py backend/app/llm/model_config.py backend/app/models/chat.py
git commit -m "feat: add UserModel, ModelConfig, and chat.user_model_id"
```

---

### Task 4: Model Schemas

**Files:**
- Create: `backend/app/schemas/user_model.py`
- Modify: `backend/app/schemas/chat.py`

- [ ] **Step 1: Create model schemas**

Create `backend/app/schemas/user_model.py`:

```python
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ModelCreate(BaseModel):
    name: str = Field(max_length=100)
    provider: str = Field(pattern="^(openai|anthropic|openai_compatible)$")
    model_id: str = Field(max_length=100)
    api_key: str
    base_url: Optional[str] = Field(None, max_length=500)


class ModelUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    model_id: Optional[str] = Field(None, max_length=100)
    api_key: Optional[str] = None
    base_url: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None


class ModelOut(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    base_url: Optional[str]
    is_default: bool
    builtin: bool
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ModelTestResult(BaseModel):
    success: bool
    message: str
```

- [ ] **Step 2: Update chat schemas**

In `backend/app/schemas/chat.py`, update `ChatSummary` to add `model_id`:

```python
class ChatSummary(BaseModel):
    id: str = Field(validation_alias="public_id")
    title: Optional[str]
    updated_at: datetime
    folder_id: Optional[str] = None
    model_id: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}
```

Update `ChatUpdate` to add `model_id`:

```python
class ChatUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None
    model_id: Optional[str] = None  # public_id, "project-default", or null to reset
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/user_model.py backend/app/schemas/chat.py
git commit -m "feat: add model schemas, update chat schemas"
```

---

### Task 5: Provider Refactor

**Files:**
- Modify: `backend/app/llm/provider.py`

- [ ] **Step 1: Update all LLM functions to accept optional ModelConfig**

The key change: every function that creates an API client or references a model name gains an optional `model_config: ModelConfig | None = None` parameter. When provided, it overrides the global settings.

In `backend/app/llm/provider.py`, add import at top:

```python
from app.llm.model_config import ModelConfig
```

Update `get_llm_response`:

```python
async def get_llm_response(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> str:
    provider = model_config.provider if model_config else settings.ai_provider
    if provider in ("openai", "openai_compatible"):
        return await _openai_response(messages, settings, model_config)
    elif provider == "anthropic":
        return await _anthropic_response(messages, settings, model_config)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")
```

Update `stream_llm_response`:

```python
async def stream_llm_response(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> AsyncIterator[str]:
    provider = model_config.provider if model_config else settings.ai_provider
    if provider in ("openai", "openai_compatible"):
        async for chunk in _openai_stream(messages, settings, model_config):
            yield chunk
    elif provider == "anthropic":
        async for chunk in _anthropic_stream(messages, settings, model_config):
            yield chunk
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")
```

Update `_anthropic_response` to use model_config when available:

```python
@_llm_retry
async def _anthropic_response(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> str:
    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text
```

Update `_build_openai_client` to accept model_config:

```python
def _build_openai_client(
    settings: Settings, model_config: ModelConfig | None = None
) -> openai.AsyncOpenAI:
    if model_config:
        kwargs: dict = {"api_key": model_config.api_key, "timeout": 120.0}
        if model_config.base_url:
            kwargs["base_url"] = model_config.base_url
        return openai.AsyncOpenAI(**kwargs)
    kwargs = {"api_key": settings.openai_api_key, "timeout": 120.0}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return openai.AsyncOpenAI(**kwargs)
```

Update `_openai_response`:

```python
@_llm_retry
async def _openai_response(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> str:
    client = _build_openai_client(settings, model_config)
    model = model_config.model_id if model_config else settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    response = await client.chat.completions.create(
        model=model,
        messages=full_messages,
    )
    return response.choices[0].message.content
```

Update `_anthropic_stream`:

```python
async def _anthropic_stream(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> AsyncIterator[str]:
    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = anthropic.AsyncAnthropic(api_key=api_key)
    converted = _convert_to_anthropic_format(messages)
    async with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=converted,
    ) as stream:
        async for text in stream.text_stream:
            yield text
```

Update `_anthropic_stream_with_tools` — add `model_config` parameter and use it for client/model:

```python
async def _anthropic_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    model_config: ModelConfig | None = None,
) -> AsyncIterator[str]:
    api_key = model_config.api_key if model_config else settings.anthropic_api_key
    model = model_config.model_id if model_config else ANTHROPIC_MODEL
    client = anthropic.AsyncAnthropic(api_key=api_key)
    # ... rest stays the same but uses `model` variable instead of ANTHROPIC_MODEL
```

Update `_openai_stream`:

```python
async def _openai_stream(
    messages: list[dict], settings: Settings, model_config: ModelConfig | None = None
) -> AsyncIterator[str]:
    client = _build_openai_client(settings, model_config)
    model = model_config.model_id if model_config else settings.openai_model
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

Update `_openai_stream_with_tools` — add `model_config` parameter:

```python
async def _openai_stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = 5,
    vision: bool = False,
    model_config: ModelConfig | None = None,
) -> AsyncIterator[str]:
    client = (
        _build_vision_client(settings)
        if vision and not model_config
        else _build_openai_client(settings, model_config)
    )
    model = model_config.model_id if model_config else (
        (settings.vision_model or settings.openai_model) if vision else settings.openai_model
    )
    # ... rest stays same but uses `model` variable
```

Update `stream_with_tools` to pass through `model_config`:

```python
async def stream_with_tools(
    messages: list,
    settings: Settings,
    tools: list = None,
    tool_executor=None,
    on_tool_call=None,
    max_tool_rounds: int = None,
    vision: bool = False,
    model_config: ModelConfig | None = None,
) -> AsyncIterator[str]:
    rounds = max_tool_rounds or settings.max_tool_rounds
    provider = model_config.provider if model_config else settings.ai_provider
    if provider in ("openai", "openai_compatible"):
        raw = _openai_stream_with_tools(
            messages, settings, tools, tool_executor, on_tool_call, rounds,
            vision=vision, model_config=model_config,
        )
    elif provider == "anthropic":
        if tools and not vision:
            raw = _anthropic_stream_with_tools(
                messages, settings, tools, tool_executor, on_tool_call, rounds,
                model_config=model_config,
            )
        else:
            raw = _anthropic_stream(messages, settings, model_config)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")

    async for chunk in _buffered_stream(raw):
        yield chunk
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/llm/provider.py
git commit -m "refactor: provider accepts optional ModelConfig override"
```

---

### Task 6: Models Router

**Files:**
- Create: `backend/app/routers/models.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the models router**

Create `backend/app/routers/models.py`:

```python
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.llm.encryption import decrypt_api_key, encrypt_api_key
from app.llm.model_config import ModelConfig
from app.models.user import User
from app.models.user_model import UserModel
from app.schemas.user_model import ModelCreate, ModelOut, ModelUpdate, ModelTestResult

router = APIRouter(prefix="/api/models", tags=["models"])


def _require_encryption(settings: Settings) -> str:
    if not settings.encryption_key:
        raise HTTPException(
            status_code=403,
            detail="Encryption not configured. Set ENCRYPTION_KEY to enable custom models.",
        )
    return settings.encryption_key


def _model_to_out(m: UserModel) -> ModelOut:
    return ModelOut(
        id=m.public_id,
        name=m.name,
        provider=m.provider,
        model_id=m.model_id,
        base_url=m.base_url,
        is_default=m.is_default,
        builtin=False,
        created_at=m.created_at,
    )


def _project_default(settings: Settings) -> ModelOut:
    return ModelOut(
        id="project-default",
        name="Project Default",
        provider=settings.ai_provider,
        model_id=settings.openai_model
        if settings.ai_provider in ("openai", "openai_compatible")
        else "claude-sonnet-4-20250514",
        base_url=settings.openai_base_url or None,
        is_default=False,
        builtin=True,
        created_at=None,
    )


async def _test_model_connection(config: ModelConfig) -> ModelTestResult:
    """Make a minimal API call to verify the model works."""
    import anthropic
    import openai

    try:
        if config.provider == "anthropic":
            client = anthropic.AsyncAnthropic(api_key=config.api_key)
            await client.messages.create(
                model=config.model_id,
                max_tokens=1,
                messages=[{"role": "user", "content": "Hi"}],
            )
        else:
            kwargs = {"api_key": config.api_key, "timeout": 30.0}
            if config.base_url:
                kwargs["base_url"] = config.base_url
            client = openai.AsyncOpenAI(**kwargs)
            await client.chat.completions.create(
                model=config.model_id,
                max_tokens=1,
                messages=[{"role": "user", "content": "Hi"}],
            )
        return ModelTestResult(success=True, message="Connection successful")
    except Exception as e:
        return ModelTestResult(success=False, message=str(e)[:200])


@router.get("", response_model=List[ModelOut])
async def list_models(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    models = [_project_default(settings)]

    if settings.encryption_key:
        result = await db.execute(
            select(UserModel)
            .where(UserModel.user_id == user.id)
            .order_by(UserModel.created_at)
        )
        for m in result.scalars().all():
            models.append(_model_to_out(m))

    return models


@router.post("", status_code=201, response_model=ModelOut)
async def create_model(
    body: ModelCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)

    if body.provider == "openai_compatible" and not body.base_url:
        raise HTTPException(
            status_code=400,
            detail="base_url is required for openai_compatible provider",
        )

    # Test the API key before saving
    config = ModelConfig(
        provider=body.provider,
        model_id=body.model_id,
        api_key=body.api_key,
        base_url=body.base_url,
    )
    test_result = await _test_model_connection(config)
    if not test_result.success:
        raise HTTPException(
            status_code=400,
            detail=f"API key validation failed: {test_result.message}",
        )

    model = UserModel(
        user_id=user.id,
        name=body.name,
        provider=body.provider,
        model_id=body.model_id,
        api_key_encrypted=encrypt_api_key(body.api_key, enc_key),
        base_url=body.base_url,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


@router.patch("/{model_id}", response_model=ModelOut)
async def update_model(
    model_id: str,
    body: ModelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)

    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    if body.name is not None:
        model.name = body.name
    if body.model_id is not None:
        model.model_id = body.model_id
    if body.base_url is not None:
        model.base_url = body.base_url
    if body.api_key is not None:
        # Re-validate with test call
        config = ModelConfig(
            provider=model.provider,
            model_id=body.model_id or model.model_id,
            api_key=body.api_key,
            base_url=body.base_url or model.base_url,
        )
        test_result = await _test_model_connection(config)
        if not test_result.success:
            raise HTTPException(
                status_code=400,
                detail=f"API key validation failed: {test_result.message}",
            )
        model.api_key_encrypted = encrypt_api_key(body.api_key, enc_key)

    if body.is_default is True:
        # Clear other defaults for this user
        others = await db.execute(
            select(UserModel).where(
                UserModel.user_id == user.id,
                UserModel.id != model.id,
                UserModel.is_default == True,  # noqa: E712
            )
        )
        for other in others.scalars().all():
            other.is_default = False
        model.is_default = True
    elif body.is_default is False:
        model.is_default = False

    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _require_encryption(settings)

    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    await db.delete(model)
    await db.commit()


@router.post("/{model_id}/test", response_model=ModelTestResult)
async def test_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)

    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    api_key = decrypt_api_key(model.api_key_encrypted, enc_key)
    config = ModelConfig(
        provider=model.provider,
        model_id=model.model_id,
        api_key=api_key,
        base_url=model.base_url,
    )
    return await _test_model_connection(config)
```

- [ ] **Step 2: Register router in main.py**

In `backend/app/main.py`, add:

```python
from app.routers.models import router as models_router
```

And:

```python
app.include_router(models_router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/models.py backend/app/main.py
git commit -m "feat: add models CRUD router with API key validation"
```

---

### Task 7: Update Chat Router for Model Resolution

**Files:**
- Modify: `backend/app/routers/chats.py`

- [ ] **Step 1: Add model resolution to send_message**

In `backend/app/routers/chats.py`, add imports:

```python
from app.models.user_model import UserModel
from app.llm.model_config import ModelConfig, resolve_model_config
```

At the start of `send_message()` event_generator (after loading the chat and before hook execution), add model resolution:

```python
        # Resolve which model to use: per-chat > user default > project default
        resolved_model_config = None
        if settings.encryption_key:
            # Check per-chat model
            if chat.user_model_id:
                um_result = await db.execute(
                    select(UserModel).where(UserModel.id == chat.user_model_id)
                )
                user_model = um_result.scalar_one_or_none()
                if user_model:
                    resolved_model_config = resolve_model_config(
                        user_model, settings, settings.encryption_key
                    )

            # Fall back to user default
            if resolved_model_config is None:
                default_result = await db.execute(
                    select(UserModel).where(
                        UserModel.user_id == user.id,
                        UserModel.is_default == True,  # noqa: E712
                    )
                )
                default_model = default_result.scalar_one_or_none()
                if default_model:
                    resolved_model_config = resolve_model_config(
                        default_model, settings, settings.encryption_key
                    )
```

Then pass `model_config=resolved_model_config` to the `stream_with_tools` call:

```python
            async for chunk in stream_with_tools(
                llm_messages,
                settings,
                tools=tool_defs if tool_defs and not has_vision else None,
                tool_executor=tool_executor if not has_vision else None,
                on_tool_call=on_tool_call_track,
                max_tool_rounds=tool_rounds,
                vision=has_vision,
                model_config=resolved_model_config,
            ):
```

- [ ] **Step 2: Support model_id in update_chat**

In the `update_chat` endpoint, add handling for `body.model_id` (similar to `folder_id`):

```python
    if body.model_id is not None:
        if body.model_id == "project-default" or body.model_id == "":
            chat.user_model_id = None
        else:
            model_result = await db.execute(
                select(UserModel.id).where(
                    UserModel.public_id == body.model_id, UserModel.user_id == user.id
                )
            )
            mid = model_result.scalar_one_or_none()
            if mid is None:
                raise HTTPException(status_code=404, detail="Model not found")
            chat.user_model_id = mid
```

- [ ] **Step 3: Add model_id to list_chats response**

In the `list_chats` endpoint, resolve `user_model_id` to public_id similar to folder_id:

```python
    # Resolve model public IDs for the response
    model_internal_ids = {c.user_model_id for c in chats if c.user_model_id}
    model_map = {}
    if model_internal_ids:
        mres = await db.execute(
            select(UserModel.id, UserModel.public_id).where(UserModel.id.in_(model_internal_ids))
        )
        model_map = dict(mres.all())
```

And include in the chat_summaries dict:

```python
            "model_id": model_map.get(c.user_model_id) if c.user_model_id else None,
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/chats.py
git commit -m "feat: resolve model config per-chat in send_message"
```

---

### Task 8: Frontend API Types and Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add model types and CRUD functions**

Add after the folder CRUD section in `frontend/src/lib/api.ts`:

```typescript
// ── Model Types ──

export interface ModelOut {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url: string | null;
  is_default: boolean;
  builtin: boolean;
  created_at: string | null;
}

export interface ModelCreate {
  name: string;
  provider: string;
  model_id: string;
  api_key: string;
  base_url?: string | null;
}

export interface ModelUpdate {
  name?: string;
  model_id?: string;
  api_key?: string;
  base_url?: string | null;
  is_default?: boolean;
}

export interface ModelTestResult {
  success: boolean;
  message: string;
}

// ── Model CRUD ──

export async function listModels(): Promise<ModelOut[]> {
  const res = await authFetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error("Failed to list models");
  return res.json();
}

export async function createModel(model: ModelCreate): Promise<ModelOut> {
  const res = await authFetch(`${API_BASE}/api/models`, {
    method: "POST",
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create model" }));
    throw new Error(err.detail || "Failed to create model");
  }
  return res.json();
}

export async function updateModel(
  modelId: string,
  updates: ModelUpdate
): Promise<ModelOut> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update model" }));
    throw new Error(err.detail || "Failed to update model");
  }
  return res.json();
}

export async function deleteModel(modelId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete model");
}

export async function testModel(modelId: string): Promise<ModelTestResult> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}/test`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to test model");
  return res.json();
}
```

- [ ] **Step 2: Update ChatSummary to include model_id**

```typescript
export interface ChatSummary {
  id: string;
  title: string | null;
  updated_at: string;
  folder_id: string | null;
  model_id: string | null;
}
```

- [ ] **Step 3: Update updateChat to support model_id**

The `updateChat` function already uses a dynamic body object. Add model_id support:

```typescript
export async function updateChat(
  chatId: string,
  title?: string,
  folderId?: string | null,
  modelId?: string | null
): Promise<ChatDetail> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (folderId !== undefined) body.folder_id = folderId === null ? "none" : folderId;
  if (modelId !== undefined) body.model_id = modelId === null ? "" : modelId;
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add model API types and functions"
```

---

### Task 9: Model Settings Component

**Files:**
- Create: `frontend/src/components/model-settings.tsx`
- Modify: `frontend/src/components/settings-dialog.tsx`

- [ ] **Step 1: Create ModelSettings component**

Create `frontend/src/components/model-settings.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Star, StarOff, TestTube, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listModels,
  createModel,
  updateModel,
  deleteModel,
  testModel,
  type ModelOut,
} from "@/lib/api";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai_compatible", label: "OpenAI-Compatible" },
];

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🟢",
  anthropic: "🟠",
  openai_compatible: "🔵",
};

export function ModelSettings() {
  const [models, setModels] = useState<ModelOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openai");
  const [formModelId, setFormModelId] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");

  const fetchModels = useCallback(async () => {
    try {
      const data = await listModels();
      setModels(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const resetForm = () => {
    setFormName("");
    setFormProvider("openai");
    setFormModelId("");
    setFormApiKey("");
    setFormBaseUrl("");
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formModelId.trim() || !formApiKey.trim()) {
      toast.error("Name, model ID, and API key are required");
      return;
    }
    setSaving(true);
    try {
      await createModel({
        name: formName.trim(),
        provider: formProvider,
        model_id: formModelId.trim(),
        api_key: formApiKey,
        base_url: formProvider === "openai_compatible" ? formBaseUrl.trim() || undefined : undefined,
      });
      toast.success("Model added successfully");
      resetForm();
      fetchModels();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteModel(id);
      toast.success("Model deleted");
      fetchModels();
    } catch {
      toast.error("Failed to delete model");
    }
  };

  const handleSetDefault = async (id: string, current: boolean) => {
    try {
      await updateModel(id, { is_default: !current });
      fetchModels();
    } catch {
      toast.error("Failed to update default");
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await testModel(id);
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(`Connection failed: ${result.message}`);
      }
    } catch {
      toast.error("Test failed");
    } finally {
      setTesting(null);
    }
  };

  const projectDefault = models.find((m) => m.builtin);
  const userModels = models.filter((m) => !m.builtin);

  return (
    <div>
      <h2 className="text-lg font-semibold">Models</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Add your own LLM models with API keys.
      </p>

      {/* Project default */}
      {projectDefault && (
        <div className="mb-4 rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Project Default
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span>{PROVIDER_ICONS[projectDefault.provider] || "⚪"}</span>
            <span className="font-medium">{projectDefault.model_id}</span>
            <span className="text-xs text-muted-foreground">
              ({projectDefault.provider})
            </span>
          </div>
        </div>
      )}

      {/* User models */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {userModels.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span>{PROVIDER_ICONS[m.provider] || "⚪"}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {m.is_default && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.model_id}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleSetDefault(m.id, m.is_default)}
                  title={m.is_default ? "Remove default" : "Set as default"}
                >
                  {m.is_default ? (
                    <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                  ) : (
                    <StarOff className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleTest(m.id)}
                  disabled={testing === m.id}
                  title="Test connection"
                >
                  {testing === m.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <TestTube className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive/70 hover:text-destructive"
                  onClick={() => handleDelete(m.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add model form */}
      {showForm ? (
        <div className="mt-4 space-y-3 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Display Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My GPT-4o"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Provider</Label>
              <Select value={formProvider} onValueChange={setFormProvider}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Model ID</Label>
            <Input
              value={formModelId}
              onChange={(e) => setFormModelId(e.target.value)}
              placeholder={
                formProvider === "anthropic"
                  ? "claude-sonnet-4-20250514"
                  : "gpt-4o"
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={formApiKey}
              onChange={(e) => setFormApiKey(e.target.value)}
              placeholder="sk-..."
              className="mt-1"
            />
          </div>
          {formProvider === "openai_compatible" && (
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="mt-1"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Testing & Saving...
                </>
              ) : (
                "Add Model"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          onClick={() => setShowForm(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Model
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Models tab to SettingsDialog**

In `frontend/src/components/settings-dialog.tsx`, add import:

```tsx
import { ModelSettings } from "@/components/model-settings";
```

Add a tab state and tab navigation. Replace the dialog content area with a tabbed layout. Add a `tab` state:

```tsx
const [tab, setTab] = useState<"general" | "models">("general");
```

Replace the content inside `<DialogContent>` to include tabs:

After the existing header div (theme icons), add tab buttons:

```tsx
        <div className="flex border-b">
          <button
            onClick={() => setTab("general")}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium transition-colors",
              tab === "general"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            General
          </button>
          <button
            onClick={() => setTab("models")}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium transition-colors",
              tab === "models"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Models
          </button>
        </div>
```

Wrap the existing chats/usage content in a conditional:

```tsx
        <div className="p-5">
          {tab === "general" ? (
            <>
              {/* existing Chats section and UsageSection */}
            </>
          ) : (
            <ModelSettings />
          )}
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/model-settings.tsx frontend/src/components/settings-dialog.tsx
git commit -m "feat: add Models tab to settings dialog"
```

---

### Task 10: Model Picker Component

**Files:**
- Create: `frontend/src/components/model-picker.tsx`
- Modify: `frontend/src/components/chat-input.tsx`

- [ ] **Step 1: Create ModelPicker component**

Create `frontend/src/components/model-picker.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { listModels, type ModelOut } from "@/lib/api";

const PROVIDER_ICONS: Record<string, string> = {
  openai: "🟢",
  anthropic: "🟠",
  openai_compatible: "🔵",
};

function shortName(model: ModelOut): string {
  // Show a short display name
  if (model.builtin) return "Default";
  return model.name;
}

interface ModelPickerProps {
  selectedModelId: string | null; // public_id, "project-default", or null
  onSelect: (modelId: string | null) => void;
}

export function ModelPicker({ selectedModelId, onSelect }: ModelPickerProps) {
  const [models, setModels] = useState<ModelOut[]>([]);

  const fetchModels = useCallback(async () => {
    try {
      const data = await listModels();
      setModels(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Resolve what's currently selected
  const effectiveId = selectedModelId || "project-default";
  const selectedModel = models.find((m) => m.id === effectiveId);
  const userDefault = models.find((m) => m.is_default && !m.builtin);

  // Determine display label
  let displayLabel = "Default";
  let displayIcon = "⚪";
  if (selectedModel) {
    displayLabel = shortName(selectedModel);
    displayIcon = PROVIDER_ICONS[selectedModel.provider] || "⚪";
  } else if (!selectedModelId && userDefault) {
    displayLabel = `Default (${userDefault.name})`;
    displayIcon = PROVIDER_ICONS[userDefault.provider] || "⚪";
  }

  const projectDefault = models.find((m) => m.builtin);
  const userModels = models.filter((m) => !m.builtin);

  if (models.length <= 1) return null; // Only project default, no picker needed

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] md:text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors">
        <span>{displayIcon}</span>
        <span className="max-w-[100px] truncate">{displayLabel}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* Default option */}
        <DropdownMenuItem
          onClick={() => onSelect(null)}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span>⚪</span>
            <div>
              <span className="text-sm">Default</span>
              {userDefault && (
                <p className="text-[10px] text-muted-foreground">
                  → {userDefault.name}
                </p>
              )}
              {!userDefault && projectDefault && (
                <p className="text-[10px] text-muted-foreground">
                  → {projectDefault.model_id}
                </p>
              )}
            </div>
          </div>
          {!selectedModelId && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>

        {userModels.length > 0 && <DropdownMenuSeparator />}

        {/* User models */}
        {userModels.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onSelect(m.id)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span>{PROVIDER_ICONS[m.provider] || "⚪"}</span>
              <div>
                <span className="text-sm">{m.name}</span>
                <p className="text-[10px] text-muted-foreground">{m.model_id}</p>
              </div>
            </div>
            {effectiveId === m.id && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}

        {projectDefault && userModels.length > 0 && <DropdownMenuSeparator />}

        {/* Project default explicitly */}
        {projectDefault && (
          <DropdownMenuItem
            onClick={() => onSelect("project-default")}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span>{PROVIDER_ICONS[projectDefault.provider] || "⚪"}</span>
              <div>
                <span className="text-sm">Project Default</span>
                <p className="text-[10px] text-muted-foreground">
                  {projectDefault.model_id}
                </p>
              </div>
            </div>
            {effectiveId === "project-default" && selectedModelId && (
              <Check className="h-3.5 w-3.5" />
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Integrate ModelPicker into ChatInput**

In `frontend/src/components/chat-input.tsx`, add import:

```tsx
import { ModelPicker } from "@/components/model-picker";
```

Add props:

```tsx
interface ChatInputProps {
  onSend: (content: string, mode: ChatMode, files: PendingFile[]) => void;
  disabled: boolean;
  transparent?: boolean;
  chatModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
}
```

Update the component signature:

```tsx
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ onSend, disabled, transparent, chatModelId, onModelChange }, ref) {
```

Add the `ModelPicker` in the mode selector area — before the MODES map, add:

```tsx
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <ModelPicker
            selectedModelId={chatModelId ?? null}
            onSelect={(id) => onModelChange?.(id)}
          />
          <div className="mx-1 h-4 w-px bg-border/50" />
          {MODES.map((m) => {
```

Close the existing modes div properly.

- [ ] **Step 3: Wire up in the chat page**

The parent page that uses `ChatInput` needs to pass `chatModelId` and `onModelChange`. Find the chat page component and:
- Read the chat's `model_id` from the chat detail
- Pass it to `ChatInput` as `chatModelId`
- On change, call `updateChat(chatId, undefined, undefined, newModelId)`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/model-picker.tsx frontend/src/components/chat-input.tsx
git commit -m "feat: add model picker dropdown to chat input"
```

---

### Task 11: Install cryptography dependency

**Files:**
- Modify: `backend/requirements.txt` (or `pyproject.toml`)

- [ ] **Step 1: Add cryptography package**

Check if `cryptography` is already installed:

```bash
cd backend && pip show cryptography
```

If not, add to requirements:

```
cryptography>=44.0.0
```

- [ ] **Step 2: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add cryptography dependency for API key encryption"
```

---

### Task 12: End-to-End Smoke Test

- [ ] **Step 1: Generate an encryption key**

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add the output to `.env` as `ENCRYPTION_KEY=...`

- [ ] **Step 2: Run migration**

Run: `make migrate`
Expected: Migration 0023 applies successfully.

- [ ] **Step 3: Test model CRUD via curl**

```bash
# List models (should show project default only)
curl -s http://localhost:8000/api/models -b cookies.txt | python3 -m json.tool

# Create a model
curl -s -X POST http://localhost:8000/api/models \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name": "Test GPT", "provider": "openai", "model_id": "gpt-4o-mini", "api_key": "sk-test"}' | python3 -m json.tool
```

- [ ] **Step 4: Test frontend**

1. Open Settings → Models tab
2. Verify project default shows
3. Add a custom model
4. Set it as default
5. Open a chat, check model picker appears
6. Select a model, send a message

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address smoke test issues for multi-model feature"
```
