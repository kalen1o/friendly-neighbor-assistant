import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.cache.redis import cache_delete, cache_get_json, cache_set_json

logger = logging.getLogger(__name__)

MCP_TOOLS_CACHE_PREFIX = "mcp:tools:"
MCP_TOOLS_CACHE_TTL = 3600  # 1 hour


async def discover_tools(
    server_url: str,
    auth_type: str = "none",
    auth_token: Optional[str] = None,
    server_id: Optional[int] = None,
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    """Connect to an MCP server and discover available tools.

    Checks Redis cache first. If miss, fetches from server and caches.
    """
    cache_key = f"{MCP_TOOLS_CACHE_PREFIX}{server_id or server_url}"

    # Check cache
    if use_cache and server_id:
        cached = await cache_get_json(cache_key)
        if cached is not None:
            logger.info(f"MCP tools cache hit for server {server_id}")
            return cached

    # Fetch from MCP server
    headers = {"Content-Type": "application/json"}
    if auth_type == "bearer" and auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # MCP uses JSON-RPC format
            response = await client.post(
                server_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {},
                },
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            # MCP response: {"result": {"tools": [...]}}
            tools = data.get("result", {}).get("tools", [])

            # Cache the result
            if server_id:
                await cache_set_json(cache_key, tools, MCP_TOOLS_CACHE_TTL)
                logger.info(f"MCP tools cached for server {server_id}: {len(tools)} tools")

            return tools

    except Exception as e:
        logger.error(f"Failed to discover MCP tools from {server_url}: {e}")
        return []


async def call_tool(
    server_url: str,
    tool_name: str,
    arguments: Dict[str, Any],
    auth_type: str = "none",
    auth_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Call a tool on an MCP server."""
    headers = {"Content-Type": "application/json"}
    if auth_type == "bearer" and auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                server_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                },
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            result = data.get("result", {})
            # MCP tool results have "content" array
            content_parts = result.get("content", [])
            text_parts = [
                c.get("text", "") for c in content_parts if c.get("type") == "text"
            ]
            return {
                "content": "\n".join(text_parts) if text_parts else json.dumps(result),
                "raw": result,
            }

    except Exception as e:
        logger.error(f"MCP tool call failed ({tool_name} on {server_url}): {e}")
        return {"content": f"MCP tool call failed: {str(e)}", "raw": {}}


async def invalidate_cache(server_id: int):
    """Invalidate the tools cache for a server."""
    cache_key = f"{MCP_TOOLS_CACHE_PREFIX}{server_id}"
    await cache_delete(cache_key)
    logger.info(f"MCP tools cache invalidated for server {server_id}")
