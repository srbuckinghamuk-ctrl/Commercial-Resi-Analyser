from uuid import uuid4

import pytest

from app.persistence.database import (
    ProjectORM,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    StageTransitionORM,
    LenderCaseORM,
    LenderCaseEventORM,
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
        }
        assert expected.issubset(table_names)
