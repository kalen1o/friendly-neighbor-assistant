"""add metrics to messages

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("latency", sa.Float(), nullable=True))
    op.add_column("messages", sa.Column("tokens_input", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("tokens_output", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("tokens_total", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "tokens_total")
    op.drop_column("messages", "tokens_output")
    op.drop_column("messages", "tokens_input")
    op.drop_column("messages", "latency")
