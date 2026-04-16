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
        inbound_url = "/api/webhooks/{}/{}".format(wh.platform, wh.inbound_token)
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
    settings: Settings = Depends(get_settings),
):
    # Check limit
    from sqlalchemy import func

    count = await db.scalar(
        select(func.count(WebhookIntegration.id)).where(
            WebhookIntegration.user_id == user.id
        )
    )
    if count >= settings.max_webhooks_per_user:
        raise HTTPException(
            status_code=400,
            detail="Maximum {} webhooks per user reached".format(
                settings.max_webhooks_per_user
            ),
        )

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
        enabled=True,
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
        return JSONResponse({"type": 1})

    text = parsed.get("text", "")
    if not text.strip():
        return JSONResponse({"status": "ok", "message": "empty message ignored"})

    # Run agent in background
    asyncio.create_task(
        _process_inbound_message(integration.id, integration.user_id, text, settings)
    )
    return JSONResponse({"status": "ok"})


async def _process_inbound_message(
    integration_id: int,
    user_id: int,
    text: str,
    settings: Settings,
) -> None:
    """Background task: create/find chat, run agent, POST reply back."""
    from app.db.engine import get_session_factory
    from app.models.chat import Chat, Message
    from sqlalchemy import func

    try:
        async with get_session_factory()() as session:
            # Re-fetch integration in this session
            result = await session.execute(
                select(WebhookIntegration).where(
                    WebhookIntegration.id == integration_id
                )
            )
            integration = result.scalar_one_or_none()
            if not integration:
                return

            config = json.loads(integration.config_json or "{}")
            channel_mode = config.get("channel_mode", "new_chat")
            chat_id = config.get("chat_id")

            chat = None
            if channel_mode == "persistent" and chat_id:
                result = await session.execute(
                    select(Chat).where(Chat.public_id == chat_id)
                )
                chat = result.scalar_one_or_none()

            if not chat:
                chat = Chat(user_id=user_id, title="Webhook: {}".format(text[:50]))
                session.add(chat)
                await session.commit()
                await session.refresh(chat)

            # Save user message
            user_msg = Message(chat_id=chat.id, role="user", content=text)
            session.add(user_msg)
            await session.commit()

            # Run agent (simple — no tool calling for webhook responses)
            from app.llm.provider import get_llm_response

            messages = [{"role": "user", "content": text}]
            response = await get_llm_response(messages, settings)

            # Save assistant message
            assistant_msg = Message(
                chat_id=chat.id, role="assistant", content=response, status="completed"
            )
            session.add(assistant_msg)
            chat.updated_at = func.now()
            await session.commit()

            # POST reply back
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
