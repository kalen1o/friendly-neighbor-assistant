from typing import Any, Dict


def parse_inbound_message(platform: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Parse an inbound webhook payload into a normalized message dict."""
    if platform == "slack":
        if body.get("type") == "url_verification":
            return {"type": "url_verification", "challenge": body.get("challenge", "")}
        event = body.get("event", {})
        return {
            "type": "message",
            "text": event.get("text", ""),
            "channel": event.get("channel", ""),
        }

    if platform == "discord":
        if body.get("type") == 1:
            return {"type": "ping"}
        data = body.get("data", {})
        options = data.get("options", [])
        text = options[0].get("value", "") if options else data.get("content", "")
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
