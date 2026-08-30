"""Benchmark library, index datasets, users and appraisal versions (R17,
spec Sec 27.6, Sec 21 amended, Sec 27.7).

Six new tables and two altered ones. `users` carries the authenticated
identity every governed write now records; `benchmark_sets`/`benchmark_rates`
are the immutable elemental-rate library (unique per provider, dataset
version and content hash -- a re-import of identical content is refused, not
duplicated); `index_datasets`/`index_observations` are the versioned
currentisation series; `appraisal_versions` is the pre-save audit trail the
governed resave writes. `lender_cases` gains the optimistic-concurrency
`version` and four nullable user FKs beside the existing display-name
columns (which stay: they are case_hash components); `lender_case_events`
gains the actor FK, the idempotency key and the per-event hash/version
record. Batch mode for the column additions so SQLite (the test target) and
Postgres both run it. Downgrade is complete: it drops everything this
revision added and nothing else.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- users -------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("password_hash", sa.String(128), nullable=False),
        sa.Column("password_salt", sa.String(64), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("uq_users_email", "users", ["email"], unique=True)

    # --- benchmark library ------------------------------------------------
    op.create_table(
        "benchmark_sets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("provider_type", sa.String(32), nullable=False),
        sa.Column("provider_name", sa.String(256), nullable=False),
        sa.Column("source_title", sa.Text, nullable=False),
        sa.Column("source_url", sa.Text),
        sa.Column("source_publication_date", sa.Date),
        sa.Column("retrieved_at", sa.DateTime(timezone=True)),
        sa.Column("licence_or_permission", sa.Text, nullable=False),
        sa.Column("dataset_version", sa.String(64), nullable=False),
        sa.Column("building_function", sa.String(128), nullable=False),
        sa.Column("project_type", sa.String(32), nullable=False),
        sa.Column("specification_level", sa.String(128), nullable=False),
        sa.Column("region", sa.String(128), nullable=False),
        sa.Column("location_factor", sa.Float),
        sa.Column("location_factor_source", sa.Text),
        sa.Column("base_date", sa.Date, nullable=False),
        sa.Column("base_index_name", sa.String(128)),
        sa.Column("base_index_value", sa.Float),
        sa.Column("current_index_name", sa.String(128)),
        sa.Column("current_index_value", sa.Float),
        sa.Column("index_dataset_version", sa.String(64)),
        sa.Column("currentisation_date", sa.Date),
        sa.Column("currency", sa.String(3), nullable=False, server_default="GBP"),
        sa.Column("notes", sa.Text, nullable=False),
        sa.Column("imported_by", sa.String(256), nullable=False),
        sa.Column("imported_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("source_file_sha256", sa.String(64)),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "uq_benchmark_set_content", "benchmark_sets",
        ["provider_type", "dataset_version", "content_hash"], unique=True,
    )
    op.create_table(
        "benchmark_rates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("rate_key", sa.String(64), nullable=False, server_default=""),
        sa.Column(
            "set_id", UUID(as_uuid=True),
            sa.ForeignKey("benchmark_sets.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("element_code", sa.String(64), nullable=False),
        sa.Column("element_label", sa.String(256), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("measurement_basis", sa.String(16), nullable=False),
        sa.Column("original_unit", sa.String(16), nullable=False),
        sa.Column("original_rate_pence", sa.BigInteger, nullable=False),
        sa.Column("rate_pct", sa.Float),
        sa.Column("lower_quartile_rate_pence", sa.BigInteger),
        sa.Column("median_rate_pence", sa.BigInteger),
        sa.Column("upper_quartile_rate_pence", sa.BigInteger),
        sa.Column("sample_count", sa.Integer),
        sa.Column("location_factor", sa.Float),
        sa.Column("evidence_status", sa.String(16), nullable=False),
        sa.Column("source_reference", sa.Text, nullable=False),
        sa.Column("notes", sa.Text, nullable=False),
        # Import order -- the set's rates are returned in the order they came.
        sa.Column("position", sa.Integer, nullable=False),
    )
    op.create_index("ix_benchmark_rate_set_id", "benchmark_rates", ["set_id"])

    # --- index datasets ---------------------------------------------------
    op.create_table(
        "index_datasets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("publisher", sa.String(256), nullable=False),
        sa.Column("series_code", sa.String(64), nullable=False),
        sa.Column("series_name", sa.String(256), nullable=False),
        sa.Column("dataset_version", sa.String(64), nullable=False),
        sa.Column("source_url", sa.Text, nullable=False),
        sa.Column("licence", sa.Text, nullable=False),
        sa.Column("publication_date", sa.Date),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("base_period", sa.String(32), nullable=False),
        sa.Column("source_file_sha256", sa.String(64)),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("imported_by", sa.String(256), nullable=False),
        sa.Column("imported_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("notes", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "uq_index_dataset_version", "index_datasets",
        ["publisher", "series_code", "dataset_version"], unique=True,
    )
    op.create_table(
        "index_observations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "dataset_id", UUID(as_uuid=True),
            sa.ForeignKey("index_datasets.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("value", sa.Float, nullable=False),
    )
    op.create_index("ix_index_observation_dataset_id", "index_observations", ["dataset_id"])
    op.create_index(
        "uq_index_observation_period", "index_observations", ["dataset_id", "period"], unique=True,
    )

    # --- appraisal versions (spec Sec 11) ---------------------------------
    op.create_table(
        "appraisal_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id", UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("appraisal_id", UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("inputs_snapshot", sa.JSON, nullable=False),
        sa.Column("outputs", sa.JSON),
        sa.Column("validation", sa.JSON),
        sa.Column("calc_version", sa.String(32)),
        sa.Column("inputs_version", sa.Integer),
        sa.Column("status", sa.String(32)),
        sa.Column("input_hash", sa.String(64)),
        sa.Column("outputs_hash", sa.String(64)),
        sa.Column("audit_hash", sa.String(64)),
        sa.Column("superseded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("superseded_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("superseded_by", sa.String(256)),
    )
    op.create_index("ix_appraisal_version_project_id", "appraisal_versions", ["project_id"])

    # --- lender_cases: version + user identity (spec Sec 10.2) ------------
    # Batch mode: SQLite cannot ADD COLUMN ... REFERENCES in place, so the
    # table is rebuilt; on Postgres batch is a pass-through to plain ALTERs.
    with op.batch_alter_table("lender_cases") as batch_op:
        batch_op.add_column(
            sa.Column("version", sa.Integer, nullable=False, server_default="1")
        )
        for name in ("created_by_user_id", "submitted_by_user_id",
                     "reviewer_user_id", "decided_by_user_id"):
            batch_op.add_column(sa.Column(name, UUID(as_uuid=True), nullable=True))
            batch_op.create_foreign_key(
                f"fk_lender_cases_{name}_users", "users", [name], ["id"]
            )

    # --- lender_case_events: actor, idempotency, per-event record ---------
    with op.batch_alter_table("lender_case_events") as batch_op:
        batch_op.add_column(sa.Column("actor_user_id", UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_lender_case_events_actor_user_id_users", "users", ["actor_user_id"], ["id"]
        )
        batch_op.add_column(sa.Column("idempotency_key", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("reason", sa.Text, nullable=True))
        batch_op.add_column(sa.Column("input_snapshot_hash", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("outputs_hash", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("case_hash_after", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("case_version_after", sa.Integer, nullable=True))
    # Pre-R17 events (and any event written without a key) carry a NULL
    # idempotency_key. Both Postgres and SQLite treat NULLs as distinct in a
    # unique index, so any number of keyless events per case coexist; only a
    # repeated non-null key on the same case is refused.
    op.create_index(
        "uq_lender_case_event_idempotency", "lender_case_events",
        ["case_id", "idempotency_key"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_lender_case_event_idempotency", table_name="lender_case_events")
    with op.batch_alter_table("lender_case_events") as batch_op:
        batch_op.drop_constraint("fk_lender_case_events_actor_user_id_users", type_="foreignkey")
        for name in ("case_version_after", "case_hash_after", "outputs_hash",
                     "input_snapshot_hash", "reason", "idempotency_key", "actor_user_id"):
            batch_op.drop_column(name)
    with op.batch_alter_table("lender_cases") as batch_op:
        for name in ("decided_by_user_id", "reviewer_user_id",
                     "submitted_by_user_id", "created_by_user_id"):
            batch_op.drop_constraint(f"fk_lender_cases_{name}_users", type_="foreignkey")
            batch_op.drop_column(name)
        batch_op.drop_column("version")
    op.drop_index("ix_appraisal_version_project_id", table_name="appraisal_versions")
    op.drop_table("appraisal_versions")
    op.drop_index("uq_index_observation_period", table_name="index_observations")
    op.drop_index("ix_index_observation_dataset_id", table_name="index_observations")
    op.drop_table("index_observations")
    op.drop_index("uq_index_dataset_version", table_name="index_datasets")
    op.drop_table("index_datasets")
    op.drop_index("ix_benchmark_rate_set_id", table_name="benchmark_rates")
    op.drop_table("benchmark_rates")
    op.drop_index("uq_benchmark_set_content", table_name="benchmark_sets")
    op.drop_table("benchmark_sets")
    op.drop_index("uq_users_email", table_name="users")
    op.drop_table("users")
