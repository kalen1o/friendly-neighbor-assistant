"""add personalization fields to users

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("personalization_nickname", sa.String(100), nullable=True)
    )
    op.add_column(
        "users", sa.Column("personalization_role", sa.String(200), nullable=True)
    )
    op.add_column(
        "users", sa.Column("personalization_tone", sa.String(30), nullable=True)
    )
    op.add_column(
        "users", sa.Column("personalization_length", sa.String(20), nullable=True)
    )
    op.add_column(
        "users", sa.Column("personalization_language", sa.String(50), nullable=True)
    )
    op.add_column("users", sa.Column("personalization_about", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("personalization_style", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "personalization_style")
    op.drop_column("users", "personalization_about")
    op.drop_column("users", "personalization_language")
    op.drop_column("users", "personalization_length")
    op.drop_column("users", "personalization_tone")
    op.drop_column("users", "personalization_role")
    op.drop_column("users", "personalization_nickname")
