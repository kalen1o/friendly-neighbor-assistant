import json
import logging
import os

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.document import Document, DocumentChunk
from app.rag.chunking import chunk_text, chunk_text_semantic
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
        raw_text = extract_text(file_path)
        if not raw_text.strip():
            doc.status = "failed"
            doc.error_message = "No text content extracted from file"
            await db.commit()
            return

        # 2. Chunk text (semantic or fixed based on config)
        logger.info(
            f"Chunking document {document_id} (strategy={settings.rag_chunk_strategy})"
        )
        if settings.rag_chunk_strategy == "semantic":
            chunk_results = chunk_text_semantic(
                raw_text,
                chunk_size=settings.rag_chunk_size,
                chunk_overlap=settings.rag_chunk_overlap,
            )
            chunk_texts = [c["text"] for c in chunk_results]
            chunk_metadata = [c["metadata"] for c in chunk_results]
        else:
            chunk_texts = chunk_text(raw_text)
            chunk_metadata = [None] * len(chunk_texts)

        if not chunk_texts:
            doc.status = "failed"
            doc.error_message = "No chunks generated from text"
            await db.commit()
            return

        # 3. Generate embeddings
        logger.info(f"Generating embeddings for {len(chunk_texts)} chunks")
        embeddings = await generate_embeddings_batch(chunk_texts, settings)

        # 4. Store chunks with embeddings
        logger.info(f"Storing {len(chunk_texts)} chunks in database")
        for i, (chunk, embedding, meta) in enumerate(
            zip(chunk_texts, embeddings, chunk_metadata)
        ):
            db_chunk = DocumentChunk(
                document_id=document_id,
                chunk_text=chunk,
                chunk_index=i,
                embedding=embedding,
                metadata_json=json.dumps(meta) if meta else None,
            )
            db.add(db_chunk)

        # 5. Update document status
        doc.status = "ready"
        doc.chunk_count = len(chunk_texts)
        await db.commit()

        # 6. Populate search_vector for full-text search (Postgres only)
        try:
            await db.execute(
                text(
                    "UPDATE document_chunks SET search_vector = to_tsvector('english', chunk_text) "
                    "WHERE document_id = :doc_id AND search_vector IS NULL"
                ),
                {"doc_id": document_id},
            )
            await db.commit()
            logger.info(f"Populated search_vector for document {document_id}")
        except Exception:
            # SQLite in tests doesn't support tsvector — skip silently
            logger.debug("Could not populate search_vector (not PostgreSQL?)")

        logger.info(f"Document {document_id} processed: {len(chunk_texts)} chunks")

        # Emit webhook event
        try:
            from app.webhooks.events import emit_event

            if doc.user_id:
                await emit_event(
                    "document_processed",
                    {
                        "document_id": doc.public_id,
                        "filename": doc.filename,
                        "status": "ready",
                        "chunk_count": len(chunk_texts),
                    },
                    user_id=doc.user_id,
                    db=db,
                )
        except Exception:
            pass

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
