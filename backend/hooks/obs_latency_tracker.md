---
name: latency_tracker
description: Measure end-to-end response time
type: observability
hook_point: pre_message
priority: 1
enabled: true
---

## Action
Record the start time when the message arrives. The post_message hook will calculate the duration.
Store start_time in the hook context for later use.
