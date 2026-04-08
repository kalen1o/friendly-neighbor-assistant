import json
import logging
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.mcp.client import call_tool, discover_tools, invalidate_cache
from app.models.mcp import McpServer, McpTool

logger = logging.getLogger(__name__)


async def add_server(
    db: AsyncSession,
    name: str,
    url: str,
    description: str = "",
    auth_type: str = "none",
    auth_token: str = None,
) -> McpServer:
    """Add a new MCP server and discover its tools."""
    server = McpServer(
        name=name,
        url=url,
        description=description,
        auth_type=auth_type,
        auth_token=auth_token,
        enabled=True,
    )
    db.add(server)
    await db.commit()
    await db.refresh(server)

    # Discover and save tools
    await refresh_server_tools(db, server)

    return server


async def refresh_server_tools(db: AsyncSession, server: McpServer) -> List[McpTool]:
    """Fetch tools from MCP server and sync with DB."""
    # Invalidate cache
    await invalidate_cache(server.id)

    # Discover tools from server
    raw_tools = await discover_tools(
        server_url=server.url,
        auth_type=server.auth_type,
        auth_token=server.auth_token,
        server_id=server.id,
        use_cache=False,
    )

    # Get existing tools for this server
    result = await db.execute(
        select(McpTool).where(McpTool.server_id == server.id)
    )
    existing_tools = {t.tool_name: t for t in result.scalars().all()}

    # Sync: add new, update existing, remove deleted
    remote_names = set()
    new_tools = []

    for tool_data in raw_tools:
        tool_name = tool_data.get("name", "")
        if not tool_name:
            continue
        remote_names.add(tool_name)

        input_schema = json.dumps(tool_data.get("inputSchema", {}))
        description = tool_data.get("description", "")

        if tool_name in existing_tools:
            # Update existing
            existing = existing_tools[tool_name]
            existing.description = description
            existing.input_schema = input_schema
        else:
            # Add new (disabled by default)
            new_tool = McpTool(
                server_id=server.id,
                tool_name=tool_name,
                description=description,
                input_schema=input_schema,
                enabled=False,
            )
            db.add(new_tool)
            new_tools.append(new_tool)

    # Remove tools that no longer exist on the server
    for name, tool in existing_tools.items():
        if name not in remote_names:
            await db.delete(tool)

    await db.commit()

    # Return all current tools
    result = await db.execute(
        select(McpTool).where(McpTool.server_id == server.id)
    )
    return result.scalars().all()


async def get_enabled_mcp_tools(db: AsyncSession) -> List[Dict[str, Any]]:
    """Get all enabled MCP tools with their server info. For skill registry."""
    result = await db.execute(
        select(McpTool)
        .where(McpTool.enabled == True)  # noqa: E712
        .options(selectinload(McpTool.server))
    )
    tools = result.scalars().all()

    return [
        {
            "tool_name": t.tool_name,
            "description": t.description or "",
            "input_schema": json.loads(t.input_schema) if t.input_schema else {},
            "server_url": t.server.url,
            "server_auth_type": t.server.auth_type,
            "server_auth_token": t.server.auth_token,
        }
        for t in tools
        if t.server and t.server.enabled
    ]


async def execute_mcp_tool(
    tool_name: str,
    arguments: Dict[str, Any],
    db: AsyncSession,
) -> Dict[str, Any]:
    """Execute an MCP tool by name. Looks up the server and calls it."""
    result = await db.execute(
        select(McpTool)
        .where(McpTool.tool_name == tool_name, McpTool.enabled == True)  # noqa: E712
        .options(selectinload(McpTool.server))
    )
    tool = result.scalar_one_or_none()

    if not tool or not tool.server:
        return {"content": f"MCP tool '{tool_name}' not found or disabled", "sources": []}

    call_result = await call_tool(
        server_url=tool.server.url,
        tool_name=tool_name,
        arguments=arguments,
        auth_type=tool.server.auth_type,
        auth_token=tool.server.auth_token,
    )

    return {
        "content": call_result["content"],
        "sources": [{
            "type": "mcp",
            "tool": tool_name,
            "server": tool.server.name,
        }],
    }
