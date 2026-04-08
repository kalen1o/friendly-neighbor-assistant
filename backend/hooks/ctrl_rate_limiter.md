---
name: rate_limiter
description: Limit messages per minute per chat
type: control
hook_point: pre_message
priority: 5
enabled: false
---

## Action
Track message timestamps per chat_id.
If more than 10 messages in the last 60 seconds, set blocked=true with "Rate limit exceeded" message.
Default limit: 10 messages per minute per chat.
