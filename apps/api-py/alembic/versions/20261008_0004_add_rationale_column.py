"""Add neutral classification rationale to proposals."""

from alembic import op
import sqlalchemy as sa

revision = "20261008_0004"
down_revision = "20261008_0003"
branch_labels = None
depends_on = None


def upgrade():
    columns = sa.inspect(op.get_bind()).get_columns("ClassificationProposal")
    if "rationale" not in {column["name"] for column in columns}:
        op.add_column("ClassificationProposal", sa.Column("rationale", sa.Text(), nullable=True))

    op.execute('UPDATE "ClassificationProposal" SET "reviewReason" = NULL')
    op.execute("""UPDATE "ClassificationProposal" SET "reviewRequired" =
        ("destinationPath" = '' OR COALESCE("filenameConfidence", 0) < 0.7
        OR COALESCE("destinationConfidence", 0) < 0.7) WHERE status = 'PENDING'""")


def downgrade():
    op.drop_column("ClassificationProposal", "rationale")
