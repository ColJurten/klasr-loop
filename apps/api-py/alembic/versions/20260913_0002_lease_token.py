"""Add lease_token column to jobs table (N1 fix: opaque lease guard)."""

from alembic import op
import sqlalchemy as sa

revision = "20260913_0002"
down_revision = "20260913_0001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("jobs")]
    if "lease_token" not in columns:
        op.add_column("jobs", sa.Column("lease_token", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("jobs", "lease_token")
