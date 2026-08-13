"""Appraisal governance columns for Commercial-Resi-Analyser.

Adds the server-side-authority columns to financial_appraisals: outputs,
validation, calc_version, inputs_version, status, input_hash, outputs_hash.

No data backfill is performed. The `status` column's server_default of
'legacy_unreconciled' is what marks every pre-existing row (including the
live York appraisal) as unmigrated -- any row that predates this migration
gets that value automatically, and the next time it is saved through the
Task 12 server-side recalculation path (app.api.app.calculate_authoritative)
its status is overwritten explicitly (`reconciled` or `draft`).
"""

from alembic import op
import sqlalchemy as sa


revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("financial_appraisals", sa.Column("outputs", sa.JSON))
    op.add_column("financial_appraisals", sa.Column("validation", sa.JSON))
    op.add_column("financial_appraisals", sa.Column("calc_version", sa.String(32)))
    op.add_column(
        "financial_appraisals",
        sa.Column("inputs_version", sa.Integer, nullable=False, server_default="1"),
    )
    op.add_column(
        "financial_appraisals",
        sa.Column(
            "status", sa.String(32), nullable=False, server_default="legacy_unreconciled"
        ),
    )
    op.add_column("financial_appraisals", sa.Column("input_hash", sa.String(64)))
    op.add_column("financial_appraisals", sa.Column("outputs_hash", sa.String(64)))


def downgrade() -> None:
    op.drop_column("financial_appraisals", "outputs_hash")
    op.drop_column("financial_appraisals", "input_hash")
    op.drop_column("financial_appraisals", "status")
    op.drop_column("financial_appraisals", "inputs_version")
    op.drop_column("financial_appraisals", "calc_version")
    op.drop_column("financial_appraisals", "validation")
    op.drop_column("financial_appraisals", "outputs")
