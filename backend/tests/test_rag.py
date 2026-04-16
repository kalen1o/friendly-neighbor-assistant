import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import Settings
from app.rag.fulltext import search_fulltext
from app.rag.retrieval import search_knowledge_base
from app.rag.reranking import rerank_results
from app.rag.chunking import chunk_text, chunk_text_semantic
from app.skills.executors import execute_knowledge_base


def test_rag_settings_defaults():
    """RAG settings have correct defaults."""
    s = Settings(database_url="sqlite+aiosqlite:///:memory:", jwt_secret="test")
    assert s.rag_hybrid_search_enabled is True
    assert s.rag_fulltext_weight == 0.4
    assert s.rag_rerank_enabled is False
    assert s.cohere_api_key == ""
    assert s.rag_top_k == 5
    assert s.rag_min_score == 0.5
    assert s.rag_rerank_top_n == 20
    assert s.rag_chunk_size == 500
    assert s.rag_chunk_overlap == 50
    assert s.rag_chunk_strategy == "semantic"


# --- Task 3: Full-text search ---


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


# --- Task 4: Hybrid search with RRF ---


@pytest.mark.anyio
async def test_hybrid_search_fuses_vector_and_fulltext():
    """Hybrid search combines vector + FTS results via RRF."""
    vector_results = [
        {
            "id": 1,
            "text": "chunk A",
            "chunk_index": 0,
            "document_id": 10,
            "filename": "a.pdf",
            "score": 0.9,
        },
        {
            "id": 2,
            "text": "chunk B",
            "chunk_index": 1,
            "document_id": 10,
            "filename": "a.pdf",
            "score": 0.8,
        },
    ]
    fts_results = [
        {
            "id": 2,
            "text": "chunk B",
            "chunk_index": 1,
            "document_id": 10,
            "filename": "a.pdf",
            "rank": 0.7,
        },
        {
            "id": 3,
            "text": "chunk C",
            "chunk_index": 2,
            "document_id": 11,
            "filename": "b.pdf",
            "rank": 0.5,
        },
    ]

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:", jwt_secret="test")
    mock_db = AsyncMock()

    with (
        patch(
            "app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)
        ),
        patch("app.rag.retrieval.search_fulltext", AsyncMock(return_value=fts_results)),
    ):
        results = await search_knowledge_base("test query", mock_db, settings)

    # chunk B appears in both lists so should score highest
    assert len(results) >= 2
    ids = [r["id"] for r in results]
    assert 2 in ids
    assert 1 in ids
    for r in results:
        assert "score" in r
        assert r["score"] > 0


@pytest.mark.anyio
async def test_hybrid_search_disabled_falls_back_to_vector():
    """When hybrid search is disabled, only vector results are returned."""
    vector_results = [
        {
            "id": 1,
            "text": "chunk A",
            "chunk_index": 0,
            "document_id": 10,
            "filename": "a.pdf",
            "score": 0.9,
        },
    ]

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test",
        rag_hybrid_search_enabled=False,
    )
    mock_db = AsyncMock()

    with (
        patch(
            "app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)
        ),
        patch("app.rag.retrieval.search_fulltext", AsyncMock()) as mock_fts,
    ):
        results = await search_knowledge_base("test query", mock_db, settings)

    mock_fts.assert_not_called()
    assert len(results) == 1
    assert results[0]["id"] == 1


# --- Task 5: Cohere reranking ---


@pytest.mark.anyio
async def test_rerank_results_reorders_by_relevance():
    """Cohere reranking reorders chunks by relevance score."""
    chunks = [
        {"id": 1, "text": "less relevant chunk", "filename": "a.pdf", "score": 0.9},
        {"id": 2, "text": "more relevant chunk", "filename": "b.pdf", "score": 0.5},
    ]

    mock_rerank_result = MagicMock()
    result_0 = MagicMock()
    result_0.index = 1
    result_0.relevance_score = 0.95
    result_1 = MagicMock()
    result_1.index = 0
    result_1.relevance_score = 0.3
    mock_rerank_result.results = [result_0, result_1]

    mock_client = MagicMock()
    mock_client.rerank = MagicMock(return_value=mock_rerank_result)

    with patch("app.rag.reranking.cohere.ClientV2", return_value=mock_client):
        reranked = await rerank_results(
            "relevant query", chunks, api_key="test-key", top_k=2
        )

    assert len(reranked) == 2
    assert reranked[0]["id"] == 2
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

    assert len(reranked) == 2
    assert reranked[0]["id"] == 1
    assert reranked[1]["id"] == 2


@pytest.mark.anyio
async def test_search_knowledge_base_with_reranking():
    """Reranking is called when enabled with API key."""
    vector_results = [
        {
            "id": 1,
            "text": "chunk A",
            "chunk_index": 0,
            "document_id": 10,
            "filename": "a.pdf",
            "score": 0.9,
        },
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

    with (
        patch(
            "app.rag.retrieval._search_vector", AsyncMock(return_value=vector_results)
        ),
        patch("app.rag.retrieval.rerank_results", mock_rerank),
    ):
        results = await search_knowledge_base("test query", mock_db, settings)

    mock_rerank.assert_called_once()
    assert len(results) == 1


# --- Task 6: Semantic chunking ---


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
    assert len(chunks) >= 3
    assert any("Introduction" in c["text"] for c in chunks)
    assert any("Methods" in c["text"] for c in chunks)
    assert any("Results" in c["text"] for c in chunks)
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


# --- Task 8: Citation formatting ---


@pytest.mark.anyio
async def test_execute_knowledge_base_citation_format():
    """Knowledge base executor returns numbered citations."""
    mock_results = [
        {
            "type": "document",
            "text": "Python is interpreted.",
            "filename": "guide.pdf",
            "score": 0.9,
            "chunk_index": 0,
            "relevance_score": 0.9,
        },
        {
            "type": "document",
            "text": "Python supports OOP.",
            "filename": "guide.pdf",
            "score": 0.8,
            "chunk_index": 2,
            "relevance_score": 0.8,
        },
    ]

    with patch(
        "app.skills.executors.tool_search_knowledge_base",
        AsyncMock(return_value=mock_results),
    ):
        result = await execute_knowledge_base(
            "what is python", db=AsyncMock(), settings=MagicMock()
        )

    assert "[1]" in result["content"]
    assert "[2]" in result["content"]
    assert "guide.pdf" in result["content"]
    assert result["sources"][0]["citation_index"] == 1
    assert result["sources"][1]["citation_index"] == 2
    assert "chunk_excerpt" in result["sources"][0]
