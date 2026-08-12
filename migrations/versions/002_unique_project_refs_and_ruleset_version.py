"""Enforce one assessment/appraisal per project and add ruleset_version.

- Adds a UNIQUE index on eligibility_assessments.project_id
- Adds a UNIQUE index on financial_appraisals.project_id
- Adds nullable eligibility_assessments.ruleset_version

Unique indexes are used (rather than ALTER TABLE ... ADD CONSTRAINT) so the
migration also works on SQLite.

NOTE: if legacy duplicate rows exist, they must be de-duplicated before this
migration can apply; the delete statements below keep the most recent row
per project.
"""
from alembic import op
import sqlalchemy as sa


revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def _dedupe(table: str) -> None:
    # Keep the most recently updated/created row per project_id.
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table}
            WHERE id NOT IN (
                SELECT keep_id FROM (
                    SELECT project_id, (
                        SELECT id FROM {table} AS t2
                        WHERE t2.project_id = t1.project_id
                        ORDER BY t2.updated_at DESC, t2.created_at DESC
                        LIMIT 1
                    ) AS keep_id
                    FROM {table} AS t1
                    GROUP BY project_id
                ) AS keepers
            )
            """
        )
    )


def upgrade() -> None:
    _dedupe("eligibility_assessments")
    _dedupe("financial_appraisals")

    op.create_index(
        "uq_eligibility_project_id",
        "eligibility_assessments",
        ["project_id"],
        unique=True,
    )
    op.create_index(
        "uq_appraisal_project_id",
        "financial_appraisals",
        ["project_id"],
        unique=True,
    )
    op.add_column(
        "eligibility_assessments",
        sa.Column("ruleset_version", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("eligibility_assessments", "ruleset_version")
    op.drop_index("uq_appraisal_project_id", table_name="financial_appraisals")
    op.drop_index("uq_eligibility_project_id", table_name="eligibility_assessments")
