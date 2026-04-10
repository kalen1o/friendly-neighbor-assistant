"""add public_id to chats, messages, and users

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ["chats", "messages", "users"]:
        op.add_column(table, sa.Column("public_id", sa.String(22), nullable=True))
        op.create_index(f"ix_{table}_public_id", table, ["public_id"], unique=True)

    # Backfill existing rows with generated IDs
    import uuid

    conn = op.get_bind()

    for table, prefix in [("chats", "chat"), ("messages", "msg"), ("users", "user")]:
        rows = conn.execute(
            sa.text(f"SELECT id FROM {table} WHERE public_id IS NULL")
        ).fetchall()
        for row in rows:
            pid = f"{prefix}-{uuid.uuid4().hex[:8]}"
            conn.execute(
                sa.text(f"UPDATE {table} SET public_id = :pid WHERE id = :id"),
                {"pid": pid, "id": row[0]},
            )


def downgrade() -> None:
    for table in ["chats", "messages", "users"]:
        op.drop_index(f"ix_{table}_public_id", table_name=table)
        op.drop_column(table, "public_id")
