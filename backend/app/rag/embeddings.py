import hashlib
import logging
from typing import Dict, List, Optional, Tuple

import openai

from app.config import Settings

logger = logging.getLogger(__name__)

# In-memory embedding cache: hash(text) -> embedding vector
# Survives across requests within the same process.
_embedding_cache: Dict[str, List[float]] = {}
_CACHE_MAX_SIZE = 10_000


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _embedding_client(settings: Settings) -> openai.AsyncOpenAI:
    api_key = settings.embedding_api_key or settings.openai_api_key
    base_url = settings.embedding_base_url or settings.openai_base_url
    return openai.AsyncOpenAI(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )


async def generate_embedding(text: str, settings: Settings) -> List[float]:
    """Generate embedding for a single text."""
    client = _embedding_client(settings)
    response = await client.embeddings.create(
        model=settings.embedding_model,
        input=text,
    )
    return response.data[0].embedding


async def generate_embeddings_batch(
    texts: List[str], settings: Settings
) -> List[List[float]]:
    """Generate embeddings for a batch of texts, skipping duplicates via cache."""
    if not texts:
        return []

    # Split into cached hits and texts that need API calls
    results: List[Optional[List[float]]] = [None] * len(texts)
    uncached: List[Tuple[int, str]] = []  # (original_index, text)

    for i, text in enumerate(texts):
        h = _text_hash(text)
        cached = _embedding_cache.get(h)
        if cached is not None:
            results[i] = cached
        else:
            uncached.append((i, text))

    if uncached:
        cache_hits = len(texts) - len(uncached)
        if cache_hits > 0:
            logger.info(
                "Embedding cache: %d hits, %d misses", cache_hits, len(uncached)
            )

        client = _embedding_client(settings)
        batch_size = 100
        uncached_texts = [t for _, t in uncached]
        all_new: List[List[float]] = []

        for j in range(0, len(uncached_texts), batch_size):
            batch = uncached_texts[j : j + batch_size]
            response = await client.embeddings.create(
                model=settings.embedding_model,
                input=batch,
            )
            all_new.extend([d.embedding for d in response.data])

        # Store in results and cache
        for (orig_idx, text), embedding in zip(uncached, all_new):
            results[orig_idx] = embedding
            if len(_embedding_cache) < _CACHE_MAX_SIZE:
                _embedding_cache[_text_hash(text)] = embedding

    return results  # type: ignore[return-value]
