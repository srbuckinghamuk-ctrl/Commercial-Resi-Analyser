"""Add prior-approval deadline date fields to projects.

- projects.pa_submitted_date (nullable DATE): when the prior approval
  application was submitted (frontend derives the 56-day decision window).
- projects.pa_decision_date (nullable DATE): when the decision was issued
  (frontend derives the 3-year completion window).
"""
from alembic import op
import sqlalchemy as sa


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("pa_submitted_date", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("pa_decision_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "pa_decision_date")
    op.drop_column("projects", "pa_submitted_date")
