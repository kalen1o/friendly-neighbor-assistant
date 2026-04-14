---
name: knowledge_base
description: Search the user's uploaded documents for relevant information
type: tool
enabled: true
---

## When to use
When the user asks about their documents, files, policies, reports, or any domain-specific information they've uploaded.

## Parameters
- query: The search query
- top_k: Number of results (default: 5)

## Instructions
1. Search the vector database for semantically similar document chunks
2. Return the most relevant passages with filenames and relevance scores
3. When using information from the provided sources, cite them using [1], [2], etc. inline in your response
4. Each numbered reference corresponds to a source passage — always cite the specific source you're drawing from
5. If multiple sources support a claim, cite all relevant ones (e.g., [1][3])
