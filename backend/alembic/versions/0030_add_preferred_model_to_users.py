"""add preferred_model to users

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferred_model", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferred_model")
