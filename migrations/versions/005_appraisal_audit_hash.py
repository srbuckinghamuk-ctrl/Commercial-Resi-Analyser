"""Add financial_appraisals.audit_hash (spec Sec 13.2).

The exported investment memorandum now prints a provenance panel, and the audit
hash is the field that binds the printed figures to the stored calculation: it
is sha256 over project id, calc version, inputs version, governance status,
input hash and outputs hash.

Existing rows are left NULL rather than backfilled. The value can only be
derived from the hashes and status a row already holds, so a backfill would be
computable -- but a row that has not been recalculated since this release is by
definition a pre-provenance result, and stamping it with a hash would assert a
binding no run ever produced. Rows acquire the value the next time they are
saved through the server-side recalculation path, and the report prints
"not recorded" until then.
"""
from alembic import op
import sqlalchemy as sa


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("financial_appraisals", sa.Column("audit_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("financial_appraisals", "audit_hash")
