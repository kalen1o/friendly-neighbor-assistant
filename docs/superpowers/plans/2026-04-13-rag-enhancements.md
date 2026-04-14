# RAG Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the RAG pipeline with hybrid search, Cohere reranking, inline citation highlighting, semantic chunking, full configurability, and README documentation.

**Architecture:** Layered pipeline — each enhancement is an independent module under `backend/app/rag/` with its own env var toggle. The retrieval orchestrator calls each layer in sequence: hybrid search (vector + FTS with RRF fusion) -> reranking (Cohere) -> citation formatting. Chunking improvements are applied at document processing time.

**Tech Stack:** Python/FastAPI, PostgreSQL 16 + pgvector + tsvector, Cohere Rerank API, SQLAlchemy async, Next.js/React frontend, Alembic migrations.

---

## File Structure

### New Files
- `backend/app/rag/fulltext.py` — PostgreSQL full-text search queries
- `backend/app/rag/reranking.py` — Cohere reranking layer
- `backend/alembic/versions/0028_add_search_vector_to_chunks.py` — migration for tsvector column + GIN index
- `backend/tests/test_rag.py` — tests for all RAG enhancements

### Modified Files
- `backend/app/config.py` — new RAG env vars
- `backend/app/models/document.py` — add `search_vector` column to `DocumentChunk`
- `backend/app/rag/chunking.py` — semantic chunking with header awareness
- `backend/app/rag/processing.py` — populate search_vector, pass chunk metadata
- `backend/app/rag/retrieval.py` — orchestrate hybrid search + reranking pipeline
- `backend/app/skills/executors.py` — citation-formatted output from knowledge base
- `backend/app/agent/tools.py` — pass through enriched citation data
- `backend/skills/tool_knowledge_base.md` — citation instructions for LLM
- `backend/requirements.txt` — add `cohere`
- `frontend/src/lib/api.ts` — extend `Source` interface with citation fields
- `frontend/src/components/source-attribution.tsx` — numbered citations with excerpts
- `frontend/src/components/message-bubble.tsx` — parse `[N]` markers as clickable badges
- `README.md` — roadmap update + RAG pipeline documentation

---

### Task 1: Add RAG Configuration to Settings

**Files:**
- Modify: `backend/app/config.py:10-77`
- Test: `backend/tests/test_rag.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rag.py`:

```python
import pytest
from app.config import Settings


def test_rag_settings_defaults():
    """RAG settings have correct defaults."""
    s = Settings(database_url="sqlite+aiosqlite:///:memory:", jwt_secret="test")
    assert s.rag_hybrid_search_enabled is True
    assert s.rag_fulltext_weight == 0.4
    assert s.rag_rerank_enabled is False
    assert s.cohere_api_key == ""
    assert s.rag_top_k == 5
    assert s.rag_min_score == 0.65
    assert s.rag_rerank_top_n == 20
    assert s.rag_chunk_size == 500
    assert s.rag_chunk_overlap == 50
    assert s.rag_chunk_strategy == "semantic"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_rag.py::test_rag_settings_defaults -v`
Expected: FAIL with `AttributeError` — settings don't have RAG fields yet.

- [ ] **Step 3: Add RAG settings to config.py**

Add these fields to the `Settings` class in `backend/app/config.py` after the `embedding_base_url` field (line 23):

```python
    # RAG — hybrid search
    rag_hybrid_search_enabled: bool = True
    rag_fulltext_weight: float = 0.4

    # RAG — reranking
    rag_rerank_enabled: bool = False
    cohere_api_key: str = ""

    # RAG — retrieval
    rag_top_k: int = 5
    rag_min_score: float = 0.65
    rag_rerank_top_n: int = 20  # candidates fetched before reranking

    # RAG — chunking
    rag_chunk_size: int = 500
    rag_chunk_overlap: int = 50
    rag_chunk_strategy: str = "semantic"  # "semantic" or "fixed"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_rag.py::test_rag_settings_defaults -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_rag.py
git commit -m "feat(rag): add RAG configuration settings to config.py"
```

---

### Task 2: Database Migration — Add search_vector to DocumentChunk

**Files:**
- Create: `backend/alembic/versions/0028_add_search_vector_to_chunks.py`
- Modify: `backend/app/models/document.py:44-64`

- [ ] **Step 1: Create the Alembic migration**

Create `backend/alembic/versions/0028_add_search_vector_to_chunks.py`:

```python
"""add search_vector tsvector column to document_chunks

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL for tsvector type (SQLAlchemy doesn't natively support tsvector)
    op.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_search_vector "
        "ON document_chunks USING GIN (search_vector)"
    )
    # Backfill existing chunks
    op.execute(
        "UPDATE document_chunks SET search_vector = to_tsvector('english', chunk_text) "
        "WHERE search_vector IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_search_vector")
    op.drop_column("document_chunks", "search_vector")
```

- [ ] **Step 2: Add search_vector to the DocumentChunk model**

In `backend/app/models/document.py`, add to `DocumentChunk` class after the `metadata_json` field (line 61):

```python
    search_vector: Mapped[Optional[str]] = mapped_column(Text, default=None)
```

Note: We use `Text` in the ORM since SQLAlchemy doesn't have a native `tsvector` type. The actual column type is `tsvector` in Postgres, set by the migration. In SQLite tests this column will be a plain text column (unused).

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0028_add_search_vector_to_chunks.py backend/app/models/document.py
git commit -m "feat(rag): add tsvector search_vector column with GIN index"
```

---

### Task 3: Implement Full-Text Search Module

**Files:**
- Create: `backend/app/rag/fulltext.py`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rag.py`:

```python
from unittest.mock import AsyncMock, MagicMock

from app.rag.fulltext import search_fulltext


@pytest.mark.anyio
async def test_search_fulltext_returns_results():
    """Full-text search returns ranked results from tsvector."""
    mock_row = MagicMock()
    mock_row.id = 1
    mock_row.chunk_text = "Python is a programming language."
    mock_row.chunk_index = 0
    mock_row.document_id = 10
    mock_row.filename = "guide.pdf"
    mock_row.rank = 0.8

    mock_result = MagicMock()
    mock_result.fetchall.return_value = [mock_row]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)

    results = await search_fulltext("python programming", mock_db, top_k=5)

    assert len(results) == 1
    assert results[0]["id"] == 1
    assert results[0]["text"] == "Python is a programming language."
    assert results[0]["filename"] == "guide.pdf"
    assert results[0]["rank"] == 0.8
    mock_db.execute.assert_called_once()


@pytest.mark.anyio
async def test_search_fulltext_empty_query():
    """Full-text search with empty query returns empty list."""
    mock_db = AsyncMock()
    results = await search_fulltext("", mock_db)
    assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_rag.py::test_search_fulltext_returns_results tests/test_rag.py::test_search_fulltext_empty_query -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement fulltext.py**

Create `backend/app/rag/fulltext.py`:

```python
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def search_fulltext(
    query: str,
    db: AsyncSession,
    top_k: int = 20,
) -> List[Dict[str, Any]]:
    """Search document chunks using PostgreSQL full-text search."""
    if not query.strip():
        return []

    sql = text("""
        SELECT dc.id, dc.chunk_text, dc.chunk_index, dc.document_id,
               d.filename,
               ts_rank(dc.search_vector, plainto_tsquery('english', :query)) as rank
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.status = 'ready'
          AND dc.search_vector IS NOT NULL
          AND dc.search_vector @@ plainto_tsquery('english', :query)
        ORDER BY rank DESC
        LIMIT :top_k
    """)

    result = await db.execute(sql, {"query": query, "top_k": top_k})

    return [
        {
            "id": row.id,
            "text": row.chunk_text,
            "chunk_index": row.chunk_index,
            "document_id": row.document_id,
            "filename": row.filename,
            "rank": float(row.rank) if row.rank else 0.0,
        }
        for row in result.fetchall()
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_rag.py::test_search_fulltext_returns_results tests/test_rag.py::test_search_fulltext_empty_query -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/rag/fulltext.py backend/tests/test_rag.py
git commit -m "feat(rag): add PostgreSQL full-text search module"
```

---

### Task 4: Implement Hybrid Search with RRF Fusion in Retrieval

**Files:**
- Modify: `backend/app/rag/retrieval.py`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rag.py`:

```python
from unittest.mock import patch, AsyncMock
from app.rag.retrieval import search_knowledge_base


@pytest.mark.anyio
async def test_hybrid_search_fuses_vector_and_fulltext():
    """Hybrid search combines vector + FTS results via RRF."""
    vector_results = [
        {"id": 1, "text": "chunk A", "chunk_index": 0, "document_id": 10, "filename": "a.pdf", "score": 0.9},
        {"id": 2, "text": "chunk B", "chunk_index": 1, "document_id": 10, "filename": "a.pdf", "score": 0.8},
    ]
    fts_results = [
        {"id": 2, "text": "chunk B", "chunk_index": 1, "document_id": 10, "filename": "a.pdf", "rank": 0.7},
        {"id": 3, "text": "chunk C", "chunk_index": 2, "document_id": 11, "filename": "b.pdf", "rank": 0.5},
    ]

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:", jwt_secret="test")
    mock_db = AsyncMock()

    with patch("app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)), \
         patch("app.rag.retrieval.search_fulltext", AsyncMock(return_value=fts_results)):
        results = await search_knowledge_base("test query", mock_db, settings)

    # chunk B appears in both lists so should score highest
    assert len(results) >= 2
    ids = [r["id"] for r in results]
    assert 2 in ids  # chunk B (in both lists) should appear
    assert 1 in ids  # chunk A (vector only) should appear
    # All results should have a "score" key
    for r in results:
        assert "score" in r
        assert r["score"] > 0


@pytest.mark.anyio
async def test_hybrid_search_disabled_falls_back_to_vector():
    """When hybrid search is disabled, only vector results are returned."""
    vector_results = [
        {"id": 1, "text": "chunk A", "chunk_index": 0, "document_id": 10, "filename": "a.pdf", "score": 0.9},
    ]

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test",
        rag_hybrid_search_enabled=False,
    )
    mock_db = AsyncMock()

    with patch("app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)), \
         patch("app.rag.retrieval.search_fulltext", AsyncMock()) as mock_fts:
        results = await search_knowledge_base("test query", mock_db, settings)

    mock_fts.assert_not_called()
    assert len(results) == 1
    assert results[0]["id"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_rag.py::test_hybrid_search_fuses_vector_and_fulltext tests/test_rag.py::test_hybrid_search_disabled_falls_back_to_vector -v`
Expected: FAIL — `_search_vector` doesn't exist, `search_knowledge_base` doesn't support hybrid.

- [ ] **Step 3: Rewrite retrieval.py with hybrid search**

Replace `backend/app/rag/retrieval.py` with:

```python
import logging
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.rag.embeddings import generate_embedding
from app.rag.fulltext import search_fulltext

logger = logging.getLogger(__name__)

# RRF constant — standard value from the original RRF paper
RRF_K = 60


async def _search_vector(
    query: str,
    db: AsyncSession,
    settings: Settings,
    top_k: int = 20,
    min_score: float = 0.0,
) -> List[Dict[str, Any]]:
    """Search document chunks by vector similarity."""
    query_embedding = await generate_embedding(query, settings)

    sql = text("""
        SELECT dc.id, dc.chunk_text, dc.chunk_index, dc.document_id,
               d.filename,
               1 - (dc.embedding <=> :embedding::vector) as score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.status = 'ready'
          AND 1 - (dc.embedding <=> :embedding::vector) >= :min_score
        ORDER BY dc.embedding <=> :embedding::vector
        LIMIT :top_k
    """)

    result = await db.execute(
        sql,
        {"embedding": str(query_embedding), "top_k": top_k, "min_score": min_score},
    )

    return [
        {
            "id": row.id,
            "text": row.chunk_text,
            "chunk_index": row.chunk_index,
            "document_id": row.document_id,
            "filename": row.filename,
            "score": float(row.score) if row.score else 0.0,
        }
        for row in result.fetchall()
    ]


def _reciprocal_rank_fusion(
    vector_results: List[Dict[str, Any]],
    fts_results: List[Dict[str, Any]],
    vector_weight: float = 0.6,
    fts_weight: float = 0.4,
) -> List[Dict[str, Any]]:
    """Combine vector and full-text results using Reciprocal Rank Fusion."""
    scores: Dict[int, float] = {}
    chunks: Dict[int, Dict[str, Any]] = {}

    for rank, item in enumerate(vector_results):
        chunk_id = item["id"]
        scores[chunk_id] = scores.get(chunk_id, 0) + vector_weight / (RRF_K + rank + 1)
        chunks[chunk_id] = item

    for rank, item in enumerate(fts_results):
        chunk_id = item["id"]
        scores[chunk_id] = scores.get(chunk_id, 0) + fts_weight / (RRF_K + rank + 1)
        if chunk_id not in chunks:
            chunks[chunk_id] = item

    sorted_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [{**chunks[cid], "score": scores[cid]} for cid in sorted_ids]


async def search_knowledge_base(
    query: str,
    db: AsyncSession,
    settings: Settings,
    top_k: int | None = None,
) -> List[Dict[str, Any]]:
    """Search with hybrid (vector + FTS) and optional reranking."""
    top_k = top_k or settings.rag_top_k
    candidate_k = settings.rag_rerank_top_n  # fetch more candidates for reranking

    # Vector search always runs
    vector_results = await _search_vector(
        query, db, settings, top_k=candidate_k, min_score=settings.rag_min_score
    )

    if settings.rag_hybrid_search_enabled:
        fts_results = await search_fulltext(query, db, top_k=candidate_k)
        fused = _reciprocal_rank_fusion(
            vector_results,
            fts_results,
            vector_weight=1 - settings.rag_fulltext_weight,
            fts_weight=settings.rag_fulltext_weight,
        )
        logger.info("Hybrid search: %d vector + %d FTS -> %d fused", len(vector_results), len(fts_results), len(fused))
    else:
        fused = vector_results

    # Reranking is added in Task 5
    return fused[:top_k]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_rag.py::test_hybrid_search_fuses_vector_and_fulltext tests/test_rag.py::test_hybrid_search_disabled_falls_back_to_vector -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/rag/retrieval.py backend/tests/test_rag.py
git commit -m "feat(rag): hybrid search with vector + FTS and RRF fusion"
```

---

### Task 5: Implement Cohere Reranking

**Files:**
- Create: `backend/app/rag/reranking.py`
- Modify: `backend/app/rag/retrieval.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Add cohere to requirements.txt**

Add to `backend/requirements.txt` after the `openai` line:

```
cohere>=5.0.0
```

- [ ] **Step 2: Write the failing test for reranking module**

Add to `backend/tests/test_rag.py`:

```python
from app.rag.reranking import rerank_results


@pytest.mark.anyio
async def test_rerank_results_reorders_by_relevance():
    """Cohere reranking reorders chunks by relevance score."""
    chunks = [
        {"id": 1, "text": "less relevant chunk", "filename": "a.pdf", "score": 0.9},
        {"id": 2, "text": "more relevant chunk", "filename": "b.pdf", "score": 0.5},
    ]

    # Mock Cohere response: chunk index 1 scores higher
    mock_rerank_result = MagicMock()
    result_0 = MagicMock()
    result_0.index = 1  # "more relevant chunk"
    result_0.relevance_score = 0.95
    result_1 = MagicMock()
    result_1.index = 0  # "less relevant chunk"
    result_1.relevance_score = 0.3
    mock_rerank_result.results = [result_0, result_1]

    mock_client = MagicMock()
    mock_client.rerank = MagicMock(return_value=mock_rerank_result)

    with patch("app.rag.reranking.cohere.ClientV2", return_value=mock_client):
        reranked = await rerank_results("relevant query", chunks, api_key="test-key", top_k=2)

    assert len(reranked) == 2
    assert reranked[0]["id"] == 2  # "more relevant" is now first
    assert reranked[0]["relevance_score"] == 0.95
    assert reranked[1]["id"] == 1


@pytest.mark.anyio
async def test_rerank_results_fallback_on_error():
    """Reranking falls back to original order on API error."""
    chunks = [
        {"id": 1, "text": "chunk A", "filename": "a.pdf", "score": 0.9},
        {"id": 2, "text": "chunk B", "filename": "b.pdf", "score": 0.5},
    ]

    mock_client = MagicMock()
    mock_client.rerank = MagicMock(side_effect=Exception("API error"))

    with patch("app.rag.reranking.cohere.ClientV2", return_value=mock_client):
        reranked = await rerank_results("test", chunks, api_key="test-key", top_k=2)

    # Falls back to original order
    assert len(reranked) == 2
    assert reranked[0]["id"] == 1
    assert reranked[1]["id"] == 2
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_rag.py::test_rerank_results_reorders_by_relevance tests/test_rag.py::test_rerank_results_fallback_on_error -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement reranking.py**

Create `backend/app/rag/reranking.py`:

```python
import logging
from typing import Any, Dict, List

import cohere

logger = logging.getLogger(__name__)

RERANK_MODEL = "rerank-v3.5"


async def rerank_results(
    query: str,
    chunks: List[Dict[str, Any]],
    api_key: str,
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Rerank chunks using Cohere Rerank API. Falls back to original order on error."""
    if not chunks or not api_key:
        return chunks[:top_k]

    try:
        client = cohere.ClientV2(api_key=api_key)
        documents = [c["text"] for c in chunks]
        response = client.rerank(
            model=RERANK_MODEL,
            query=query,
            documents=documents,
            top_n=top_k,
        )

        reranked = []
        for result in response.results:
            chunk = {**chunks[result.index], "relevance_score": result.relevance_score}
            reranked.append(chunk)

        logger.info("Reranked %d -> %d chunks", len(chunks), len(reranked))
        return reranked

    except Exception:
        logger.exception("Cohere reranking failed, falling back to original order")
        return chunks[:top_k]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_rag.py::test_rerank_results_reorders_by_relevance tests/test_rag.py::test_rerank_results_fallback_on_error -v`
Expected: PASS

- [ ] **Step 6: Wire reranking into retrieval.py**

In `backend/app/rag/retrieval.py`, add the import at the top:

```python
from app.rag.reranking import rerank_results
```

Then replace the comment `# Reranking is added in Task 5` and the `return fused[:top_k]` line at the end of `search_knowledge_base` with:

```python
    # Reranking (optional)
    if settings.rag_rerank_enabled and settings.cohere_api_key:
        results = await rerank_results(query, fused, api_key=settings.cohere_api_key, top_k=top_k)
        logger.info("Reranked to %d results", len(results))
        return results

    return fused[:top_k]
```

- [ ] **Step 7: Write test for reranking integration in retrieval**

Add to `backend/tests/test_rag.py`:

```python
@pytest.mark.anyio
async def test_search_knowledge_base_with_reranking():
    """Reranking is called when enabled with API key."""
    vector_results = [
        {"id": 1, "text": "chunk A", "chunk_index": 0, "document_id": 10, "filename": "a.pdf", "score": 0.9},
    ]

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test",
        rag_rerank_enabled=True,
        cohere_api_key="test-key",
        rag_hybrid_search_enabled=False,
    )
    mock_db = AsyncMock()

    mock_rerank = AsyncMock(return_value=vector_results)

    with patch("app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)), \
         patch("app.rag.retrieval.rerank_results", mock_rerank):
        results = await search_knowledge_base("test query", mock_db, settings)

    mock_rerank.assert_called_once()
    assert len(results) == 1
```

- [ ] **Step 8: Run all RAG tests**

Run: `cd backend && python -m pytest tests/test_rag.py -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/rag/reranking.py backend/app/rag/retrieval.py backend/requirements.txt backend/tests/test_rag.py
git commit -m "feat(rag): add Cohere reranking with graceful fallback"
```

---

### Task 6: Implement Semantic Chunking

**Files:**
- Modify: `backend/app/rag/chunking.py`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write failing tests for semantic chunking**

Add to `backend/tests/test_rag.py`:

```python
from app.rag.chunking import chunk_text, chunk_text_semantic


def test_chunk_text_semantic_splits_on_headers():
    """Semantic chunking respects markdown headers as boundaries."""
    text = """# Introduction

This is the introduction paragraph with enough content to be meaningful.

# Methods

This describes the methods used in the study with sufficient detail.

# Results

The results show significant improvements in all measured metrics.
"""
    chunks = chunk_text_semantic(text, chunk_size=500, chunk_overlap=50)
    # Each header section should be its own chunk
    assert len(chunks) >= 3
    assert any("Introduction" in c["text"] for c in chunks)
    assert any("Methods" in c["text"] for c in chunks)
    assert any("Results" in c["text"] for c in chunks)
    # Each chunk should have metadata with header info
    for c in chunks:
        assert "metadata" in c
        assert "header" in c["metadata"]


def test_chunk_text_semantic_merges_short_sections():
    """Short sections under the same header are merged."""
    text = """# Overview

Short intro.

Also short.

Another short paragraph under the same header.
"""
    chunks = chunk_text_semantic(text, chunk_size=500, chunk_overlap=50)
    # All paragraphs are short and under one header — should be one chunk
    assert len(chunks) == 1
    assert "Overview" in chunks[0]["metadata"]["header"]


def test_chunk_text_semantic_handles_no_headers():
    """Text without headers falls back to paragraph-based chunking."""
    text = (
        "First paragraph with enough text to be meaningful and reach the minimum token threshold for chunking.\n\n"
        "Second paragraph also with enough content to stand on its own as a meaningful unit of text.\n\n"
        "Third paragraph providing additional context that rounds out this test document nicely."
    )
    chunks = chunk_text_semantic(text, chunk_size=200, chunk_overlap=50)
    assert len(chunks) >= 1
    for c in chunks:
        assert c["metadata"]["header"] == ""


def test_chunk_text_fixed_still_works():
    """Original fixed chunking function still works."""
    text = (
        "First paragraph with enough text.\n\n"
        "Second paragraph with enough text.\n\n"
        "Third paragraph with enough text."
    )
    chunks = chunk_text(text)
    assert len(chunks) >= 1
    assert isinstance(chunks[0], str)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_rag.py::test_chunk_text_semantic_splits_on_headers tests/test_rag.py::test_chunk_text_semantic_merges_short_sections tests/test_rag.py::test_chunk_text_semantic_handles_no_headers -v`
Expected: FAIL — `chunk_text_semantic` doesn't exist.

- [ ] **Step 3: Add semantic chunking to chunking.py**

Add to the end of `backend/app/rag/chunking.py` (keep existing `chunk_text` function intact):

```python
import json

# Header patterns for splitting
_MD_HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
_HTML_HEADER_RE = re.compile(r"<h([1-6])[^>]*>(.*?)</h\1>", re.IGNORECASE | re.DOTALL)


def _extract_sections(text: str) -> List[dict]:
    """Split text into sections based on headers (markdown or HTML)."""
    sections: List[dict] = []

    # Try markdown headers first
    headers = list(_MD_HEADER_RE.finditer(text))

    if not headers:
        # Try HTML headers
        headers = list(_HTML_HEADER_RE.finditer(text))
        if headers:
            for i, match in enumerate(headers):
                header_text = re.sub(r"<[^>]+>", "", match.group(2)).strip()
                start = match.end()
                end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
                body = text[start:end].strip()
                sections.append({"header": header_text, "body": body})
            return sections

    if headers:
        # Handle text before first header
        if headers[0].start() > 0:
            pre_text = text[: headers[0].start()].strip()
            if pre_text:
                sections.append({"header": "", "body": pre_text})

        for i, match in enumerate(headers):
            header_text = match.group(2).strip()
            start = match.end()
            end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
            body = text[start:end].strip()
            sections.append({"header": header_text, "body": body})
        return sections

    # No headers found — treat entire text as one section
    return [{"header": "", "body": text.strip()}]


def chunk_text_semantic(
    text: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> List[dict]:
    """Split text into chunks using header-aware semantic boundaries.

    Returns list of dicts: {"text": str, "metadata": {"header": str, "position": str}}
    """
    if not text.strip():
        return []

    sections = _extract_sections(text)
    chunks: List[dict] = []

    for section in sections:
        header = section["header"]
        body = section["body"]
        if not body.strip():
            continue

        tokens = _estimate_tokens(body)

        if tokens <= chunk_size:
            # Section fits in one chunk
            chunk_text_content = f"## {header}\n\n{body}" if header else body
            chunks.append({
                "text": chunk_text_content,
                "metadata": {"header": header, "position": "full"},
            })
        else:
            # Split long sections into overlapping chunks
            paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
            current = ""
            position_idx = 0

            for para in paragraphs:
                candidate = (current + "\n\n" + para).strip() if current else para
                if _estimate_tokens(candidate) > chunk_size and current:
                    chunk_text_content = f"## {header}\n\n{current}" if header else current
                    position = "start" if position_idx == 0 else "middle"
                    chunks.append({
                        "text": chunk_text_content,
                        "metadata": {"header": header, "position": position},
                    })
                    position_idx += 1
                    # Overlap: keep tail of current chunk
                    overlap_chars = chunk_overlap * APPROX_CHARS_PER_TOKEN
                    current = current[-overlap_chars:].strip() + "\n\n" + para if overlap_chars < len(current) else para
                else:
                    current = candidate

            if current.strip():
                chunk_text_content = f"## {header}\n\n{current}" if header else current
                position = "end" if position_idx > 0 else "full"
                chunks.append({
                    "text": chunk_text_content,
                    "metadata": {"header": header, "position": position},
                })

    return chunks if chunks else [{"text": text.strip(), "metadata": {"header": "", "position": "full"}}]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_rag.py::test_chunk_text_semantic_splits_on_headers tests/test_rag.py::test_chunk_text_semantic_merges_short_sections tests/test_rag.py::test_chunk_text_semantic_handles_no_headers tests/test_rag.py::test_chunk_text_fixed_still_works -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/rag/chunking.py backend/tests/test_rag.py
git commit -m "feat(rag): add header-aware semantic chunking"
```

---

### Task 7: Wire Semantic Chunking into Document Processing

**Files:**
- Modify: `backend/app/rag/processing.py`

- [ ] **Step 1: Update processing.py to use semantic chunking and populate search_vector**

Replace `backend/app/rag/processing.py` with:

```python
import json
import logging
import os

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.document import Document, DocumentChunk
from app.rag.chunking import chunk_text, chunk_text_semantic
from app.rag.embeddings import generate_embeddings_batch
from app.rag.parsing import extract_text

logger = logging.getLogger(__name__)


async def process_document(
    document_id: int,
    file_path: str,
    db: AsyncSession,
    settings: Settings,
) -> None:
    """Background task: parse file, chunk, embed, store in pgvector."""
    try:
        # Get document record
        result = await db.execute(select(Document).where(Document.id == document_id))
        doc = result.scalar_one_or_none()
        if not doc:
            logger.error(f"Document {document_id} not found")
            return

        # 1. Parse file
        logger.info(f"Parsing document {document_id}: {doc.filename}")
        raw_text = extract_text(file_path)
        if not raw_text.strip():
            doc.status = "failed"
            doc.error_message = "No text content extracted from file"
            await db.commit()
            return

        # 2. Chunk text (semantic or fixed based on config)
        logger.info(f"Chunking document {document_id} (strategy={settings.rag_chunk_strategy})")
        if settings.rag_chunk_strategy == "semantic":
            chunk_results = chunk_text_semantic(
                raw_text,
                chunk_size=settings.rag_chunk_size,
                chunk_overlap=settings.rag_chunk_overlap,
            )
            chunk_texts = [c["text"] for c in chunk_results]
            chunk_metadata = [c["metadata"] for c in chunk_results]
        else:
            chunk_texts = chunk_text(raw_text)
            chunk_metadata = [None] * len(chunk_texts)

        if not chunk_texts:
            doc.status = "failed"
            doc.error_message = "No chunks generated from text"
            await db.commit()
            return

        # 3. Generate embeddings
        logger.info(f"Generating embeddings for {len(chunk_texts)} chunks")
        embeddings = await generate_embeddings_batch(chunk_texts, settings)

        # 4. Store chunks with embeddings
        logger.info(f"Storing {len(chunk_texts)} chunks in database")
        for i, (chunk, embedding, meta) in enumerate(zip(chunk_texts, embeddings, chunk_metadata)):
            db_chunk = DocumentChunk(
                document_id=document_id,
                chunk_text=chunk,
                chunk_index=i,
                embedding=embedding,
                metadata_json=json.dumps(meta) if meta else None,
            )
            db.add(db_chunk)

        # 5. Update document status
        doc.status = "ready"
        doc.chunk_count = len(chunk_texts)
        await db.commit()

        # 6. Populate search_vector for full-text search (Postgres only)
        try:
            await db.execute(text(
                "UPDATE document_chunks SET search_vector = to_tsvector('english', chunk_text) "
                "WHERE document_id = :doc_id AND search_vector IS NULL"
            ), {"doc_id": document_id})
            await db.commit()
            logger.info(f"Populated search_vector for document {document_id}")
        except Exception:
            # SQLite in tests doesn't support tsvector — skip silently
            logger.debug("Could not populate search_vector (not PostgreSQL?)")

        logger.info(f"Document {document_id} processed: {len(chunk_texts)} chunks")

    except Exception as e:
        logger.exception(f"Failed to process document {document_id}")
        try:
            result = await db.execute(
                select(Document).where(Document.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                doc.status = "failed"
                doc.error_message = str(e)[:500]
                await db.commit()
        except Exception:
            logger.exception("Failed to update document status after error")

    finally:
        # Clean up uploaded file
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
```

- [ ] **Step 2: Run all RAG tests**

Run: `cd backend && python -m pytest tests/test_rag.py -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/rag/processing.py
git commit -m "feat(rag): wire semantic chunking and search_vector into processing"
```

---

### Task 8: Citation Formatting in Knowledge Base Executor

**Files:**
- Modify: `backend/app/skills/executors.py:37-53`
- Modify: `backend/app/agent/tools.py:18-34`
- Modify: `backend/skills/tool_knowledge_base.md`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rag.py`:

```python
from app.skills.executors import execute_knowledge_base


@pytest.mark.anyio
async def test_execute_knowledge_base_citation_format():
    """Knowledge base executor returns numbered citations."""
    mock_results = [
        {"type": "document", "text": "Python is interpreted.", "filename": "guide.pdf", "score": 0.9, "chunk_index": 0},
        {"type": "document", "text": "Python supports OOP.", "filename": "guide.pdf", "score": 0.8, "chunk_index": 2},
    ]

    with patch("app.skills.executors.tool_search_knowledge_base", AsyncMock(return_value=mock_results)):
        result = await execute_knowledge_base("what is python", db=AsyncMock(), settings=MagicMock())

    # Content should have numbered citations
    assert "[1]" in result["content"]
    assert "[2]" in result["content"]
    assert "guide.pdf" in result["content"]
    # Sources should have citation_index
    assert result["sources"][0]["citation_index"] == 1
    assert result["sources"][1]["citation_index"] == 2
    # Sources should have chunk_excerpt
    assert "chunk_excerpt" in result["sources"][0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_rag.py::test_execute_knowledge_base_citation_format -v`
Expected: FAIL — no `citation_index` in sources, no `[1]` in content.

- [ ] **Step 3: Update tool_search_knowledge_base in agent/tools.py**

Replace the `tool_search_knowledge_base` function in `backend/app/agent/tools.py`:

```python
async def tool_search_knowledge_base(
    query: str,
    db,
    settings: Settings,
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Search the user's uploaded documents for relevant information."""
    results = await _search_kb(query, db, settings, top_k)
    return [
        {
            "type": "document",
            "text": r["text"],
            "filename": r["filename"],
            "score": round(r["score"], 3),
            "chunk_index": r.get("chunk_index", 0),
            "relevance_score": round(r.get("relevance_score", r["score"]), 3),
        }
        for r in results
    ]
```

- [ ] **Step 4: Update execute_knowledge_base in executors.py**

Replace the `execute_knowledge_base` function in `backend/app/skills/executors.py`:

```python
async def execute_knowledge_base(
    query: str, db, settings: Settings, **kwargs
) -> Dict[str, Any]:
    """Execute knowledge base search skill with numbered citations."""
    top_k = kwargs.get("top_k", 5)
    results = await tool_search_knowledge_base(query, db, settings, top_k=top_k)
    if not results:
        return {"content": "No relevant documents found.", "sources": []}

    content_parts = []
    sources = []
    for i, r in enumerate(results, 1):
        content_parts.append(f"[{i}] [{r['filename']}]: {r['text']}")
        sources.append({
            **r,
            "citation_index": i,
            "chunk_excerpt": r["text"][:150],
        })

    return {
        "content": "\n\n".join(content_parts),
        "sources": sources,
    }
```

- [ ] **Step 5: Update the knowledge base skill prompt**

Replace `backend/skills/tool_knowledge_base.md`:

```markdown
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_rag.py::test_execute_knowledge_base_citation_format -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/skills/executors.py backend/app/agent/tools.py backend/skills/tool_knowledge_base.md backend/tests/test_rag.py
git commit -m "feat(rag): numbered citation formatting in knowledge base results"
```

---

### Task 9: Frontend — Citation Badges and Enhanced Sources

**Files:**
- Modify: `frontend/src/lib/api.ts:131-141`
- Modify: `frontend/src/components/source-attribution.tsx`
- Modify: `frontend/src/components/message-bubble.tsx`

- [ ] **Step 1: Extend the Source interface**

In `frontend/src/lib/api.ts`, replace the `Source` interface:

```typescript
export interface Source {
  type: "document" | "web" | "skill";
  text?: string;
  filename?: string;
  score?: number;
  title?: string;
  url?: string;
  snippet?: string;
  tool?: string;
  params?: Record<string, unknown>;
  // Citation enhancements
  citation_index?: number;
  chunk_excerpt?: string;
  chunk_index?: number;
  relevance_score?: number;
}
```

- [ ] **Step 2: Update source-attribution.tsx with numbered citations and excerpts**

Replace `frontend/src/components/source-attribution.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Coins, FileText, Globe, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Source, MessageMetrics } from "@/lib/api";

interface SourceAttributionProps {
  sources: Source[];
  metrics?: MessageMetrics | null;
}

export function SourceAttribution({ sources, metrics }: SourceAttributionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasSources = sources && sources.length > 0;
  if (!hasSources && !metrics) return null;

  return (
    <div className="ml-1">
      <div className="flex items-center gap-2">
        {hasSources && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {sources.length} {sources.length === 1 ? "source" : "sources"}
          </button>
        )}
        {metrics && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            {metrics.latency !== undefined && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {metrics.latency}s
              </span>
            )}
            {metrics.tokens_total !== undefined && (
              <span className="flex items-center gap-0.5">
                <Coins className="h-2.5 w-2.5" />
                {metrics.tokens_input}+{metrics.tokens_output}={metrics.tokens_total}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
            {sources.map((source, i) => (
              <div key={i} id={`source-${source.citation_index ?? i + 1}`} className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 text-xs">
                {source.type === "document" ? (
                  <>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {source.citation_index && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                          {source.citation_index}
                        </span>
                      )}
                      <FileText className="h-3 w-3 text-primary/70" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{source.filename}</span>
                        {source.relevance_score !== undefined ? (
                          <span className="text-muted-foreground/50">
                            {Math.round(source.relevance_score * 100)}%
                          </span>
                        ) : source.score !== undefined ? (
                          <span className="text-muted-foreground/50">
                            {Math.round(source.score * 100)}%
                          </span>
                        ) : null}
                      </div>
                      {source.chunk_excerpt && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                          {source.chunk_excerpt}
                        </p>
                      )}
                    </div>
                  </>
                ) : source.type === "skill" ? (
                  <div className="flex items-center gap-1.5">
                    <Wrench className="h-3 w-3 shrink-0 text-primary/70" />
                    <span className="truncate">{source.tool?.replace(/_/g, " ") || "skill"}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3 shrink-0 text-primary/70" />
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate hover:underline"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="truncate">{source.title}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add citation badge rendering to message-bubble.tsx**

In `frontend/src/components/message-bubble.tsx`, find the `mdComponents` object and add a custom `a` handler for citation links. Add this inside `mdComponents` (after the `strong` component around line 110):

```tsx
  // Render [N] citation references as clickable badges
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {children}
      </a>
    );
  },
```

Then in the same file, find where `ReactMarkdown` renders the content (around line 236) and add citation badge pre-processing. Add this helper function before the `MessageBubble` component:

```tsx
function processCitations(content: string): string {
  // Convert [1], [2] etc. into anchor links that scroll to the source
  return content.replace(/\[(\d+)\]/g, (match, num) => {
    return `[<sup>${num}</sup>](#source-${num})`;
  });
}
```

Then update the non-streaming markdown rendering section (around line 236) to use it:

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
  {processCitations(content)}
</ReactMarkdown>
```

Note: The `processCitations` function transforms `[1]` markers into superscript links that point to `#source-1` anchors, which match the `id="source-1"` on the source attribution entries.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/source-attribution.tsx frontend/src/components/message-bubble.tsx
git commit -m "feat(rag): citation badges and enhanced source attribution in UI"
```

---

### Task 10: Update README with RAG Enhancements

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the RAG Knowledge Base section**

In `README.md`, find the `### RAG Knowledge Base` section and replace it:

```markdown
### RAG Knowledge Base
- **Document upload** — PDF, DOCX, TXT, Markdown, HTML, CSV
- **Semantic chunking** — Header-aware splitting with configurable chunk size and overlap
- **Vector embeddings** — OpenAI `text-embedding-3-small`, stored in pgvector
- **Hybrid search** — Combines vector similarity with PostgreSQL full-text search via Reciprocal Rank Fusion (RRF)
- **Cohere reranking** — Optional two-stage retrieval using Cohere Rerank API for higher precision
- **Inline citations** — Numbered `[1]`, `[2]` markers in responses with clickable source excerpts
- **Background processing** — Upload returns immediately, processing runs async
```

- [ ] **Step 2: Add RAG Pipeline section after the RAG Knowledge Base section**

Add a new section explaining each enhancement:

```markdown
### RAG Pipeline Details

The retrieval pipeline processes queries through multiple stages, each independently toggleable:

```
Query → Hybrid Search (vector + FTS → RRF fusion) → Reranking (Cohere) → Citation Formatting → LLM
```

**Hybrid Search** combines two retrieval methods for better recall:
- **Vector search** uses cosine similarity on pgvector embeddings to find semantically similar chunks
- **Full-text search** uses PostgreSQL `tsvector`/`tsquery` for keyword matching (exact terms, acronyms, names)
- Results are fused via **Reciprocal Rank Fusion (RRF)**, a proven method that combines ranked lists without needing score normalization

**Cohere Reranking** adds a second-stage relevance filter:
- First stage retrieves top-20 candidates via hybrid search
- Cohere's cross-encoder (`rerank-v3.5`) scores each (query, chunk) pair for precise relevance
- Returns the top-5 most relevant chunks — significantly more accurate than similarity alone

**Citation Highlighting** provides source transparency:
- Each retrieved chunk gets a numbered label `[1]`, `[2]` in the LLM context
- The LLM is instructed to cite sources inline when drawing from them
- Frontend renders citations as clickable superscript badges that link to source excerpts

**Semantic Chunking** splits documents at natural boundaries:
- Detects markdown headers (`#`, `##`) and HTML headings as section boundaries
- Groups content under the same header into a single chunk when it fits
- Falls back to paragraph-based splitting for headerless text
- Populates chunk metadata (header title, position) for future filtering

#### RAG Configuration

All RAG settings are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_HYBRID_SEARCH_ENABLED` | `true` | Enable hybrid (vector + full-text) search |
| `RAG_FULLTEXT_WEIGHT` | `0.4` | Weight of full-text search in RRF fusion (vector gets 1 - this) |
| `RAG_RERANK_ENABLED` | `false` | Enable Cohere reranking (requires API key) |
| `COHERE_API_KEY` | `""` | Cohere API key for reranking |
| `RAG_TOP_K` | `5` | Number of results returned to the LLM |
| `RAG_MIN_SCORE` | `0.65` | Minimum vector similarity score |
| `RAG_RERANK_TOP_N` | `20` | Number of candidates fetched before reranking |
| `RAG_CHUNK_SIZE` | `500` | Target tokens per chunk |
| `RAG_CHUNK_OVERLAP` | `50` | Overlap tokens between consecutive chunks |
| `RAG_CHUNK_STRATEGY` | `semantic` | Chunking strategy: `semantic` (header-aware) or `fixed` (paragraph window) |
```

- [ ] **Step 3: Update the Roadmap section**

In the Roadmap section, replace:

```markdown
- [ ] RAG enhancements — hybrid search, re-ranking, citation highlighting
```

with:

```markdown
- [x] RAG enhancements — hybrid search (Postgres FTS + RRF), Cohere reranking, inline citations, semantic chunking, configurable pipeline
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add RAG pipeline documentation and update roadmap"
```

---

### Task 11: Run Full Test Suite

- [ ] **Step 1: Run all RAG tests**

Run: `cd backend && python -m pytest tests/test_rag.py -v`
Expected: All PASS

- [ ] **Step 2: Run existing test suite to check for regressions**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All existing tests still pass

- [ ] **Step 3: Final commit if any fixes were needed**

Only if fixes were required in previous steps.
