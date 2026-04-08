---
name: profanity_filter
description: Block or flag messages with inappropriate content
type: control
hook_point: pre_message
priority: 10
enabled: false
---

## Action
Check the user message for profanity or inappropriate content.
If detected, set blocked=true with a reason message.
This is a basic keyword filter — for production use a proper moderation API.

## Blocked words
A minimal list for demonstration. Replace with a proper moderation service in production.
