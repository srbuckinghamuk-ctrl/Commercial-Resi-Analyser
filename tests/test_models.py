import uuid
from datetime import datetime

import pytest

from app.models import (
    UseClass,
    PdrClass,
    PipelineStage,
    EligibilityVerdict,
    Tenure,
    Address,
    PriceInfo,
    CommercialListing,
    Project,
    ProjectCreate,
    EligibilityCriterion,
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    StageTransition,
    StageTransitionCreate,
)


class TestEnums:
    def test_use_class_values(self):
        assert UseClass.OFFICE == "office"
        assert UseClass.RETAIL == "retail"
        assert UseClass.LIGHT_INDUSTRIAL == "light_industrial"
        assert UseClass.AGRICULTURAL == "agricultural"
        assert UseClass.SUI_GENERIS == "sui_generis"

    def test_pdr_class_values(self):
        assert PdrClass.CLASS_MA == "class_ma"
        assert PdrClass.CLASS_G == "class_g"
        assert PdrClass.CLASS_M == "class_m"
        assert PdrClass.CLASS_N == "class_n"
        assert PdrClass.CLASS_Q == "class_q"

    def test_pipeline_stage_order(self):
        stages = list(PipelineStage)
        assert stages[0] == PipelineStage.OPPORTUNITY_IDENTIFIED
        assert stages[-1] == PipelineStage.COMPLETE

    def test_eligibility_verdict_values(self):
        assert EligibilityVerdict.GREEN == "green"
        assert EligibilityVerdict.AMBER == "amber"
        assert EligibilityVerdict.RED == "red"


class TestAddress:
    def test_address_creation(self):
        addr = Address(
            raw="123 High Street, London, SW1A 1AA",
            line1="123 High Street",
            town="London",
            postcode="SW1A 1AA",
            postcode_district="SW1A",
        )
        assert addr.postcode == "SW1A 1AA"
        assert addr.line2 is None


class TestPriceInfo:
    def test_price_in_pence(self):
        price = PriceInfo(amount=50000000, currency="GBP", qualifier="guide_price")
        assert price.amount == 50000000  # £500,000 in pence


class TestCommercialListing:
    def test_listing_defaults(self):
        listing = CommercialListing(
            address=Address(raw="1 Test St", postcode="E1 1AA", postcode_district="E1"),
            price=PriceInfo(amount=30000000),
            use_class=UseClass.OFFICE,
            source_url="https://example.com/listing/1",
            source_name="allsop_commercial",
        )
        assert listing.id is not None
        assert listing.tenure == Tenure.UNKNOWN
        assert listing.floor_area_sqft is None
        assert listing.floors is None
        assert listing.is_vacant is None


class TestProject:
    def test_project_create(self):
        create = ProjectCreate(
            address_raw="1 Test St, London, E1 1AA",
            address_line1="1 Test St",
            address_town="London",
            address_postcode="E1 1AA",
            address_postcode_district="E1",
            price_pence=30000000,
            use_class=UseClass.OFFICE,
        )
        assert create.price_pence == 30000000
        assert create.stage == PipelineStage.OPPORTUNITY_IDENTIFIED


class TestEligibilityAssessment:
    def test_criterion_creation(self):
        criterion = EligibilityCriterion(
            key="floor_area_limit",
            label="Floor area ≤ 1,500 sq m",
            passed=True,
            source="auto",
            auto_checked=True,
            value="1200 sq m",
        )
        assert criterion.passed is True
        assert criterion.auto_checked is True

    def test_assessment_create(self):
        create = EligibilityAssessmentCreate(
            project_id=uuid.uuid4(),
            pdr_class=PdrClass.CLASS_MA,
            criteria=[
                EligibilityCriterion(
                    key="floor_area_limit",
                    label="Floor area ≤ 1,500 sq m",
                    passed=True,
                    source="auto",
                    auto_checked=True,
                ),
            ],
            verdict=EligibilityVerdict.AMBER,
        )
        assert create.verdict == EligibilityVerdict.AMBER


class TestFinancialAppraisal:
    def test_appraisal_create(self):
        create = FinancialAppraisalCreate(
            project_id=uuid.uuid4(),
            name="Office Conversion - 1 Test St",
            inputs_snapshot={"purchase_price_pence": 30000000},
            gdv_pence=60000000,
            total_cost_pence=45000000,
            profit_on_cost_pct=33.33,
            profit_on_gdv_pct=25.0,
            irr=18.5,
        )
        assert create.gdv_pence == 60000000


class TestStageTransition:
    def test_stage_transition_create(self):
        create = StageTransitionCreate(
            project_id=uuid.uuid4(),
            from_stage=PipelineStage.OPPORTUNITY_IDENTIFIED,
            to_stage=PipelineStage.ELIGIBILITY_ASSESSED,
            notes="Eligibility assessment completed",
        )
        assert create.to_stage == PipelineStage.ELIGIBILITY_ASSESSED
