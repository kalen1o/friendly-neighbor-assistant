import re
from typing import List

MIN_PARAGRAPH_TOKENS = 100
MAX_PARAGRAPH_TOKENS = 500
APPROX_CHARS_PER_TOKEN = 4


def _estimate_tokens(text: str) -> int:
    return len(text) // APPROX_CHARS_PER_TOKEN


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences."""
    parts = re.split(r"(?<=[.!?])\s+", text)
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
                if (
                    _estimate_tokens(current + " " + sentence) > MAX_PARAGRAPH_TOKENS
                    and current
                ):
                    normalized.append(current.strip())
                    current = sentence
                else:
                    current = (
                        (current + " " + sentence).strip() if current else sentence
                    )
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
            chunk_text_content = "## {}\n\n{}".format(header, body) if header else body
            chunks.append(
                {
                    "text": chunk_text_content,
                    "metadata": {"header": header, "position": "full"},
                }
            )
        else:
            # Split long sections into overlapping chunks
            paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
            current = ""
            position_idx = 0

            for para in paragraphs:
                candidate = (current + "\n\n" + para).strip() if current else para
                if _estimate_tokens(candidate) > chunk_size and current:
                    chunk_text_content = (
                        "## {}\n\n{}".format(header, current) if header else current
                    )
                    position = "start" if position_idx == 0 else "middle"
                    chunks.append(
                        {
                            "text": chunk_text_content,
                            "metadata": {"header": header, "position": position},
                        }
                    )
                    position_idx += 1
                    # Overlap: keep tail of current chunk
                    overlap_chars = chunk_overlap * APPROX_CHARS_PER_TOKEN
                    current = (
                        current[-overlap_chars:].strip() + "\n\n" + para
                        if overlap_chars < len(current)
                        else para
                    )
                else:
                    current = candidate

            if current.strip():
                chunk_text_content = (
                    "## {}\n\n{}".format(header, current) if header else current
                )
                position = "end" if position_idx > 0 else "full"
                chunks.append(
                    {
                        "text": chunk_text_content,
                        "metadata": {"header": header, "position": position},
                    }
                )

    return (
        chunks
        if chunks
        else [{"text": text.strip(), "metadata": {"header": "", "position": "full"}}]
    )
