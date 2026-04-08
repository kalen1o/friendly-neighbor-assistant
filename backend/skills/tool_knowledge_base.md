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
3. Cite the document name when referencing information
