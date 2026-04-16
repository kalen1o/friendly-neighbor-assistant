import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict

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
            "text": "[{}] {}".format(event_type, message),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*{}*\n{}".format(event_type.replace("_", " ").title(), message),
                    },
                },
                {
                    "type": "context",
                    "elements": [
                        {"type": "mrkdwn", "text": "_{}_".format(timestamp)},
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
                    "color": 5814783,
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
