"""Adopt the Prisma schema and add the ADR-007 jobs table."""

from alembic import op
from sqlalchemy import inspect

from db.models import Base, Job

revision = "20260913_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    tables = set(inspect(connection).get_table_names())
    if "Organization" not in tables:
        Base.metadata.create_all(connection)
    elif "jobs" not in tables:
        Job.__table__.create(connection)


def downgrade():
    # Initial adoption revision is intentionally non-destructive on shared databases.
    pass
