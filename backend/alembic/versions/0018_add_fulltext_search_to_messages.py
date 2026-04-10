"""add full-text search to messages

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-10
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add tsvector column
    op.execute("ALTER TABLE messages ADD COLUMN search_vector tsvector")

    # Backfill existing rows
    op.execute(
        "UPDATE messages SET search_vector = to_tsvector('english', coalesce(content, ''))"
    )

    # Create GIN index for fast full-text search
    op.execute(
        "CREATE INDEX ix_messages_search_vector ON messages USING GIN (search_vector)"
    )

    # Create trigger to auto-update search_vector on insert/update
    op.execute("""
        CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
        BEGIN
            NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER messages_search_vector_trigger
        BEFORE INSERT OR UPDATE OF content ON messages
        FOR EACH ROW
        EXECUTE FUNCTION messages_search_vector_update();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages")
    op.execute("DROP FUNCTION IF EXISTS messages_search_vector_update()")
    op.execute("DROP INDEX IF EXISTS ix_messages_search_vector")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS search_vector")
