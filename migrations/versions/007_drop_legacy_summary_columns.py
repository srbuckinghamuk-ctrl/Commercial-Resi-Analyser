"""Drop the seven legacy summary columns from financial_appraisals (R16b,
spec Sec 26.3).

Since R1 every one of them was written by the same server run that wrote
`outputs`, under a name that was not the result's (`total_cost_pence` for
`total_development_cost_pence`, `irr` for `irr_annual_pct`). Two places for
one fact, and a consumer selecting a column could not tell which calc
version it was reading (audit Sec 6.4). `outputs.metrics` is now the only
stored copy. Batch mode so SQLite (the test target) and Postgres both run it.
Downgrade re-adds the columns nullable and leaves them null: they were never
entered, only derived, and the next save through the API would not refill
them anyway.
"""
from alembic import op
import sqlalchemy as sa


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None

LEGACY_SUMMARY_COLUMNS = (
    ("gdv_pence", sa.BigInteger),
    ("total_cost_pence", sa.BigInteger),
    ("profit_on_cost_pct", sa.Float),
    ("profit_on_gdv_pct", sa.Float),
    ("return_on_equity_pct", sa.Float),
    ("irr", sa.Float),
    ("rlv_pence", sa.BigInteger),
)


def upgrade() -> None:
    with op.batch_alter_table("financial_appraisals") as batch_op:
        for name, _ in LEGACY_SUMMARY_COLUMNS:
            batch_op.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("financial_appraisals") as batch_op:
        for name, type_ in LEGACY_SUMMARY_COLUMNS:
            batch_op.add_column(sa.Column(name, type_, nullable=True))
