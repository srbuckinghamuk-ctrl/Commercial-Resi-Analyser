"""Initial schema for Commercial-Resi-Analyser.

Tables: projects, eligibility_assessments, financial_appraisals, stage_transitions
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("address_raw", sa.Text, nullable=False),
        sa.Column("address_line1", sa.String(256)),
        sa.Column("address_line2", sa.String(256)),
        sa.Column("address_town", sa.String(128)),
        sa.Column("address_county", sa.String(128)),
        sa.Column("address_postcode", sa.String(16)),
        sa.Column("address_postcode_district", sa.String(8)),
        sa.Column("price_pence", sa.BigInteger, nullable=False),
        sa.Column("price_qualifier", sa.String(64)),
        sa.Column("use_class", sa.String(32), nullable=False),
        sa.Column("floor_area_sqft", sa.Float),
        sa.Column("floor_area_sqm", sa.Float),
        sa.Column("floors", sa.Integer),
        sa.Column("tenure", sa.String(32), server_default="unknown"),
        sa.Column("lease_years_remaining", sa.Integer),
        sa.Column("current_use_description", sa.Text),
        sa.Column("epc_rating", sa.String(8)),
        sa.Column("is_vacant", sa.Boolean),
        sa.Column("vacancy_date", sa.String(32)),
        sa.Column("source_url", sa.Text),
        sa.Column("source_name", sa.String(64)),
        sa.Column("description", sa.Text),
        sa.Column("image_urls", sa.JSON, server_default="[]"),
        sa.Column("stage", sa.String(48), nullable=False, server_default="opportunity_identified"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_projects_postcode", "projects", ["address_postcode"])
    op.create_index("ix_projects_stage", "projects", ["stage"])
    op.create_index("ix_projects_use_class", "projects", ["use_class"])

    op.create_table(
        "eligibility_assessments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pdr_class", sa.String(32), nullable=False),
        sa.Column("criteria", sa.JSON, nullable=False),
        sa.Column("verdict", sa.String(16), nullable=False),
        sa.Column("suggested_next_steps", sa.JSON, server_default="[]"),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_eligibility_project_id", "eligibility_assessments", ["project_id"])

    op.create_table(
        "financial_appraisals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("inputs_snapshot", sa.JSON, nullable=False),
        sa.Column("gdv_pence", sa.BigInteger),
        sa.Column("total_cost_pence", sa.BigInteger),
        sa.Column("profit_on_cost_pct", sa.Float),
        sa.Column("profit_on_gdv_pct", sa.Float),
        sa.Column("return_on_equity_pct", sa.Float),
        sa.Column("irr", sa.Float),
        sa.Column("rlv_pence", sa.BigInteger),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_appraisal_project_id", "financial_appraisals", ["project_id"])

    op.create_table(
        "stage_transitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_stage", sa.String(48)),
        sa.Column("to_stage", sa.String(48), nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("transitioned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_transition_project_id", "stage_transitions", ["project_id"])


def downgrade() -> None:
    op.drop_table("stage_transitions")
    op.drop_table("financial_appraisals")
    op.drop_table("eligibility_assessments")
    op.drop_table("projects")
