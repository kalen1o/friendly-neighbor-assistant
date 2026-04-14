# RAG Enhancements Design Spec

**Date**: 2026-04-13
**Status**: Approved
**Approach**: Layered Pipeline — each enhancement is an independent, toggleable layer in the retrieval pipeline

## Overview

Enhance the existing RAG pipeline with hybrid search, reranking, citation highlighting, improved chunking, and full configurability. Each layer is independently testable and can be enabled/disabled via environment variables.

### Retrieval Pipeline Flow

```
Query → Hybrid Search (vector + FTS → RRF fusion) → Reranking (Cohere) → Citation Formatting → LLM
```

### Rollout Order

1. Hybrid search (Postgres FTS)
2. Reranking (Cohere)
3. Citation highlighting (inline markers + sources list)
4. Improved chunking (semantic, header-aware)
5. Configurability (env vars in config.py)
6. README updates (roadmap + enhancement docs)

---

## 1. Hybrid Search

### Database Changes

- Add `search_vector tsvector` column to `document_chunks` table (new Alembic migration)
- Add GIN index on `search_vector` for fast full-text queries
- Populate `search_vector` during document processing via `to_tsvector('english', chunk_text)`

### New Module: `backend/app/rag/fulltext.py`

- `search_fulltext(query, db, top_k=20)` — converts query to `tsquery`, ranks via `ts_rank`
- Returns chunks with BM25-style scores

### Score Fusion in `retrieval.py`

- Fetch top-20 from vector search + top-20 from FTS
- Combine via Reciprocal Rank Fusion: `score = sum(1 / (k + rank))` with k=60
- Return top results by fused score

### Env Vars

- `RAG_HYBRID_SEARCH_ENABLED=true` (default true)
- `RAG_FULLTEXT_WEIGHT=0.4` (FTS contribution to fusion, vector gets 0.6)

---

## 2. Reranking (Cohere)

### New Module: `backend/app/rag/reranking.py`

- `rerank_results(query, chunks, top_k=5)` — takes hybrid search results (top-20), calls Cohere Rerank API, returns top-5 reranked
- Uses `cohere.ClientV2` with `model="rerank-v3.5"`
- Graceful fallback: if Cohere API fails or is disabled, returns original results unchanged (log warning)

### Integration

- After hybrid fusion produces top-20, pass to reranker
- Reranker returns top-5 with Cohere relevance scores
- If reranking disabled, fusion results are truncated to top-5 as before

### New Dependency

- `cohere` added to `requirements.txt`

### Env Vars

- `RAG_RERANK_ENABLED=true` (default false — requires API key)
- `COHERE_API_KEY=""` — required when reranking enabled

---

## 3. Citation Highlighting

### LLM Prompt Changes

- When knowledge base results are injected, each chunk gets a numbered label: `[1] [filename.pdf]: chunk text...`
- System prompt instruction added: "When using information from the provided sources, cite them using [1], [2] etc. inline in your response."

### Source Data Enrichment

- Current sources only send `filename`. Enhanced sources include:
  - `citation_index` — numbered reference
  - `filename` — source document name
  - `chunk_excerpt` — first ~150 chars of chunk
  - `chunk_index` — position in document
  - `relevance_score` — final score after reranking/fusion
- SSE `sources` event payload updated with these fields

### Frontend Changes

- Parse `[1]`, `[2]` markers in rendered markdown as clickable badges
- Sources list at bottom of message shows numbered entries with document name + chunk excerpt
- Clicking a citation badge scrolls to / highlights the corresponding source entry

### No New Env Vars

Citations are always active when knowledge base is used.

---

## 4. Improved Chunking

### Enhanced `backend/app/rag/chunking.py`

- **Header-aware splitting**: Detect markdown headers (`#`, `##`) and HTML headings (`<h1>`-`<h6>`) as natural chunk boundaries — never split mid-section
- **Semantic paragraph grouping**: Instead of fixed 2-paragraph window, group paragraphs that belong to the same topic section (under the same header)
- **Chunk metadata**: Each chunk populates `metadata_json` with: `{"header": "Section Title", "position": "start|middle|end", "page": N}` for PDFs
- **Configurable overlap**: Sliding window overlap becomes a parameter instead of hardcoded step=1

### Backward Compatibility

- Existing chunks don't need re-processing
- New uploads use the improved strategy
- A future admin endpoint could trigger re-chunking if desired

### Env Vars

- `RAG_CHUNK_SIZE=500` (target tokens per chunk, default 500)
- `RAG_CHUNK_OVERLAP=50` (overlap tokens between chunks, default 50)
- `RAG_CHUNK_STRATEGY=semantic` (options: `semantic`, `fixed` for backward compat)

---

## 5. Configurability

### All Env Vars in `config.py`

```python
# Hybrid search
rag_hybrid_search_enabled: bool = True
rag_fulltext_weight: float = 0.4

# Reranking
rag_rerank_enabled: bool = False
cohere_api_key: str = ""

# Retrieval
rag_top_k: int = 5
rag_min_score: float = 0.65
rag_rerank_top_n: int = 20  # candidates fetched before reranking

# Chunking
rag_chunk_size: int = 500
rag_chunk_overlap: int = 50
rag_chunk_strategy: str = "semantic"  # "semantic" or "fixed"

# Embedding (existing, kept as-is)
embedding_model: str = "text-embedding-3-small"
embedding_api_key: str = ""
embedding_base_url: str = ""
```

### Flow Through Code

- `retrieval.py` reads settings to decide: hybrid on/off → rerank on/off → top_k
- `chunking.py` reads settings for strategy, size, overlap
- All via `.env` file, requires restart to change

---

## 6. README Updates

- Move "RAG enhancements" from planned to completed in roadmap
- Add "RAG Pipeline" section explaining each enhancement with descriptions
- Document all RAG-related env vars with defaults

---

## File Changes Summary

### New Files

- `backend/app/rag/fulltext.py` — full-text search module
- `backend/app/rag/reranking.py` — Cohere reranking module
- `backend/alembic/versions/XXXX_add_search_vector_to_chunks.py` — migration

### Modified Files

- `backend/app/rag/retrieval.py` — orchestrator for hybrid + rerank pipeline
- `backend/app/rag/chunking.py` — semantic chunking, header-aware, configurable
- `backend/app/rag/processing.py` — populate search_vector during processing
- `backend/app/rag/embeddings.py` — no changes expected
- `backend/app/config.py` — new RAG env vars
- `backend/app/models/document.py` — add search_vector column to DocumentChunk
- `backend/app/skills/executors.py` — citation formatting in knowledge base executor
- `backend/app/routers/chats.py` — enriched source payload in SSE events
- `backend/skills/tool_knowledge_base.md` — updated skill prompt with citation instructions
- `backend/requirements.txt` — add cohere
- `frontend/src/components/chat-messages.tsx` — citation badges + sources list
- `README.md` — roadmap update + RAG pipeline docs
