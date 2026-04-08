import json
from typing import Any, Dict, List

from duckduckgo_search import DDGS

from app.config import Settings
from app.rag.retrieval import search_knowledge_base as _search_kb


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


def tool_search_web(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """Search the web for current information using DuckDuckGo."""
    try:
        results = DDGS().text(query, max_results=max_results)
        return [
            {
                "type": "web",
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            }
            for r in results
        ]
    except Exception:
        return []
