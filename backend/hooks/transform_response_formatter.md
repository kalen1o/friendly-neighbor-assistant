---
name: response_formatter
description: Clean up and format LLM response markdown
type: transformation
hook_point: post_llm
priority: 150
enabled: false
---

## Action
Clean up the LLM response:
- Remove excessive newlines (more than 2 consecutive)
- Ensure code blocks are properly closed
- Trim trailing whitespace
- Fix common markdown formatting issues
