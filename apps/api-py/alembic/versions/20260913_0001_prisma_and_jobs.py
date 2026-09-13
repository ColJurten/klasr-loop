"""Adopt the Prisma schema and add the ADR-007 jobs table."""

from alembic import op

from db.models import Base

revision = "20260913_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind(), checkfirst=True)


def downgrade():
    # Initial adoption revision is intentionally non-destructive on shared databases.
    pass
