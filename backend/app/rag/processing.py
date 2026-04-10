import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.document import Document, DocumentChunk
from app.rag.chunking import chunk_text
from app.rag.embeddings import generate_embeddings_batch
from app.rag.parsing import extract_text

logger = logging.getLogger(__name__)


async def process_document(
    document_id: int,
    file_path: str,
    db: AsyncSession,
    settings: Settings,
) -> None:
    """Background task: parse file, chunk, embed, store in pgvector."""
    try:
        # Get document record
        result = await db.execute(select(Document).where(Document.id == document_id))
        doc = result.scalar_one_or_none()
        if not doc:
            logger.error(f"Document {document_id} not found")
            return

        # 1. Parse file
        logger.info(f"Parsing document {document_id}: {doc.filename}")
        text = extract_text(file_path)
        if not text.strip():
            doc.status = "failed"
            doc.error_message = "No text content extracted from file"
            await db.commit()
            return

        # 2. Chunk text
        logger.info(f"Chunking document {document_id}")
        chunks = chunk_text(text)
        if not chunks:
            doc.status = "failed"
            doc.error_message = "No chunks generated from text"
            await db.commit()
            return

        # 3. Generate embeddings
        logger.info(f"Generating embeddings for {len(chunks)} chunks")
        embeddings = await generate_embeddings_batch(chunks, settings)

        # 4. Store chunks with embeddings
        logger.info(f"Storing {len(chunks)} chunks in database")
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            db_chunk = DocumentChunk(
                document_id=document_id,
                chunk_text=chunk,
                chunk_index=i,
                embedding=embedding,
            )
            db.add(db_chunk)

        # 5. Update document status
        doc.status = "ready"
        doc.chunk_count = len(chunks)
        await db.commit()

        logger.info(f"Document {document_id} processed: {len(chunks)} chunks")

    except Exception as e:
        logger.exception(f"Failed to process document {document_id}")
        try:
            result = await db.execute(
                select(Document).where(Document.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                doc.status = "failed"
                doc.error_message = str(e)[:500]
                await db.commit()
        except Exception:
            logger.exception("Failed to update document status after error")

    finally:
        # Clean up uploaded file
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
