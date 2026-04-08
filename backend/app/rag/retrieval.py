from typing import Any, Dict, List

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.document import Document, DocumentChunk
from app.rag.embeddings import generate_embedding


async def search_knowledge_base(
    query: str,
    db: AsyncSession,
    settings: Settings,
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """Search document chunks by vector similarity."""
    query_embedding = await generate_embedding(query, settings)

    # Use raw SQL for pgvector cosine distance operator
    sql = text("""
        SELECT dc.id, dc.chunk_text, dc.chunk_index, dc.document_id,
               d.filename,
               1 - (dc.embedding <=> :embedding::vector) as score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.status = 'ready'
        ORDER BY dc.embedding <=> :embedding::vector
        LIMIT :top_k
    """)

    result = await db.execute(
        sql,
        {"embedding": str(query_embedding), "top_k": top_k},
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
