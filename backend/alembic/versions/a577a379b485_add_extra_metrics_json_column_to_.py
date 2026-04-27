"""add extra_metrics json column to messages

Revision ID: a577a379b485
Revises: 0034
Create Date: 2026-04-27 06:06:11.555560

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a577a379b485"
down_revision: Union[str, None] = "0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("extra_metrics", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "extra_metrics")
