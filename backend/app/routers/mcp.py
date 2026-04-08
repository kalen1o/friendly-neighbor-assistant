from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.mcp.service import add_server, refresh_server_tools
from app.mcp.client import invalidate_cache
from app.models.mcp import McpServer, McpTool
from app.schemas.mcp import McpServerCreate, McpServerOut, McpToolOut, McpToolUpdate

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/servers", response_model=List[McpServerOut])
async def list_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(McpServer).order_by(McpServer.created_at.desc()).options(selectinload(McpServer.tools))
    )
    servers = result.scalars().all()
    return [
        McpServerOut(
            id=s.id,
            name=s.name,
            url=s.url,
            description=s.description,
            auth_type=s.auth_type,
            enabled=s.enabled,
            tool_count=len(s.tools),
            enabled_tool_count=sum(1 for t in s.tools if t.enabled),
            created_at=s.created_at,
        )
        for s in servers
    ]


@router.post("/servers", status_code=201, response_model=McpServerOut)
async def create_server(body: McpServerCreate, db: AsyncSession = Depends(get_db)):
    server = await add_server(
        db=db,
        name=body.name,
        url=body.url,
        description=body.description,
        auth_type=body.auth_type,
        auth_token=body.auth_token,
    )
    # Reload with tools
    result = await db.execute(
        select(McpServer).where(McpServer.id == server.id).options(selectinload(McpServer.tools))
    )
    server = result.scalar_one()
    return McpServerOut(
        id=server.id,
        name=server.name,
        url=server.url,
        description=server.description,
        auth_type=server.auth_type,
        enabled=server.enabled,
        tool_count=len(server.tools),
        enabled_tool_count=sum(1 for t in server.tools if t.enabled),
        created_at=server.created_at,
    )


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    await invalidate_cache(server_id)
    await db.delete(server)
    await db.commit()


@router.post("/servers/{server_id}/refresh", response_model=List[McpToolOut])
async def refresh_tools(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(McpServer).where(McpServer.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    tools = await refresh_server_tools(db, server)
    return tools


@router.get("/servers/{server_id}/tools", response_model=List[McpToolOut])
async def list_tools(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(McpTool).where(McpTool.server_id == server_id).order_by(McpTool.tool_name)
    )
    return result.scalars().all()


@router.patch("/tools/{tool_id}", response_model=McpToolOut)
async def update_tool(tool_id: int, body: McpToolUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(McpTool).where(McpTool.id == tool_id))
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    if body.enabled is not None:
        tool.enabled = body.enabled
    await db.commit()
    await db.refresh(tool)
    return tool
