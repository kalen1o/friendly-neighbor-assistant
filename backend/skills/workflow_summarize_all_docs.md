---
name: summarize_all_docs
description: Generate a summary digest of all uploaded documents
type: workflow
enabled: true
---

## When to use
When the user asks to summarize all their documents, create a knowledge base overview, or wants a digest of everything uploaded.

## Steps
1. Retrieve list of all documents with status "ready"
2. For each document, get the first few chunks as representative content
3. Summarize each document in 2-3 sentences
4. Return a combined digest with document names and summaries

## Output Format
### Document Digest
- **[filename]**: Summary of content...
- **[filename]**: Summary of content...
