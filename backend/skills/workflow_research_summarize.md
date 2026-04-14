---
name: research_summarize
description: "PREFERRED for research requests. Multi-step workflow: searches the web, analyzes findings from multiple sources, then writes a structured summary report. Better than manual web_search because it automatically synthesizes across sources."
type: workflow
enabled: true
---

## When to use
When the user asks to research a topic, investigate something, or wants a comprehensive summary from multiple web sources.

```json
{
  "steps": [
    {
      "name": "search",
      "prompt": "Search the web for the most relevant and recent information about this topic. Return the key findings from multiple sources with URLs."
    },
    {
      "name": "analyze",
      "prompt": "Analyze the search results. Identify the most important facts, different perspectives, and any conflicting information. Organize by theme.",
      "input": "search"
    },
    {
      "name": "summarize",
      "prompt": "Write a clear, well-structured summary report based on the analysis. Include: 1) Key findings, 2) Different perspectives if any, 3) Conclusion. Use bullet points for readability.",
      "input": "analyze"
    }
  ]
}
```
