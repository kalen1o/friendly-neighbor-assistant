from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.artifact import Artifact, ArtifactVersion
from app.models.chat import Chat, Message
from app.models.user import User
from app.schemas.artifact import (
    ArtifactDiffOut,
    ArtifactFileDiff,
    ArtifactOut,
    ArtifactUpdate,
    ArtifactVersionOut,
)

router = APIRouter(tags=["artifacts"])


@router.get("/api/chats/{chat_id}/artifacts", response_model=List[ArtifactOut])
async def list_artifacts(
    chat_id: str,
    limit: Optional[int] = Query(None, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List artifacts for a chat, newest first.

    Pass `?limit=1` to fetch just the most recent artifact — the frontend
    reload flow uses this to avoid downloading every artifact's full file
    payload when it only renders one card.
    """
    result = await db.execute(
        select(Chat).where(Chat.public_id == chat_id, Chat.user_id == user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    stmt = (
        select(Artifact, Message.public_id)
        .join(Message, Message.id == Artifact.message_id)
        .where(Artifact.chat_id == chat.id)
        .order_by(Artifact.created_at.desc(), Artifact.id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)

    rows = (await db.execute(stmt)).all()
    return [ArtifactOut.from_artifact(a, message_public_id=mpid) for a, mpid in rows]


@router.get("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        await db.execute(
            select(Artifact, Message.public_id)
            .join(Message, Message.id == Artifact.message_id)
            .where(Artifact.public_id == artifact_id, Artifact.user_id == user.id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Artifact not found")
    artifact, message_public_id = row
    return ArtifactOut.from_artifact(artifact, message_public_id=message_public_id)


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


@router.get(
    "/api/artifacts/{artifact_id}/versions", response_model=List[ArtifactVersionOut]
)
async def list_versions(
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

    result = await db.execute(
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == artifact.id)
        .order_by(ArtifactVersion.version_number)
    )
    return result.scalars().all()


@router.post(
    "/api/artifacts/{artifact_id}/revert/{version_number}", response_model=ArtifactOut
)
async def revert_to_version(
    artifact_id: str,
    version_number: int,
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

    result = await db.execute(
        select(ArtifactVersion).where(
            ArtifactVersion.artifact_id == artifact.id,
            ArtifactVersion.version_number == version_number,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    artifact.title = version.title
    artifact.files = version.files
    await db.commit()
    await db.refresh(artifact)
    return ArtifactOut.from_artifact(artifact)


@router.get(
    "/api/artifacts/{artifact_id}/versions/{v_from}/diff/{v_to}",
    response_model=ArtifactDiffOut,
)
async def diff_versions(
    artifact_id: str,
    v_from: int,
    v_to: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Compare two versions of an artifact, per file.

    Response is the *changes only* — unchanged files are dropped. For
    `modified` files we return a unified diff (stdlib `difflib`); for
    `added`/`removed` we return the full file body so the renderer can
    show it uniformly green/red without a redundant single-sided diff.
    """
    import difflib

    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_id, Artifact.user_id == user.id
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    # Fetch both versions in one query
    versions = (
        (
            await db.execute(
                select(ArtifactVersion).where(
                    ArtifactVersion.artifact_id == artifact.id,
                    ArtifactVersion.version_number.in_([v_from, v_to]),
                )
            )
        )
        .scalars()
        .all()
    )
    by_num = {v.version_number: v for v in versions}
    if v_from not in by_num or v_to not in by_num:
        raise HTTPException(status_code=404, detail="Version not found")

    files_from = by_num[v_from].files or {}
    files_to = by_num[v_to].files or {}
    all_paths = sorted(set(files_from) | set(files_to))

    diffs: list[ArtifactFileDiff] = []
    for path in all_paths:
        a = files_from.get(path)
        b = files_to.get(path)
        if a is None:
            diffs.append(ArtifactFileDiff(path=path, status="added", content=b or ""))
            continue
        if b is None:
            diffs.append(ArtifactFileDiff(path=path, status="removed", content=a))
            continue
        if a == b:
            continue  # unchanged — drop from response
        diff_text = "".join(
            difflib.unified_diff(
                a.splitlines(keepends=True),
                b.splitlines(keepends=True),
                fromfile=f"v{v_from}{path}",
                tofile=f"v{v_to}{path}",
                n=3,
            )
        )
        diffs.append(ArtifactFileDiff(path=path, status="modified", diff=diff_text))

    return ArtifactDiffOut(from_version=v_from, to_version=v_to, files=diffs)
