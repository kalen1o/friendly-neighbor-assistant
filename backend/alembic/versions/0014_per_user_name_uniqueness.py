"""change skill/hook name uniqueness from global to per-user

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-10
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old global unique constraints on name
    op.drop_constraint("skills_name_key", "skills", type_="unique")
    op.drop_constraint("hooks_name_key", "hooks", type_="unique")

    # Add compound unique constraints (user_id, name)
    op.create_unique_constraint("uq_skills_user_name", "skills", ["user_id", "name"])
    op.create_unique_constraint("uq_hooks_user_name", "hooks", ["user_id", "name"])


def downgrade() -> None:
    op.drop_constraint("uq_skills_user_name", "skills", type_="unique")
    op.drop_constraint("uq_hooks_user_name", "hooks", type_="unique")

    op.create_unique_constraint("skills_name_key", "skills", ["name"])
    op.create_unique_constraint("hooks_name_key", "hooks", ["name"])
