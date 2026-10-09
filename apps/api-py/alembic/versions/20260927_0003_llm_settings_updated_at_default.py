"""Adopt the Prisma LlmSetting updatedAt default."""

from alembic import op
import sqlalchemy as sa

revision = "20260927_0003"
down_revision = "20260913_0002"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column("LlmSetting", "updatedAt", server_default=sa.text("now()"))


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column("LlmSetting", "updatedAt", server_default=None)
