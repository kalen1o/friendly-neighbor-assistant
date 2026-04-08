---
name: log_messages
description: Log every message exchange to console
type: observability
hook_point: post_message
priority: 100
enabled: true
---

## Action
Log the user message content, assistant response length, skills used, sources count, and timestamp.
Format: [TIMESTAMP] user="..." response_len=N skills=[...] sources=N
