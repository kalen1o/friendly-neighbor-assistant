"""add search_vector tsvector column to document_chunks

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-13
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL for tsvector type (SQLAlchemy doesn't natively support tsvector)
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_search_vector "
        "ON document_chunks USING GIN (search_vector)"
    )
    # Backfill existing chunks
    op.execute(
        "UPDATE document_chunks SET search_vector = to_tsvector('english', chunk_text) "
        "WHERE search_vector IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_search_vector")
    op.drop_column("document_chunks", "search_vector")
