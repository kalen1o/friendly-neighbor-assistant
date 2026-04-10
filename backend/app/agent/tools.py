import logging
import re
from typing import Any, Dict, List

import httpx

try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

from app.config import Settings
from app.rag.retrieval import search_knowledge_base as _search_kb

logger = logging.getLogger(__name__)


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
        }
        for r in results
    ]


def _extract_text_from_html(html: str, max_chars: int = 3000) -> str:
    """Extract readable text from HTML, strip tags and excess whitespace."""
    # Remove script and style blocks
    text = re.sub(
        r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE
    )
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode common HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", '"')
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


async def _fetch_page_content(url: str, timeout: float = 5.0) -> str:
    """Fetch a URL and extract text content. Returns empty string on failure."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; FriendlyNeighborBot/1.0)"
                },
            )
            if resp.status_code == 200:
                return _extract_text_from_html(resp.text)
    except Exception as e:
        logger.debug(f"Failed to fetch {url}: {e}")
    return ""


async def tool_search_web(
    query: str, max_results: int = 3, fetch_top: int = 1
) -> List[Dict[str, Any]]:
    """Search the web and fetch content from top results for fresh data."""
    try:
        results = DDGS().text(query, max_results=max_results)
    except Exception:
        return []

    enriched = []
    for i, r in enumerate(results):
        entry = {
            "type": "web",
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "snippet": r.get("body", ""),
        }

        # Fetch actual page content for top results
        if i < fetch_top and entry["url"]:
            page_content = await _fetch_page_content(entry["url"])
            if page_content:
                entry["content"] = page_content
                logger.info(f"Fetched {len(page_content)} chars from {entry['url']}")

        enriched.append(entry)

    return enriched
