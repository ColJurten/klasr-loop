"""Store analysis results in PostgreSQL."""

from alembic import op
from db.models import Base

revision = "20261008_0003"
down_revision = "20260927_0003"
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("analyses")
