"""add oauth columns to users

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("oauth_provider", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("oauth_id", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "oauth_id")
    op.drop_column("users", "oauth_provider")
