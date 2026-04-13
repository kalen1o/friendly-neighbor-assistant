"""add status to messages

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("status", sa.String(20), server_default="completed", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("messages", "status")
