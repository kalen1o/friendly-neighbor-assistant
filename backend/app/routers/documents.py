import asyncio
import os
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.engine import get_session_factory
from app.db.session import get_db
from app.models.document import Document
from app.rag.processing import process_document
from app.schemas.document import DocumentOut, DocumentStatus

router = APIRouter(prefix="/api/documents", tags=["documents"])

UPLOAD_DIR = "/tmp/fn_uploads"
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".html", ".csv"}


@router.post("/upload", status_code=202, response_model=DocumentOut)
async def upload_document(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # Validate file extension
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Read file content
    content = await file.read()
    file_size = len(content)
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Save to disk
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(UPLOAD_DIR, f"{os.urandom(16).hex()}{ext}")
    with open(file_path, "wb") as f:
        f.write(content)

    # Create DB record
    doc = Document(
        filename=filename,
        file_type=ext.lstrip("."),
        file_size=file_size,
        status="processing",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Launch background processing
    async def _background_process():
        session_factory = get_session_factory()
        async with session_factory() as bg_db:
            await process_document(doc.id, file_path, bg_db, settings)

    asyncio.create_task(_background_process())

    return doc


@router.get("", response_model=List[DocumentOut])
async def list_documents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).order_by(Document.created_at.desc()))
    return result.scalars().all()


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(document_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{document_id}/status", response_model=DocumentStatus)
async def get_document_status(document_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()
