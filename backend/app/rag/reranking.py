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
