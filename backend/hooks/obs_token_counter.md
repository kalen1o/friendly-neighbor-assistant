---
name: token_counter
description: Track approximate token usage per message
type: observability
hook_point: post_llm
priority: 100
enabled: true
---

## Action
Estimate token count for the prompt (input) and response (output) using ~4 chars per token.
Log: [TOKENS] input=N output=N total=N chat_id=N
