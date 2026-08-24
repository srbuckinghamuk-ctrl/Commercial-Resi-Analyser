"""Lender case governance: lender_cases + lender_case_events (spec Sec 21).

The case is a sibling of the one-appraisal-per-project row, keyed by
project_id (the Sec 13.2 record-identity reasoning). At most one live
(non-superseded) case per project, enforced by a partial unique index so the
schema works on both Postgres and SQLite. The event table is append-only --
the stage_transitions shape with an integer key so same-second events keep a
deterministic order. No existing table changes: staleness is derived at read
time and stored nowhere, and audit_hash's composition is untouched.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lender_cases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("locked_inputs_snapshot", sa.JSON, nullable=False),
        sa.Column("locked_calc_version", sa.String(32), nullable=False),
        sa.Column("locked_inputs_version", sa.Integer, nullable=False),
        sa.Column("locked_input_hash", sa.String(64), nullable=False),
        sa.Column("locked_outputs_hash", sa.String(64), nullable=False),
        sa.Column("locked_audit_hash", sa.String(64), nullable=False),
        sa.Column("case_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(256), nullable=False),
        sa.Column("submitted_by", sa.String(256)),
        sa.Column("reviewer", sa.String(256)),
        sa.Column("decided_by", sa.String(256)),
        sa.Column("conditions", sa.Text),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lender_case_project_id", "lender_cases", ["project_id"])
    op.create_index(
        "uq_lender_case_live_project", "lender_cases", ["project_id"], unique=True,
        postgresql_where=sa.text("status != 'superseded'"),
        sqlite_where=sa.text("status != 'superseded'"),
    )
    op.create_table(
        "lender_case_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("case_id", UUID(as_uuid=True), sa.ForeignKey("lender_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(32)),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(256), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lender_case_event_case_id", "lender_case_events", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_lender_case_event_case_id", table_name="lender_case_events")
    op.drop_table("lender_case_events")
    op.drop_index("uq_lender_case_live_project", table_name="lender_cases")
    op.drop_index("ix_lender_case_project_id", table_name="lender_cases")
    op.drop_table("lender_cases")
