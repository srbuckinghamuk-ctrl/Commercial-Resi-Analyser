from uuid import uuid4

import pytest

from app.persistence.database import (
    ProjectORM,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    StageTransitionORM,
    LenderCaseORM,
    LenderCaseEventORM,
    UserORM,
    BenchmarkSetORM,
    BenchmarkRateORM,
    IndexDatasetORM,
    IndexObservationORM,
    AppraisalVersionORM,
    Base,
)


class TestProjectORM:
    def test_table_name(self):
        assert ProjectORM.__tablename__ == "projects"

    def test_has_required_columns(self):
        col_names = {c.name for c in ProjectORM.__table__.columns}
        required = {
            "id", "address_raw", "price_pence", "use_class", "stage",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_has_property_columns(self):
        col_names = {c.name for c in ProjectORM.__table__.columns}
        property_cols = {
            "address_line1", "address_line2", "address_town", "address_county",
            "address_postcode", "address_postcode_district",
            "price_qualifier", "floor_area_sqft", "floor_area_sqm", "floors",
            "tenure", "lease_years_remaining", "current_use_description",
            "epc_rating", "is_vacant", "vacancy_date",
            "source_url", "source_name", "description", "image_urls",
        }
        assert property_cols.issubset(col_names)


class TestEligibilityAssessmentORM:
    def test_table_name(self):
        assert EligibilityAssessmentORM.__tablename__ == "eligibility_assessments"

    def test_has_required_columns(self):
        col_names = {c.name for c in EligibilityAssessmentORM.__table__.columns}
        required = {
            "id", "project_id", "pdr_class", "criteria", "verdict",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)


class TestFinancialAppraisalORM:
    def test_table_name(self):
        assert FinancialAppraisalORM.__tablename__ == "financial_appraisals"

    def test_has_required_columns(self):
        col_names = {c.name for c in FinancialAppraisalORM.__table__.columns}
        required = {
            "id", "project_id", "name", "inputs_snapshot",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_has_no_legacy_metric_columns(self):
        """R16b spec Sec 26.3: outputs.metrics is the only stored copy."""
        col_names = {c.name for c in FinancialAppraisalORM.__table__.columns}
        metrics = {
            "gdv_pence", "total_cost_pence", "profit_on_cost_pct",
            "profit_on_gdv_pct", "return_on_equity_pct", "irr", "rlv_pence",
        }
        assert metrics.isdisjoint(col_names)


class TestStageTransitionORM:
    def test_table_name(self):
        assert StageTransitionORM.__tablename__ == "stage_transitions"

    def test_has_required_columns(self):
        col_names = {c.name for c in StageTransitionORM.__table__.columns}
        required = {"id", "project_id", "from_stage", "to_stage", "transitioned_at"}
        assert required.issubset(col_names)


class TestLenderCaseORM:
    def test_table_name(self):
        assert LenderCaseORM.__tablename__ == "lender_cases"

    def test_has_required_columns(self):
        col_names = {c.name for c in LenderCaseORM.__table__.columns}
        required = {
            "id", "project_id", "status",
            "locked_inputs_snapshot", "locked_calc_version", "locked_inputs_version",
            "locked_input_hash", "locked_outputs_hash", "locked_audit_hash",
            "case_hash", "created_by", "submitted_by", "reviewer", "decided_by",
            "conditions", "submitted_at", "decided_at", "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_live_case_index_is_partial_and_unique(self):
        idx = next(i for i in LenderCaseORM.__table__.indexes
                   if i.name == "uq_lender_case_live_project")
        assert idx.unique
        # Declared for BOTH dialects so Alembic and the create_all boot path
        # agree on every backend the app runs on. (`sqlite_where=`/`
        # `postgresql_where=` kwargs surface as the "where" dialect option.)
        assert idx.dialect_options["sqlite"]["where"] is not None
        assert idx.dialect_options["postgresql"]["where"] is not None


class TestLenderCaseEventORM:
    def test_table_name(self):
        assert LenderCaseEventORM.__tablename__ == "lender_case_events"

    def test_has_required_columns(self):
        col_names = {c.name for c in LenderCaseEventORM.__table__.columns}
        required = {"id", "case_id", "from_status", "to_status", "actor", "note", "occurred_at"}
        assert required.issubset(col_names)


    def test_has_r17_governance_columns(self):
        """R17 spec Sec 10.4: actor identity, idempotency and the per-event record."""
        col_names = {c.name for c in LenderCaseEventORM.__table__.columns}
        required = {
            "actor_user_id", "idempotency_key", "reason", "input_snapshot_hash",
            "outputs_hash", "case_hash_after", "case_version_after",
        }
        assert required.issubset(col_names)

    def test_idempotency_index_is_unique_on_case_and_key(self):
        idx = next(i for i in LenderCaseEventORM.__table__.indexes
                   if i.name == "uq_lender_case_event_idempotency")
        assert idx.unique
        assert [c.name for c in idx.columns] == ["case_id", "idempotency_key"]


class TestLenderCaseR17Columns:
    def test_version_and_user_ids(self):
        """R17 spec Sec 10.2: version starts at 1 server-side; the four user
        FKs are nullable so pre-R17 rows keep loading."""
        cols = {c.name: c for c in LenderCaseORM.__table__.columns}
        assert cols["version"].server_default.arg == "1"
        assert not cols["version"].nullable
        for name in ("created_by_user_id", "submitted_by_user_id",
                     "reviewer_user_id", "decided_by_user_id"):
            assert cols[name].nullable
            assert {fk.target_fullname for fk in cols[name].foreign_keys} == {"users.id"}


class TestUserORM:
    def test_table_name(self):
        assert UserORM.__tablename__ == "users"

    def test_has_required_columns(self):
        col_names = {c.name for c in UserORM.__table__.columns}
        required = {
            "id", "email", "display_name", "role", "password_hash", "password_salt",
            "is_active", "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_email_is_unique(self):
        idx = next(i for i in UserORM.__table__.indexes if i.name == "uq_users_email")
        assert idx.unique


class TestBenchmarkSetORM:
    def test_table_name(self):
        assert BenchmarkSetORM.__tablename__ == "benchmark_sets"

    def test_has_required_columns(self):
        col_names = {c.name for c in BenchmarkSetORM.__table__.columns}
        required = {
            "id", "name", "provider_type", "provider_name", "source_title", "source_url",
            "source_publication_date", "retrieved_at", "licence_or_permission",
            "dataset_version", "building_function", "project_type", "specification_level",
            "region", "location_factor", "location_factor_source", "base_date",
            "base_index_name", "base_index_value", "current_index_name",
            "current_index_value", "index_dataset_version", "currentisation_date",
            "currency", "notes", "imported_by", "imported_by_user_id",
            "source_file_sha256", "content_hash", "created_at",
        }
        assert required.issubset(col_names)

    def test_content_is_unique_per_provider_and_version(self):
        idx = next(i for i in BenchmarkSetORM.__table__.indexes
                   if i.name == "uq_benchmark_set_content")
        assert idx.unique
        assert [c.name for c in idx.columns] == ["provider_type", "dataset_version", "content_hash"]


class TestBenchmarkRateORM:
    def test_table_name(self):
        assert BenchmarkRateORM.__tablename__ == "benchmark_rates"

    def test_has_required_columns(self):
        col_names = {c.name for c in BenchmarkRateORM.__table__.columns}
        required = {
            "id", "set_id", "element_code", "element_label", "description",
            "measurement_basis", "original_unit", "original_rate_pence", "rate_pct",
            "lower_quartile_rate_pence", "median_rate_pence", "upper_quartile_rate_pence",
            "sample_count", "location_factor", "evidence_status", "source_reference",
            "notes", "position",
        }
        assert required.issubset(col_names)

    def test_rates_cascade_from_set(self):
        rel = BenchmarkSetORM.__mapper__.relationships["rates"]
        assert rel.cascade.delete


class TestIndexDatasetORM:
    def test_table_name(self):
        assert IndexDatasetORM.__tablename__ == "index_datasets"

    def test_has_required_columns(self):
        col_names = {c.name for c in IndexDatasetORM.__table__.columns}
        required = {
            "id", "publisher", "series_code", "series_name", "dataset_version", "source_url",
            "licence", "publication_date", "retrieved_at", "base_period", "source_file_sha256",
            "content_hash", "imported_by", "imported_by_user_id", "notes", "created_at",
        }
        assert required.issubset(col_names)

    def test_version_is_unique_per_publisher_and_series(self):
        idx = next(i for i in IndexDatasetORM.__table__.indexes
                   if i.name == "uq_index_dataset_version")
        assert idx.unique
        assert [c.name for c in idx.columns] == ["publisher", "series_code", "dataset_version"]


class TestIndexObservationORM:
    def test_table_name(self):
        assert IndexObservationORM.__tablename__ == "index_observations"

    def test_has_required_columns(self):
        col_names = {c.name for c in IndexObservationORM.__table__.columns}
        assert {"id", "dataset_id", "period", "value"}.issubset(col_names)

    def test_period_is_unique_per_dataset(self):
        idx = next(i for i in IndexObservationORM.__table__.indexes
                   if i.name == "uq_index_observation_period")
        assert idx.unique
        assert [c.name for c in idx.columns] == ["dataset_id", "period"]


class TestAppraisalVersionORM:
    def test_table_name(self):
        assert AppraisalVersionORM.__tablename__ == "appraisal_versions"

    def test_has_required_columns(self):
        col_names = {c.name for c in AppraisalVersionORM.__table__.columns}
        required = {
            "id", "project_id", "appraisal_id", "reason", "inputs_snapshot", "outputs",
            "validation", "calc_version", "inputs_version", "status", "input_hash",
            "outputs_hash", "audit_hash", "superseded_at", "superseded_by_user_id",
            "superseded_by",
        }
        assert required.issubset(col_names)


class TestCascadeRelationships:
    def test_project_has_relationships(self):
        rel_names = {r.key for r in ProjectORM.__mapper__.relationships}
        assert "eligibility_assessments" in rel_names
        assert "financial_appraisals" in rel_names
        assert "stage_transitions" in rel_names
        assert "lender_cases" in rel_names


class TestBaseMetadata:
    def test_all_tables_registered(self):
        table_names = set(Base.metadata.tables.keys())
        expected = {
            "projects", "eligibility_assessments", "financial_appraisals", "stage_transitions",
            "lender_cases", "lender_case_events",
            "users", "benchmark_sets", "benchmark_rates", "index_datasets",
            "index_observations", "appraisal_versions",
        }
        assert expected.issubset(table_names)
