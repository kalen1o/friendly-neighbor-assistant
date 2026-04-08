import re
from typing import List

MIN_PARAGRAPH_TOKENS = 100
MAX_PARAGRAPH_TOKENS = 500
APPROX_CHARS_PER_TOKEN = 4


def _estimate_tokens(text: str) -> int:
    return len(text) // APPROX_CHARS_PER_TOKEN


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences."""
    parts = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in parts if s.strip()]


def _normalize_paragraphs(raw_paragraphs: List[str]) -> List[str]:
    """Merge short paragraphs and split long ones to stay within token budget."""
    normalized: List[str] = []

    buffer = ""
    for para in raw_paragraphs:
        tokens = _estimate_tokens(para)

        if tokens > MAX_PARAGRAPH_TOKENS:
            # Flush buffer first
            if buffer:
                normalized.append(buffer.strip())
                buffer = ""

            # Split long paragraph at sentence boundaries
            sentences = _split_sentences(para)
            current = ""
            for sentence in sentences:
                if _estimate_tokens(current + " " + sentence) > MAX_PARAGRAPH_TOKENS and current:
                    normalized.append(current.strip())
                    current = sentence
                else:
                    current = (current + " " + sentence).strip() if current else sentence
            if current:
                normalized.append(current.strip())

        elif _estimate_tokens(buffer + "\n\n" + para) < MIN_PARAGRAPH_TOKENS:
            # Too short — merge with buffer
            buffer = (buffer + "\n\n" + para).strip() if buffer else para

        else:
            # Buffer is big enough — flush it
            if buffer:
                normalized.append(buffer.strip())
            buffer = para

    # Flush remaining buffer
    if buffer:
        normalized.append(buffer.strip())

    return normalized


def chunk_text(text: str, paragraphs_per_chunk: int = 2) -> List[str]:
    """Split text into overlapping chunks using a sliding window over paragraphs.

    Strategy:
    1. Split text into paragraphs (on double newlines)
    2. Normalize: merge short paragraphs (<100 tokens), split long ones (>500 tokens)
    3. Sliding window of `paragraphs_per_chunk`, stepping by 1

    Example with normalized paragraphs A, B, C, D and paragraphs_per_chunk=2:
        Chunk 1: A + B
        Chunk 2: B + C
        Chunk 3: C + D
    """
    if not text.strip():
        return []

    # Split on double newlines
    raw_paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    if not raw_paragraphs:
        return []

    # Normalize paragraph sizes
    paragraphs = _normalize_paragraphs(raw_paragraphs)

    if not paragraphs:
        return []

    # If fewer paragraphs than window size, return all as one chunk
    if len(paragraphs) <= paragraphs_per_chunk:
        return ["\n\n".join(paragraphs)]

    # Sliding window: step by 1 paragraph
    chunks: List[str] = []
    for i in range(len(paragraphs) - paragraphs_per_chunk + 1):
        window = paragraphs[i : i + paragraphs_per_chunk]
        chunks.append("\n\n".join(window))

    return chunks
