"""add project artifact columns

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("template", sa.String(20), nullable=True))
    op.add_column("artifacts", sa.Column("files", sa.JSON(), nullable=True))
    op.add_column("artifacts", sa.Column("dependencies", sa.JSON(), nullable=True))
    op.alter_column("artifacts", "code", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.alter_column("artifacts", "code", existing_type=sa.Text(), nullable=False)
    op.drop_column("artifacts", "dependencies")
    op.drop_column("artifacts", "files")
    op.drop_column("artifacts", "template")
