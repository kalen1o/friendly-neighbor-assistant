---
name: query_logger
description: Log which skills were selected and their results
type: observability
hook_point: post_skills
priority: 100
enabled: true
---

## Action
Log the skills that were selected, which ones returned results, and the total sources found.
Format: [SKILLS] selected=[...] with_results=[...] total_sources=N
