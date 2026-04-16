import pytest

from app.models.webhook import WebhookIntegration
from app.webhooks.events import _format_payload
from app.webhooks.inbound import parse_inbound_message


def test_webhook_model_defaults():
    wh = WebhookIntegration(
        user_id=1,
        name="Test",
        platform="slack",
        direction="outbound",
        webhook_url="https://hooks.slack.com/test",
        enabled=True,
    )
    assert wh.platform == "slack"
    assert wh.enabled is True


def test_format_payload_generic():
    payload = _format_payload(
        "generic", "message_completed", {"chat_id": "chat-123", "message": "Hello"}
    )
    assert payload["event"] == "message_completed"
    assert payload["data"]["chat_id"] == "chat-123"


def test_format_payload_slack():
    payload = _format_payload("slack", "message_completed", {"message": "Hello"})
    assert "blocks" in payload
    assert "text" in payload


def test_format_payload_discord():
    payload = _format_payload("discord", "message_completed", {"message": "Hello"})
    assert "embeds" in payload


def test_parse_generic_inbound():
    result = parse_inbound_message("generic", {"message": "Hello"})
    assert result["text"] == "Hello"


def test_parse_slack_inbound():
    body = {
        "type": "event_callback",
        "event": {"type": "message", "text": "Hello", "channel": "C123"},
    }
    result = parse_inbound_message("slack", body)
    assert result["text"] == "Hello"
    assert result["channel"] == "C123"


def test_parse_slack_url_verification():
    body = {"type": "url_verification", "challenge": "abc123"}
    result = parse_inbound_message("slack", body)
    assert result["type"] == "url_verification"
    assert result["challenge"] == "abc123"


def test_parse_discord_ping():
    result = parse_inbound_message("discord", {"type": 1})
    assert result["type"] == "ping"


def test_parse_discord_message():
    body = {"type": 2, "data": {"options": [{"value": "Hello"}]}, "channel_id": "123"}
    result = parse_inbound_message("discord", body)
    assert result["text"] == "Hello"


@pytest.mark.anyio
async def test_list_webhooks_empty(client):
    response = await client.get("/api/webhooks")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.anyio
async def test_create_webhook(client):
    response = await client.post(
        "/api/webhooks",
        json={
            "name": "My Slack",
            "platform": "slack",
            "direction": "outbound",
            "webhook_url": "https://hooks.slack.com/services/test",
            "subscribed_events": ["message_completed"],
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My Slack"
    assert data["platform"] == "slack"
    assert data["enabled"] is True
    assert "id" in data


@pytest.mark.anyio
async def test_create_inbound_webhook_generates_token(client):
    response = await client.post(
        "/api/webhooks",
        json={
            "name": "Slack Inbound",
            "platform": "slack",
            "direction": "inbound",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["inbound_token"] is not None
    assert len(data["inbound_token"]) > 20


@pytest.mark.anyio
async def test_update_webhook(client):
    create = await client.post(
        "/api/webhooks",
        json={
            "name": "Old Name",
            "platform": "generic",
            "direction": "outbound",
            "webhook_url": "https://example.com/hook",
            "subscribed_events": ["message_completed"],
        },
    )
    wh_id = create.json()["id"]
    response = await client.put(
        "/api/webhooks/{}".format(wh_id),
        json={
            "name": "New Name",
            "enabled": False,
        },
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["enabled"] is False


@pytest.mark.anyio
async def test_delete_webhook(client):
    create = await client.post(
        "/api/webhooks",
        json={
            "name": "To Delete",
            "platform": "generic",
            "direction": "outbound",
            "webhook_url": "https://example.com/hook",
            "subscribed_events": [],
        },
    )
    wh_id = create.json()["id"]
    response = await client.delete("/api/webhooks/{}".format(wh_id))
    assert response.status_code == 204
