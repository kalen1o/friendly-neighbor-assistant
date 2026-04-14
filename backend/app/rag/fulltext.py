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
