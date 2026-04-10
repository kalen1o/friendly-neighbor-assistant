"""add public_ids to documents, chunks, skills, hooks, mcp tables

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tables and their prefixes
TABLES = [
    ("documents", "doc"),
    ("document_chunks", "chunk"),
    ("skills", "skill"),
    ("hooks", "hook"),
    ("mcp_servers", "mcp"),
    ("mcp_tools", "tool"),
]


def upgrade() -> None:
    import uuid

    for table, prefix in TABLES:
        # Add column as nullable first
        op.add_column(table, sa.Column("public_id", sa.String(22), nullable=True))

        # Backfill existing rows
        conn = op.get_bind()
        rows = conn.execute(sa.text(f"SELECT id FROM {table}")).fetchall()
        for (row_id,) in rows:
            pid = f"{prefix}-{uuid.uuid4().hex[:8]}"
            conn.execute(
                sa.text(f"UPDATE {table} SET public_id = :pid WHERE id = :id"),
                {"pid": pid, "id": row_id},
            )

        # Make non-nullable and unique
        op.alter_column(table, "public_id", nullable=False)
        op.create_unique_constraint(f"uq_{table}_public_id", table, ["public_id"])


def downgrade() -> None:
    for table, _ in reversed(TABLES):
        op.drop_constraint(f"uq_{table}_public_id", table, type_="unique")
        op.drop_column(table, "public_id")
