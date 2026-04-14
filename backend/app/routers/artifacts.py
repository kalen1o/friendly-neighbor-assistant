from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.artifact import Artifact
from app.models.chat import Chat
from app.models.user import User
from app.schemas.artifact import ArtifactOut, ArtifactUpdate

router = APIRouter(tags=["artifacts"])


@router.get("/api/chats/{chat_id}/artifacts", response_model=List[ArtifactOut])
async def list_artifacts(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    result = await db.execute(
        select(Artifact)
        .where(Artifact.chat_id == chat.id)
        .order_by(Artifact.created_at)
    )
    artifacts = result.scalars().all()
    return [ArtifactOut.from_artifact(a) for a in artifacts]


@router.get("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_id, Artifact.user_id == user.id
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return ArtifactOut.from_artifact(artifact)


@router.patch("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def update_artifact(
    artifact_id: str,
    body: ArtifactUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_id, Artifact.user_id == user.id
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    if body.code is not None:
        artifact.code = body.code
    if body.title is not None:
        artifact.title = body.title
    if body.files is not None:
        artifact.files = body.files
    await db.commit()
    await db.refresh(artifact)
    return ArtifactOut.from_artifact(artifact)
