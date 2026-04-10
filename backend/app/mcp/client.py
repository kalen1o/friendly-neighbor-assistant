import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.cache.redis import cache_delete, cache_get_json, cache_set_json

logger = logging.getLogger(__name__)

MCP_TOOLS_CACHE_PREFIX = "mcp:tools:"
MCP_TOOLS_CACHE_TTL = 3600  # 1 hour


def _build_headers(
    auth_type: str = "none",
    auth_token: Optional[str] = None,
    auth_header: Optional[str] = None,
) -> Dict[str, str]:
    """Build auth headers for MCP server requests.

    Supports:
      - none: no auth
      - bearer: Authorization: Bearer <token>
      - custom: <auth_header>: <token> (e.g. CONTEXT7_API_KEY: xxx)
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if auth_type == "none" or not auth_token:
        return headers
    if auth_type == "bearer":
        if auth_header:
            # Custom header name (e.g. "CONTEXT7_API_KEY")
            headers[auth_header] = auth_token
        else:
            headers["Authorization"] = f"Bearer {auth_token}"
    elif auth_type == "custom" and auth_header:
        headers[auth_header] = auth_token
    return headers


async def _mcp_request(
    server_url: str,
    method: str,
    params: Dict[str, Any],
    headers: Dict[str, str],
    timeout: float = 15.0,
) -> Dict[str, Any]:
    """Send a JSON-RPC request to an MCP server.

    Tries direct POST first. If that fails (SSE servers return different content type),
    falls back to SSE-based communication.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        # Try direct JSON-RPC POST
        try:
            response = await client.post(server_url, json=payload, headers=headers)

            content_type = response.headers.get("content-type", "")

            # Standard JSON response
            if "application/json" in content_type:
                data = response.json()
                return data.get("result", data)

            # SSE response — parse the event stream
            if "text/event-stream" in content_type:
                return _parse_sse_response(response.text)

            # Try parsing as JSON anyway
            try:
                data = response.json()
                return data.get("result", data)
            except json.JSONDecodeError:
                pass

            # If POST returns HTML or redirect, try GET for SSE endpoint
            response.raise_for_status()
            return {}

        except httpx.HTTPStatusError as e:
            logger.error(f"MCP request failed: {e.response.status_code} {e.response.text[:200]}")
            raise
        except Exception as e:
            logger.error(f"MCP request error for {method} on {server_url}: {e}")
            raise


def _parse_sse_response(text: str) -> Dict[str, Any]:
    """Parse an SSE response body to extract JSON-RPC result."""
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            data_str = line[5:].strip()
            if data_str:
                try:
                    data = json.loads(data_str)
                    if "result" in data:
                        return data["result"]
                    return data
                except json.JSONDecodeError:
                    continue
    return {}


async def discover_tools(
    server_url: str,
    auth_type: str = "none",
    auth_token: Optional[str] = None,
    auth_header: Optional[str] = None,
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

    headers = _build_headers(auth_type, auth_token, auth_header)

    try:
        result = await _mcp_request(server_url, "tools/list", {}, headers)
        tools = result.get("tools", []) if isinstance(result, dict) else []

        # Cache the result
        if server_id and tools:
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
    auth_header: Optional[str] = None,
) -> Dict[str, Any]:
    """Call a tool on an MCP server."""
    headers = _build_headers(auth_type, auth_token, auth_header)

    try:
        result = await _mcp_request(
            server_url,
            "tools/call",
            {"name": tool_name, "arguments": arguments},
            headers,
            timeout=30.0,
        )

        # MCP tool results have "content" array
        content_parts = result.get("content", []) if isinstance(result, dict) else []
        text_parts = [
            c.get("text", "") for c in content_parts if isinstance(c, dict) and c.get("type") == "text"
        ]
        return {
            "content": "\n".join(text_parts) if text_parts else json.dumps(result),
            "raw": result,
        }

    except Exception as e:
        logger.error(f"MCP tool call failed ({tool_name} on {server_url}): {e}")
        return {"content": f"MCP tool call failed: {str(e)}", "raw": {}}


async def test_connection(
    server_url: str,
    auth_type: str = "none",
    auth_token: Optional[str] = None,
    auth_header: Optional[str] = None,
) -> Dict[str, Any]:
    """Test connection to an MCP server. Returns status and tool count."""
    try:
        tools = await discover_tools(
            server_url, auth_type, auth_token, auth_header, use_cache=False
        )
        return {"status": "connected", "tool_count": len(tools)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def invalidate_cache(server_id: int):
    """Invalidate the tools cache for a server."""
    cache_key = f"{MCP_TOOLS_CACHE_PREFIX}{server_id}"
    await cache_delete(cache_key)
    logger.info(f"MCP tools cache invalidated for server {server_id}")
