"""add auth_header column to mcp_servers

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("mcp_servers", sa.Column("auth_header", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("mcp_servers", "auth_header")
