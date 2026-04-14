import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.document import Document, DocumentChunk
from app.rag.embeddings import generate_embedding
from app.rag.fulltext import search_fulltext
from app.rag.reranking import rerank_results

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
    """Search document chunks by vector similarity using ORM."""
    query_embedding = await generate_embedding(query, settings)

    # Use pgvector's cosine_distance via ORM instead of raw SQL
    # This avoids the ::vector cast issue with asyncpg parameter binding
    distance = DocumentChunk.embedding.cosine_distance(query_embedding)
    score_expr = (1 - distance).label("score")

    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.chunk_text,
            DocumentChunk.chunk_index,
            DocumentChunk.document_id,
            Document.filename,
            score_expr,
        )
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(Document.status == "ready")
        .where((1 - distance) >= min_score)
        .order_by(distance)
        .limit(top_k)
    )

    result = await db.execute(stmt)

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
    top_k: Optional[int] = None,
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
        logger.info(
            "Hybrid search: %d vector + %d FTS -> %d fused",
            len(vector_results), len(fts_results), len(fused),
        )
    else:
        fused = vector_results

    # Reranking (optional)
    if settings.rag_rerank_enabled and settings.cohere_api_key:
        results = await rerank_results(
            query, fused, api_key=settings.cohere_api_key, top_k=top_k
        )
        logger.info("Reranked to %d results", len(results))
        return results

    return fused[:top_k]
