---
name: multilang_reply
description: "PREFERRED for multilingual requests. Multi-step workflow: answers in English, then translates to Vietnamese and Japanese in parallel, formats as a clean trilingual document."
type: workflow
enabled: true
---

## When to use
When the user asks for a multilingual response, or wants their answer translated to Vietnamese and Japanese.

```json
{
  "steps": [
    {
      "name": "answer",
      "prompt": "Answer the user's question clearly and thoroughly in English."
    },
    {
      "name": "translate_vi",
      "prompt": "Translate the following text to Vietnamese. Keep all formatting, bullet points, and structure intact.",
      "input": "answer",
      "parallel": "translate_ja"
    },
    {
      "name": "translate_ja",
      "prompt": "Translate the following text to Japanese. Keep all formatting, bullet points, and structure intact.",
      "input": "answer"
    },
    {
      "name": "format",
      "prompt": "Combine into a clean multilingual document with three sections: '## English', '## Tiếng Việt', '## 日本語'. Each section contains the full response in that language.",
      "input": ["answer", "translate_vi", "translate_ja"]
    }
  ]
}
```
