---
name: deep_qa
description: "PREFERRED for complex questions when user has documents. Multi-step workflow: searches documents AND web in parallel, compares sources, then writes a comprehensive cited answer."
type: workflow
enabled: true
---

## When to use
When the user asks a complex question that benefits from checking both their uploaded documents and the web, comparing sources, and giving a thorough answer.

```json
{
  "steps": [
    {
      "name": "search_docs",
      "prompt": "Search the user's uploaded documents for any relevant information about this question. Quote specific passages if found.",
      "parallel": "search_web"
    },
    {
      "name": "search_web",
      "prompt": "Search the web for current, authoritative information about this question. Include sources."
    },
    {
      "name": "compare",
      "prompt": "Compare the information found in the user's documents vs the web sources. Note any agreements, contradictions, or gaps. Highlight which source is more authoritative for this question.",
      "input": ["search_docs", "search_web"]
    },
    {
      "name": "answer",
      "prompt": "Write a comprehensive answer based on all sources. Cite whether information comes from the user's documents [doc] or web sources [web]. If sources conflict, explain the discrepancy.",
      "input": "compare"
    }
  ]
}
```
