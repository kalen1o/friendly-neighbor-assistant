"""migrate memories from table to JSON column on users

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add memories JSON column to users
    op.add_column("users", sa.Column("memories", sa.Text(), nullable=True))

    # Migrate existing memories from user_memories table to JSON
    conn = op.get_bind()
    import json

    users = conn.execute(
        sa.text("SELECT DISTINCT user_id FROM user_memories")
    ).fetchall()
    for (user_id,) in users:
        rows = conn.execute(
            sa.text(
                "SELECT content, category FROM user_memories WHERE user_id = :uid ORDER BY created_at"
            ),
            {"uid": user_id},
        ).fetchall()
        memories = [{"content": r[0], "category": r[1]} for r in rows]
        conn.execute(
            sa.text("UPDATE users SET memories = :mem WHERE id = :uid"),
            {"mem": json.dumps(memories), "uid": user_id},
        )

    # Drop old table
    op.drop_table("user_memories")


def downgrade() -> None:
    # Recreate user_memories table
    op.create_table(
        "user_memories",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(22), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.drop_column("users", "memories")
