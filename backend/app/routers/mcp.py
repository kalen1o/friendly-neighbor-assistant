from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agent.agent import invalidate_agent_cache
from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.mcp.service import add_server, refresh_server_tools
from app.mcp.client import invalidate_cache
from app.models.mcp import McpServer, McpTool
from app.schemas.mcp import McpServerCreate, McpServerOut, McpServerUpdate, McpToolOut, McpToolUpdate

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/servers", response_model=List[McpServerOut])
async def list_servers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(McpServer).where(or_(McpServer.user_id == None, McpServer.user_id == user.id)).order_by(McpServer.created_at.desc()).options(selectinload(McpServer.tools))  # noqa: E711
    )
    servers = result.scalars().all()
    return [
        McpServerOut(
            id=s.public_id,
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
async def create_server(body: McpServerCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    server = await add_server(
        db=db,
        name=body.name,
        url=body.url,
        description=body.description,
        auth_type=body.auth_type,
        auth_token=body.auth_token,
        auth_header=body.auth_header,
        user_id=user.id,
    )
    invalidate_agent_cache(user.id)
    # Reload with tools
    result = await db.execute(
        select(McpServer).where(McpServer.id == server.id).options(selectinload(McpServer.tools))
    )
    server = result.scalar_one()
    return McpServerOut(
        id=server.public_id,
        name=server.name,
        url=server.url,
        description=server.description,
        auth_type=server.auth_type,
        enabled=server.enabled,
        tool_count=len(server.tools),
        enabled_tool_count=sum(1 for t in server.tools if t.enabled),
        created_at=server.created_at,
    )


@router.patch("/servers/{server_id}", response_model=McpServerOut)
async def update_server(server_id: str, body: McpServerUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(McpServer).where(McpServer.public_id == server_id, McpServer.user_id == user.id).options(selectinload(McpServer.tools))
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if body.name is not None:
        server.name = body.name
    if body.url is not None:
        server.url = body.url
    if body.description is not None:
        server.description = body.description
    if body.auth_type is not None:
        server.auth_type = body.auth_type
    if body.auth_token is not None:
        server.auth_token = body.auth_token
    if body.auth_header is not None:
        server.auth_header = body.auth_header
    if body.enabled is not None:
        server.enabled = body.enabled
    await db.commit()
    invalidate_agent_cache(user.id)
    await db.refresh(server, ["tools"])
    return McpServerOut(
        id=server.public_id,
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
async def delete_server(server_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(McpServer).where(McpServer.public_id == server_id, McpServer.user_id == user.id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    await invalidate_cache(server.id)
    await db.delete(server)
    await db.commit()
    invalidate_agent_cache(user.id)


@router.post("/servers/{server_id}/refresh", response_model=List[McpToolOut])
async def refresh_tools(server_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(McpServer).where(McpServer.public_id == server_id, or_(McpServer.user_id == None, McpServer.user_id == user.id)))  # noqa: E711
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    tools = await refresh_server_tools(db, server)
    invalidate_agent_cache(user.id)
    # Reload tools with server relationship for public_id mapping
    result = await db.execute(
        select(McpTool).where(McpTool.server_id == server.id).options(selectinload(McpTool.server))
    )
    tools_with_server = result.scalars().all()
    return [McpToolOut.from_tool(t) for t in tools_with_server]


@router.get("/servers/{server_id}/tools", response_model=List[McpToolOut])
async def list_tools(server_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(McpServer).where(McpServer.public_id == server_id, or_(McpServer.user_id == None, McpServer.user_id == user.id))  # noqa: E711
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    result = await db.execute(
        select(McpTool).where(McpTool.server_id == server.id).order_by(McpTool.tool_name).options(selectinload(McpTool.server))
    )
    return [McpToolOut.from_tool(t) for t in result.scalars().all()]


@router.patch("/tools/{tool_id}", response_model=McpToolOut)
async def update_tool(tool_id: str, body: McpToolUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(McpTool)
        .where(McpTool.public_id == tool_id)
        .options(selectinload(McpTool.server))
    )
    tool = result.scalar_one_or_none()
    if not tool or not tool.server:
        raise HTTPException(status_code=404, detail="Tool not found")
    # Verify the tool's server belongs to the current user
    if tool.server.user_id is not None and tool.server.user_id != user.id:
        raise HTTPException(status_code=404, detail="Tool not found")
    if body.enabled is not None:
        tool.enabled = body.enabled
    await db.commit()
    invalidate_agent_cache(user.id)
    await db.refresh(tool, ["server"])
    return McpToolOut.from_tool(tool)
