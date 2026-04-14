---
name: translate_report
description: Extract key points from text and translate to multiple languages
type: workflow
enabled: true
---

## When to use
When the user asks to translate a document or text into multiple languages, or wants a multilingual summary/report.

```json
{
  "steps": [
    {
      "name": "extract",
      "prompt": "Extract the 5 most important key points from the following text. Be concise and clear."
    },
    {
      "name": "translate_vi",
      "prompt": "Translate the following key points to Vietnamese. Keep the numbered format.",
      "input": "extract",
      "parallel": "translate_ja"
    },
    {
      "name": "translate_ja",
      "prompt": "Translate the following key points to Japanese. Keep the numbered format.",
      "input": "extract"
    },
    {
      "name": "format",
      "prompt": "Combine the translations into a clean bilingual report with sections for each language. Include the original English key points first, then Vietnamese, then Japanese.",
      "input": ["translate_vi", "translate_ja"]
    }
  ]
}
```
