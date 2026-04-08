from typing import List

import openai

from app.config import Settings


async def generate_embedding(text: str, settings: Settings) -> List[float]:
    """Generate embedding for a single text."""
    client = openai.AsyncOpenAI(
        api_key=settings.openai_api_key,
        **({"base_url": settings.openai_base_url} if settings.openai_base_url else {}),
    )
    response = await client.embeddings.create(
        model=settings.embedding_model,
        input=text,
    )
    return response.data[0].embedding


async def generate_embeddings_batch(texts: List[str], settings: Settings) -> List[List[float]]:
    """Generate embeddings for a batch of texts."""
    if not texts:
        return []

    client = openai.AsyncOpenAI(
        api_key=settings.openai_api_key,
        **({"base_url": settings.openai_base_url} if settings.openai_base_url else {}),
    )

    # OpenAI supports batches up to ~8000 tokens per request
    # Process in batches of 100 to be safe
    all_embeddings: List[List[float]] = []
    batch_size = 100

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = await client.embeddings.create(
            model=settings.embedding_model,
            input=batch,
        )
        all_embeddings.extend([d.embedding for d in response.data])

    return all_embeddings
