# Webhook Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webhook integrations for Slack, Discord, and generic URLs with outbound event notifications and inbound message triggers.

**Architecture:** Event bus pattern — events emitted from chat/document flows, dispatched to per-user webhook subscriptions. Inbound webhooks receive messages from external platforms, run the agent in a background task, and POST replies back.

**Tech Stack:** Python/FastAPI, PostgreSQL, httpx (async HTTP), SQLAlchemy async, Next.js/React frontend.

---

## File Structure

### New Files
- `backend/app/models/webhook.py` — WebhookIntegration ORM model
- `backend/app/schemas/webhook.py` — Pydantic request/response schemas
- `backend/app/webhooks/events.py` — event emitter + outbound dispatcher
- `backend/app/webhooks/inbound.py` — platform-specific inbound message parsers
- `backend/app/routers/webhooks.py` — CRUD endpoints + inbound handler
- `backend/alembic/versions/0029_add_webhook_integrations.py` — migration
- `backend/tests/test_webhooks.py` — tests
- `frontend/src/components/integrations-settings.tsx` — integrations tab UI

### Modified Files
- `backend/app/main.py` — register webhooks router
- `backend/app/routers/chats.py` — emit `message_completed` event after response
- `backend/app/rag/processing.py` — emit `document_processed` event after processing
- `backend/tests/conftest.py` — import WebhookIntegration model for table creation
- `frontend/src/components/settings-dialog.tsx` — add "Integrations" tab
- `frontend/src/lib/api.ts` — add webhook CRUD API functions
- `README.md` — update roadmap

---

### Task 1: WebhookIntegration Model + Migration

**Files:**
- Create: `backend/app/models/webhook.py`
- Create: `backend/alembic/versions/0029_add_webhook_integrations.py`
- Test: `backend/tests/test_webhooks.py`

- [ ] **Step 1: Create the model**

Create `backend/app/models/webhook.py`:

```python
from datetime import datetime
from functools import partial
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.ids import generate_public_id


class WebhookIntegration(Base):
    __tablename__ = "webhook_integrations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(24), unique=True, default=partial(generate_public_id, "wh")
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    platform: Mapped[str] = mapped_column(String(20))  # slack, discord, generic
    direction: Mapped[str] = mapped_column(String(10))  # outbound, inbound, both
    webhook_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    inbound_token: Mapped[Optional[str]] = mapped_column(String(64), default=None, unique=True)
    subscribed_events: Mapped[Optional[str]] = mapped_column(Text, default="[]")  # JSON array
    config_json: Mapped[Optional[str]] = mapped_column(Text, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

- [ ] **Step 2: Create the migration**

Create `backend/alembic/versions/0029_add_webhook_integrations.py`:

```python
"""add webhook_integrations table

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhook_integrations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(24), unique=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("webhook_url", sa.Text(), nullable=True),
        sa.Column("inbound_token", sa.String(64), unique=True, nullable=True),
        sa.Column("subscribed_events", sa.Text(), nullable=True, server_default="[]"),
        sa.Column("config_json", sa.Text(), nullable=True, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("webhook_integrations")
```

- [ ] **Step 3: Import model in test conftest**

In `backend/tests/conftest.py`, add after the existing model imports:

```python
from app.models.webhook import WebhookIntegration  # noqa: F401
```

- [ ] **Step 4: Write test to verify model works**

Create `backend/tests/test_webhooks.py`:

```python
import pytest
from app.models.webhook import WebhookIntegration


def test_webhook_model_defaults():
    """WebhookIntegration model has correct defaults."""
    wh = WebhookIntegration(
        user_id=1,
        name="Test Slack",
        platform="slack",
        direction="outbound",
        webhook_url="https://hooks.slack.com/test",
    )
    assert wh.platform == "slack"
    assert wh.direction == "outbound"
    assert wh.enabled is True
    assert wh.subscribed_events == "[]"
    assert wh.config_json == "{}"
```

- [ ] **Step 5: Run test**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/webhook.py backend/alembic/versions/0029_add_webhook_integrations.py backend/tests/test_webhooks.py backend/tests/conftest.py
git commit -m "feat(webhooks): add WebhookIntegration model and migration"
```

---

### Task 2: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/webhook.py`

- [ ] **Step 1: Create schemas**

Create `backend/app/schemas/webhook.py`:

```python
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class WebhookCreate(BaseModel):
    name: str = Field(max_length=100)
    platform: str = Field(pattern="^(slack|discord|generic)$")
    direction: str = Field(pattern="^(outbound|inbound|both)$")
    webhook_url: Optional[str] = None
    subscribed_events: List[str] = []
    config_json: Optional[dict] = None


class WebhookUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    webhook_url: Optional[str] = None
    subscribed_events: Optional[List[str]] = None
    config_json: Optional[dict] = None
    enabled: Optional[bool] = None


class WebhookOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    name: str
    platform: str
    direction: str
    webhook_url: Optional[str] = None
    inbound_token: Optional[str] = None
    inbound_url: Optional[str] = None
    subscribed_events: List[str] = []
    config: Optional[dict] = None
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/webhook.py
git commit -m "feat(webhooks): add Pydantic schemas"
```

---

### Task 3: Event Emitter + Outbound Dispatcher

**Files:**
- Create: `backend/app/webhooks/__init__.py`
- Create: `backend/app/webhooks/events.py`
- Test: `backend/tests/test_webhooks.py`

- [ ] **Step 1: Create __init__.py**

Create empty `backend/app/webhooks/__init__.py`.

- [ ] **Step 2: Write failing test**

Add to `backend/tests/test_webhooks.py`:

```python
import json
from unittest.mock import AsyncMock, MagicMock, patch

from app.webhooks.events import emit_event, _format_payload


def test_format_payload_generic():
    """Generic payload includes event type and data."""
    payload = _format_payload("generic", "message_completed", {"chat_id": "chat-123", "message": "Hello"})
    assert payload["event"] == "message_completed"
    assert payload["data"]["chat_id"] == "chat-123"
    assert "timestamp" in payload


def test_format_payload_slack():
    """Slack payload uses Block Kit format."""
    payload = _format_payload("slack", "message_completed", {"chat_id": "chat-123", "message": "Hello world"})
    assert "blocks" in payload or "text" in payload


def test_format_payload_discord():
    """Discord payload uses embed format."""
    payload = _format_payload("discord", "message_completed", {"chat_id": "chat-123", "message": "Hello world"})
    assert "embeds" in payload or "content" in payload
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement events.py**

Create `backend/app/webhooks/events.py`:

```python
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import WebhookIntegration

logger = logging.getLogger(__name__)

VALID_EVENTS = {"message_completed", "document_processed", "task_completed"}


def _format_payload(platform: str, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Format event payload for the target platform."""
    timestamp = datetime.now(timezone.utc).isoformat()

    if platform == "slack":
        message = data.get("message", "")[:200]
        return {
            "text": f"[{event_type}] {message}",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{event_type.replace('_', ' ').title()}*\n{message}",
                    },
                },
                {
                    "type": "context",
                    "elements": [
                        {"type": "mrkdwn", "text": f"_{timestamp}_"},
                    ],
                },
            ],
        }

    if platform == "discord":
        message = data.get("message", "")[:200]
        return {
            "content": None,
            "embeds": [
                {
                    "title": event_type.replace("_", " ").title(),
                    "description": message,
                    "timestamp": timestamp,
                    "color": 5814783,  # green
                }
            ],
        }

    # generic
    return {
        "event": event_type,
        "timestamp": timestamp,
        "data": data,
    }


async def _dispatch_to_webhook(url: str, payload: Dict[str, Any]) -> None:
    """POST payload to a webhook URL. Fire-and-forget."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            logger.info("Webhook dispatched to %s: %d", url, resp.status_code)
    except Exception:
        logger.exception("Webhook dispatch failed for %s", url)


async def emit_event(event_type: str, data: Dict[str, Any], user_id: int, db: AsyncSession) -> None:
    """Emit an event to all matching webhook integrations for this user."""
    if event_type not in VALID_EVENTS:
        logger.warning("Unknown event type: %s", event_type)
        return

    result = await db.execute(
        select(WebhookIntegration).where(
            WebhookIntegration.user_id == user_id,
            WebhookIntegration.enabled == True,  # noqa: E712
            WebhookIntegration.direction.in_(["outbound", "both"]),
        )
    )
    integrations = result.scalars().all()

    for integration in integrations:
        events = json.loads(integration.subscribed_events or "[]")
        if event_type not in events:
            continue
        if not integration.webhook_url:
            continue

        payload = _format_payload(integration.platform, event_type, data)
        asyncio.create_task(_dispatch_to_webhook(integration.webhook_url, payload))
```

- [ ] **Step 5: Run tests**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/webhooks/__init__.py backend/app/webhooks/events.py backend/tests/test_webhooks.py
git commit -m "feat(webhooks): add event emitter and outbound dispatcher"
```

---

### Task 4: Inbound Message Parsers

**Files:**
- Create: `backend/app/webhooks/inbound.py`
- Test: `backend/tests/test_webhooks.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_webhooks.py`:

```python
from app.webhooks.inbound import parse_inbound_message


def test_parse_generic_inbound():
    """Generic inbound extracts message from JSON body."""
    body = {"message": "Hello from webhook"}
    result = parse_inbound_message("generic", body)
    assert result["text"] == "Hello from webhook"


def test_parse_slack_inbound():
    """Slack inbound extracts text from event payload."""
    body = {
        "type": "event_callback",
        "event": {"type": "message", "text": "Hello from Slack", "channel": "C123"},
    }
    result = parse_inbound_message("slack", body)
    assert result["text"] == "Hello from Slack"
    assert result["channel"] == "C123"


def test_parse_slack_url_verification():
    """Slack URL verification challenge is detected."""
    body = {"type": "url_verification", "challenge": "abc123"}
    result = parse_inbound_message("slack", body)
    assert result["type"] == "url_verification"
    assert result["challenge"] == "abc123"


def test_parse_discord_inbound():
    """Discord inbound extracts content from interaction."""
    body = {
        "type": 1,  # PING
    }
    result = parse_inbound_message("discord", body)
    assert result["type"] == "ping"


def test_parse_discord_message():
    """Discord message interaction extracts content."""
    body = {
        "type": 2,  # APPLICATION_COMMAND
        "data": {"options": [{"value": "Hello from Discord"}]},
        "channel_id": "123456",
    }
    result = parse_inbound_message("discord", body)
    assert result["text"] == "Hello from Discord"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: FAIL

- [ ] **Step 3: Implement inbound.py**

Create `backend/app/webhooks/inbound.py`:

```python
from typing import Any, Dict


def parse_inbound_message(platform: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Parse an inbound webhook payload into a normalized message dict.

    Returns dict with keys:
      - text: the message content (if a real message)
      - type: "message", "url_verification", "ping" etc.
      - channel: source channel ID (platform-specific, optional)
    """
    if platform == "slack":
        # Slack URL verification challenge
        if body.get("type") == "url_verification":
            return {"type": "url_verification", "challenge": body.get("challenge", "")}

        # Slack event callback
        event = body.get("event", {})
        return {
            "type": "message",
            "text": event.get("text", ""),
            "channel": event.get("channel", ""),
        }

    if platform == "discord":
        # Discord PING (type 1)
        if body.get("type") == 1:
            return {"type": "ping"}

        # Discord APPLICATION_COMMAND (type 2) or MESSAGE_COMPONENT (type 3)
        data = body.get("data", {})
        options = data.get("options", [])
        text = options[0].get("value", "") if options else data.get("content", "")

        # Also handle plain message content for Discord bots
        if not text and "content" in body:
            text = body["content"]

        return {
            "type": "message",
            "text": text,
            "channel": body.get("channel_id", ""),
        }

    # generic
    return {
        "type": "message",
        "text": body.get("message", body.get("text", "")),
    }
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/webhooks/inbound.py backend/tests/test_webhooks.py
git commit -m "feat(webhooks): add platform-specific inbound message parsers"
```

---

### Task 5: Webhooks Router (CRUD + Inbound)

**Files:**
- Create: `backend/app/routers/webhooks.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_webhooks.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_webhooks.py`:

```python
@pytest.mark.anyio
async def test_list_webhooks_empty(client):
    """List webhooks returns empty array for new user."""
    response = await client.get("/api/webhooks")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.anyio
async def test_create_webhook(client):
    """Create a new webhook integration."""
    response = await client.post("/api/webhooks", json={
        "name": "My Slack",
        "platform": "slack",
        "direction": "outbound",
        "webhook_url": "https://hooks.slack.com/services/test",
        "subscribed_events": ["message_completed"],
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My Slack"
    assert data["platform"] == "slack"
    assert data["enabled"] is True
    assert "id" in data


@pytest.mark.anyio
async def test_create_inbound_webhook_generates_token(client):
    """Inbound webhook gets a generated inbound_token."""
    response = await client.post("/api/webhooks", json={
        "name": "Slack Inbound",
        "platform": "slack",
        "direction": "inbound",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["inbound_token"] is not None
    assert len(data["inbound_token"]) > 20


@pytest.mark.anyio
async def test_update_webhook(client):
    """Update a webhook integration."""
    create = await client.post("/api/webhooks", json={
        "name": "Old Name",
        "platform": "generic",
        "direction": "outbound",
        "webhook_url": "https://example.com/hook",
        "subscribed_events": ["message_completed"],
    })
    wh_id = create.json()["id"]

    response = await client.put(f"/api/webhooks/{wh_id}", json={
        "name": "New Name",
        "enabled": False,
    })
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["enabled"] is False


@pytest.mark.anyio
async def test_delete_webhook(client):
    """Delete a webhook integration."""
    create = await client.post("/api/webhooks", json={
        "name": "To Delete",
        "platform": "generic",
        "direction": "outbound",
        "webhook_url": "https://example.com/hook",
        "subscribed_events": [],
    })
    wh_id = create.json()["id"]

    response = await client.delete(f"/api/webhooks/{wh_id}")
    assert response.status_code == 204

    # Verify deleted
    list_resp = await client.get("/api/webhooks")
    assert all(w["id"] != wh_id for w in list_resp.json())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: FAIL — router doesn't exist.

- [ ] **Step 3: Implement webhooks router**

Create `backend/app/routers/webhooks.py`:

```python
import asyncio
import json
import logging
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.user import User
from app.models.webhook import WebhookIntegration
from app.schemas.webhook import WebhookCreate, WebhookOut, WebhookUpdate
from app.webhooks.inbound import parse_inbound_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def _to_out(wh: WebhookIntegration) -> dict:
    """Convert a WebhookIntegration to WebhookOut-compatible dict."""
    events = json.loads(wh.subscribed_events or "[]")
    config = json.loads(wh.config_json or "{}")
    inbound_url = None
    if wh.inbound_token and wh.direction in ("inbound", "both"):
        inbound_url = f"/api/webhooks/{wh.platform}/{wh.inbound_token}"
    return {
        "id": wh.public_id,
        "name": wh.name,
        "platform": wh.platform,
        "direction": wh.direction,
        "webhook_url": wh.webhook_url,
        "inbound_token": wh.inbound_token,
        "inbound_url": inbound_url,
        "subscribed_events": events,
        "config": config,
        "enabled": wh.enabled,
        "created_at": wh.created_at,
    }


@router.get("", response_model=List[WebhookOut])
async def list_webhooks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookIntegration)
        .where(WebhookIntegration.user_id == user.id)
        .order_by(WebhookIntegration.created_at.desc())
    )
    return [_to_out(wh) for wh in result.scalars().all()]


@router.post("", status_code=201, response_model=WebhookOut)
async def create_webhook(
    body: WebhookCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    inbound_token = None
    if body.direction in ("inbound", "both"):
        inbound_token = secrets.token_urlsafe(32)

    wh = WebhookIntegration(
        user_id=user.id,
        name=body.name,
        platform=body.platform,
        direction=body.direction,
        webhook_url=body.webhook_url,
        inbound_token=inbound_token,
        subscribed_events=json.dumps(body.subscribed_events),
        config_json=json.dumps(body.config_json) if body.config_json else "{}",
    )
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    return _to_out(wh)


@router.put("/{webhook_id}", response_model=WebhookOut)
async def update_webhook(
    webhook_id: str,
    body: WebhookUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookIntegration).where(
            WebhookIntegration.public_id == webhook_id,
            WebhookIntegration.user_id == user.id,
        )
    )
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")

    if body.name is not None:
        wh.name = body.name
    if body.webhook_url is not None:
        wh.webhook_url = body.webhook_url
    if body.subscribed_events is not None:
        wh.subscribed_events = json.dumps(body.subscribed_events)
    if body.config_json is not None:
        wh.config_json = json.dumps(body.config_json)
    if body.enabled is not None:
        wh.enabled = body.enabled

    await db.commit()
    await db.refresh(wh)
    return _to_out(wh)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookIntegration).where(
            WebhookIntegration.public_id == webhook_id,
            WebhookIntegration.user_id == user.id,
        )
    )
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(wh)
    await db.commit()


@router.post("/{platform}/{token}")
async def inbound_webhook(
    platform: str,
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Handle inbound webhook from external platform."""
    # Verify token
    result = await db.execute(
        select(WebhookIntegration).where(
            WebhookIntegration.inbound_token == token,
            WebhookIntegration.platform == platform,
            WebhookIntegration.enabled == True,  # noqa: E712
            WebhookIntegration.direction.in_(["inbound", "both"]),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Invalid webhook")

    body = await request.json()
    parsed = parse_inbound_message(platform, body)

    # Handle platform verification handshakes
    if parsed.get("type") == "url_verification":
        return JSONResponse({"challenge": parsed["challenge"]})
    if parsed.get("type") == "ping":
        return JSONResponse({"type": 1})  # Discord ACK

    text = parsed.get("text", "")
    if not text.strip():
        return JSONResponse({"status": "ok", "message": "empty message ignored"})

    # Run agent in background
    asyncio.create_task(
        _process_inbound_message(integration, text, db, settings)
    )
    return JSONResponse({"status": "ok"})


async def _process_inbound_message(
    integration: WebhookIntegration,
    text: str,
    db: AsyncSession,
    settings: Settings,
) -> None:
    """Background task: create/find chat, run agent, POST reply back."""
    import json as _json
    from app.db.engine import get_session_factory
    from app.models.chat import Chat, Message
    from sqlalchemy import select as _sel, func

    try:
        async with get_session_factory()() as session:
            config = _json.loads(integration.config_json or "{}")
            channel_mode = config.get("channel_mode", "new_chat")
            chat_id = config.get("chat_id")

            # Find or create chat
            if channel_mode == "persistent" and chat_id:
                result = await session.execute(
                    _sel(Chat).where(Chat.public_id == chat_id)
                )
                chat = result.scalar_one_or_none()
                if not chat:
                    channel_mode = "new_chat"

            if channel_mode == "new_chat" or not chat_id:
                chat = Chat(user_id=integration.user_id, title=f"Webhook: {text[:50]}")
                session.add(chat)
                await session.commit()
                await session.refresh(chat)

            # Save user message
            user_msg = Message(chat_id=chat.id, role="user", content=text)
            session.add(user_msg)
            await session.commit()

            # Run agent
            from app.agent.agent import build_agent_context, create_tool_executor
            from app.llm.provider import get_llm_response

            tool_defs, knowledge_prompts, registry = await build_agent_context(
                session, settings, user_id=integration.user_id
            )

            messages = [{"role": "user", "content": text}]
            if knowledge_prompts:
                messages[-1]["content"] += "\n\n---\n" + "\n\n".join(knowledge_prompts)

            response = await get_llm_response(messages, settings)

            # Save assistant message
            assistant_msg = Message(
                chat_id=chat.id, role="assistant", content=response, status="completed"
            )
            session.add(assistant_msg)
            chat.updated_at = func.now()
            await session.commit()

            # POST reply back to webhook_url
            if integration.webhook_url and response:
                import httpx
                from app.webhooks.events import _format_payload

                payload = _format_payload(
                    integration.platform,
                    "message_completed",
                    {"chat_id": chat.public_id, "message": response[:2000]},
                )
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        await client.post(integration.webhook_url, json=payload)
                except Exception:
                    logger.exception("Failed to POST reply to webhook")

    except Exception:
        logger.exception("Failed to process inbound webhook message")
```

- [ ] **Step 4: Register router in main.py**

In `backend/app/main.py`, add after the existing router imports:

```python
from app.routers.webhooks import router as webhooks_router
```

And add after the last `app.include_router(...)` line:

```python
app.include_router(webhooks_router)
```

- [ ] **Step 5: Run tests**

Run: `python3 -m pytest backend/tests/test_webhooks.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/webhooks.py backend/app/main.py backend/tests/test_webhooks.py
git commit -m "feat(webhooks): add CRUD endpoints and inbound handler"
```

---

### Task 6: Emit Events from Chat and Document Processing

**Files:**
- Modify: `backend/app/routers/chats.py`
- Modify: `backend/app/rag/processing.py`

- [ ] **Step 1: Emit message_completed in chats.py**

In `backend/app/routers/chats.py`, find the line `await db.refresh(assistant_msg)` (around line 999) inside `_llm_background_task`. Add after it:

```python
                # Emit webhook event
                try:
                    from app.webhooks.events import emit_event
                    await emit_event(
                        "message_completed",
                        {
                            "chat_id": chat_public_id,
                            "message": cleaned_response[:200],
                            "user": user_msg_content_resolved[:100],
                        },
                        user_id=user_id,
                        db=db,
                    )
                except Exception:
                    pass  # Don't break chat flow for webhook failures
```

- [ ] **Step 2: Emit document_processed in processing.py**

In `backend/app/rag/processing.py`, find `logger.info(f"Document {document_id} processed: {len(chunk_texts)} chunks")` near the end of the try block. Add after it:

```python
        # Emit webhook event
        try:
            from app.webhooks.events import emit_event
            if doc.user_id:
                await emit_event(
                    "document_processed",
                    {
                        "document_id": doc.public_id,
                        "filename": doc.filename,
                        "status": "ready",
                        "chunk_count": len(chunk_texts),
                    },
                    user_id=doc.user_id,
                    db=db,
                )
        except Exception:
            pass
```

- [ ] **Step 3: Run all tests**

Run: `python3 -m pytest backend/tests/ -q`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/chats.py backend/app/rag/processing.py
git commit -m "feat(webhooks): emit events from chat and document processing"
```

---

### Task 7: Frontend — API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add webhook API types and functions**

Add to the end of `frontend/src/lib/api.ts`:

```typescript
// ── Webhook Integrations ──

export interface WebhookIntegration {
  id: string;
  name: string;
  platform: "slack" | "discord" | "generic";
  direction: "outbound" | "inbound" | "both";
  webhook_url: string | null;
  inbound_token: string | null;
  inbound_url: string | null;
  subscribed_events: string[];
  config: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
}

export interface WebhookCreate {
  name: string;
  platform: "slack" | "discord" | "generic";
  direction: "outbound" | "inbound" | "both";
  webhook_url?: string;
  subscribed_events?: string[];
  config_json?: Record<string, unknown>;
}

export async function listWebhooks(): Promise<WebhookIntegration[]> {
  const res = await authFetch(`${API_BASE}/api/webhooks`);
  if (!res.ok) throw new Error("Failed to list webhooks");
  return res.json();
}

export async function createWebhook(data: WebhookCreate): Promise<WebhookIntegration> {
  const res = await authFetch(`${API_BASE}/api/webhooks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create webhook");
  return res.json();
}

export async function updateWebhook(
  id: string,
  data: Partial<WebhookCreate & { enabled: boolean }>
): Promise<WebhookIntegration> {
  const res = await authFetch(`${API_BASE}/api/webhooks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update webhook");
  return res.json();
}

export async function deleteWebhook(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/webhooks/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete webhook");
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(webhooks): add frontend API functions"
```

---

### Task 8: Frontend — Integrations Settings Tab

**Files:**
- Create: `frontend/src/components/integrations-settings.tsx`
- Modify: `frontend/src/components/settings-dialog.tsx`

- [ ] **Step 1: Create IntegrationsSettings component**

Create `frontend/src/components/integrations-settings.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, Slack, Globe, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type WebhookIntegration,
  type WebhookCreate,
} from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const PLATFORMS = [
  { value: "slack" as const, label: "Slack", icon: Slack },
  { value: "discord" as const, label: "Discord", icon: MessageCircle },
  { value: "generic" as const, label: "Generic URL", icon: Globe },
];

const DIRECTIONS = [
  { value: "outbound" as const, label: "Outbound (notifications)" },
  { value: "inbound" as const, label: "Inbound (receive messages)" },
  { value: "both" as const, label: "Both" },
];

const EVENTS = [
  { value: "message_completed", label: "Message completed" },
  { value: "document_processed", label: "Document processed" },
  { value: "task_completed", label: "Task completed" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function IntegrationsSettings() {
  const [webhooks, setWebhooks] = useState<WebhookIntegration[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebhookCreate>({
    name: "",
    platform: "generic",
    direction: "outbound",
    webhook_url: "",
    subscribed_events: ["message_completed"],
  });
  const [saving, setSaving] = useState(false);

  const load = () => listWebhooks().then(setWebhooks).catch(() => {});

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createWebhook(form);
      toast.success("Integration created");
      setShowForm(false);
      setForm({ name: "", platform: "generic", direction: "outbound", webhook_url: "", subscribed_events: ["message_completed"] });
      load();
    } catch {
      toast.error("Failed to create integration");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (wh: WebhookIntegration) => {
    try {
      await updateWebhook(wh.id, { enabled: !wh.enabled });
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook(id);
      toast.success("Integration deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Connect Slack, Discord, or custom webhooks.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {showForm && (
        <div className="mt-4 space-y-3 rounded-lg border p-4">
          <Input
            placeholder="Integration name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => setForm({ ...form, platform: p.value })}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  form.platform === p.value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                <p.icon className="h-3.5 w-3.5" />
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value as WebhookCreate["direction"] })}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          {(form.direction === "outbound" || form.direction === "both") && (
            <Input
              placeholder="Webhook URL (https://...)"
              value={form.webhook_url || ""}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
            />
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Events</p>
            {EVENTS.map((ev) => (
              <label key={ev.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.subscribed_events?.includes(ev.value) ?? false}
                  onChange={(e) => {
                    const events = form.subscribed_events || [];
                    setForm({
                      ...form,
                      subscribed_events: e.target.checked
                        ? [...events, ev.value]
                        : events.filter((x) => x !== ev.value),
                    });
                  }}
                  className="rounded border-border"
                />
                {ev.label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving || !form.name.trim()} onClick={handleCreate}>
              {saving ? "Creating..." : "Create"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {webhooks.length === 0 && !showForm && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No integrations configured yet.
          </p>
        )}
        {webhooks.map((wh) => {
          const PlatformIcon = PLATFORMS.find((p) => p.value === wh.platform)?.icon || Globe;
          return (
            <div key={wh.id} className="flex items-center gap-3 rounded-lg border p-3">
              <PlatformIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{wh.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {wh.direction} &middot; {wh.subscribed_events.join(", ") || "no events"}
                </p>
                {wh.inbound_url && (
                  <div className="mt-1 flex items-center text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{API_BASE}{wh.inbound_url}</span>
                    <CopyButton text={`${API_BASE}${wh.inbound_url}`} />
                  </div>
                )}
              </div>
              <button
                onClick={() => handleToggle(wh)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  wh.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
                }`}
              >
                {wh.enabled ? "Active" : "Off"}
              </button>
              <button onClick={() => handleDelete(wh.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Integrations tab to settings dialog**

In `frontend/src/components/settings-dialog.tsx`, add import:

```typescript
import { IntegrationsSettings } from "@/components/integrations-settings";
```

Change the `tab` state type to include "integrations":

```typescript
const [tab, setTab] = useState<"general" | "models" | "integrations">("general");
```

Add a third tab button after the "Models" button:

```tsx
          <button
            onClick={() => setTab("integrations")}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium transition-colors",
              tab === "integrations"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Integrations
          </button>
```

Add the tab content — find the `<ModelSettings />` section and add after its closing `)``:

```tsx
          ) : tab === "integrations" ? (
            <IntegrationsSettings />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/integrations-settings.tsx frontend/src/components/settings-dialog.tsx
git commit -m "feat(webhooks): add Integrations tab to settings UI"
```

---

### Task 9: Update README + Run Full Tests

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update roadmap**

In `README.md`, replace:
```
- [ ] Webhook integrations (Slack, Discord)
```
With:
```
- [x] Webhook integrations — Slack, Discord, generic URL (outbound notifications + inbound triggers)
```

- [ ] **Step 2: Run all backend tests**

Run: `python3 -m pytest backend/tests/ -q`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: mark webhook integrations as complete in roadmap"
```
