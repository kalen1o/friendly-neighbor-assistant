"""add scheduled tasks table

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scheduled_tasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("public_id", sa.String(22), unique=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("cron_expression", sa.String(100), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=True),
        sa.Column("webhook_url", sa.String(500), nullable=True),
        sa.Column("enabled", sa.Boolean(), default=True, nullable=False),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_status", sa.String(20), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_tasks_user_id", "scheduled_tasks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_scheduled_tasks_user_id")
    op.drop_table("scheduled_tasks")
