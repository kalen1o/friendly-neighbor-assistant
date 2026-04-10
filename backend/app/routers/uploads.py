import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.chat_file import ChatFile
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

ALLOWED_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
}


@router.post("", status_code=201)
async def upload_file(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Allowed: images, PDFs, text files.",
        )

    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.max_upload_size_mb}MB.",
        )

    ext = os.path.splitext(file.filename or "file")[1] or ""
    unique_name = f"{uuid.uuid4().hex}{ext}"
    user_dir = os.path.join(settings.upload_dir, user.public_id)
    os.makedirs(user_dir, exist_ok=True)
    storage_path = os.path.join(user_dir, unique_name)

    with open(storage_path, "wb") as f:
        f.write(content)

    chat_file = ChatFile(
        user_id=user.id,
        filename=file.filename or "file",
        file_type=content_type,
        file_size=len(content),
        storage_path=storage_path,
    )
    db.add(chat_file)
    await db.commit()
    await db.refresh(chat_file)

    return {
        "id": chat_file.public_id,
        "filename": chat_file.filename,
        "file_type": chat_file.file_type,
        "file_size": chat_file.file_size,
    }


@router.get("/{file_id}")
async def serve_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChatFile).where(
            ChatFile.public_id == file_id, ChatFile.user_id == user.id
        )
    )
    chat_file = result.scalar_one_or_none()
    if not chat_file:
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(chat_file.storage_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        chat_file.storage_path,
        media_type=chat_file.file_type,
        filename=chat_file.filename,
    )
