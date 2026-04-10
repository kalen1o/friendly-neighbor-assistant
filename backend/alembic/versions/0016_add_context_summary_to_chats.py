"""add context_summary to chats

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("context_summary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chats", "context_summary")
