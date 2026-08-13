"""Transliteration of the non-cash equity slice of
frontend/src/lib/model/validation.test.ts (spec Sec 2, C1 -- round-2 review).

Both implementations must agree with the spec, not merely with each other. If
Python disagrees, the Python port is wrong -- never adjust these to make peace.
"""
from app.financial_model.engine import run_ledger
from app.financial_model.migrate import default_calculator_inputs_v2, migrate_v2_to_v3
from app.financial_model.schedule import build_schedule
from app.financial_model.types import (
    CalculatorInputsV2,
    CalculatorInputsV3,
    EquitySource,
    LenderValuation,
    ProposedUnit,
)
from app.financial_model.validation import reconcile, validate_inputs


def base_inputs() -> CalculatorInputsV2:
    inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
    inputs.unit_mix.units = [ProposedUnit(
        id="u1", type="1bed", floor_area_sqm=50,
        estimated_value_pence=25_000_000, comparable_notes="",
    )]
    inputs.acquisition.purchase_price_pence = 10_000_000
    return inputs


PROVENANCE = {"reason": "Test haircut", "author": "test-author", "date": "2026-08-13"}


def base_inputs_v3() -> CalculatorInputsV3:
    inputs = CalculatorInputsV3.model_validate(migrate_v2_to_v3(default_calculator_inputs_v2()))
    inputs.unit_mix.units = [
        ProposedUnit(
            id="u1", type="1bed", floor_area_sqm=50,
            estimated_value_pence=25_000_000, comparable_notes="",
        ),
        ProposedUnit(
            id="u2", type="1bed", floor_area_sqm=50,
            estimated_value_pence=25_000_000, comparable_notes="",
        ),
    ]
    inputs.acquisition.purchase_price_pence = 10_000_000
    return inputs


class TestValidateInputsNonCashEquityWarning:
    def test_warns_when_a_non_cash_equity_source_has_a_positive_amount(self):
        inputs = base_inputs()
        inputs.equity_sources = [EquitySource(
            id="e1", classification="land", amount_pence=10_000_000, timing_month=0,
            repayment_priority=1, evidence_status="confirmed", notes="",
        )]
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "warning" and i.field == "equity_sources[0]"
            and "Non-cash equity" in i.message
            and "not yet modelled as funding" in i.message
            for i in issues
        ), issues

    def test_does_not_warn_for_a_zero_amount_non_cash_source_or_a_cash_source(self):
        inputs = base_inputs()
        inputs.equity_sources = [
            EquitySource(
                id="e1", classification="vendor_finance", amount_pence=0, timing_month=0,
                repayment_priority=1, evidence_status="confirmed", notes="",
            ),
            EquitySource(
                id="e2", classification="cash", amount_pence=10_000_000, timing_month=0,
                repayment_priority=1, evidence_status="confirmed", notes="",
            ),
        ]
        issues = validate_inputs(inputs)
        assert not any("Non-cash equity" in i.message for i in issues)


class TestReconcileNonCashEquityExploit:
    """C1 pinning test (spec Sec 2, round-2 review exploit): an unconfirmed
    planning_uplift source large enough to cover every cost must not be
    treated as committed equity -- it produces a real funding gap."""

    def test_fails_report_safe_when_the_only_equity_is_unconfirmed_planning_uplift(self):
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        inputs.acquisition.purchase_price_pence = 40_000_000
        inputs.unit_mix.units = [
            ProposedUnit(
                id=f"u{n}", type="1bed", floor_area_sqm=50,
                estimated_value_pence=30_000_000, comparable_notes="",
            )
            for n in (1, 2, 3, 4)
        ]
        inputs.conversion_costs.total_construction_sqm = 200
        inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000
        inputs.finance.funding_source = "cash"
        inputs.equity_sources = [EquitySource(
            id="e1", classification="planning_uplift", amount_pence=200_000_000,
            timing_month=0, repayment_priority=1, evidence_status="unconfirmed", notes="",
        )]
        schedule = build_schedule(inputs)
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        assert model.totals.funding_gap_pence > 0

        rec = reconcile(inputs, schedule, model)
        assert rec.funding_complete is False
        assert rec.report_safe is False


class TestValidateInputsLenderValuationHardErrors:
    """Release 2b Task 3 (spec Sec 3.2): lender_valuation hard errors, mirrored
    in validation.ts with the same messages."""

    def test_accepts_no_issues_for_a_well_formed_global_pct_block(self):
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="global_pct", global_value=-10, per_key_values=None, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("lender_valuation")] == []

    def test_rejects_an_empty_reason_author_date(self):
        # Pydantic's Field(min_length=1) already blocks empty strings at
        # LenderValuation construction time -- this can never happen through
        # the normal validated-model boundary a real caller goes through.
        # model_construct bypasses field validators so the defense-in-depth
        # check in validate_inputs (mirroring validation.ts, which has no such
        # boundary since TS fixtures/JSON are never runtime-validated) can
        # still be exercised and proven correct.
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation.model_construct(
            basis="global_pct", global_value=-10, per_key_values=None,
            reason="", author="", date="",
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "lender_valuation.reason" for i in issues)
        assert any(i.severity == "error" and i.field == "lender_valuation.author" for i in issues)
        assert any(i.severity == "error" and i.field == "lender_valuation.date" for i in issues)

    def test_rejects_a_missing_global_value_for_a_basis_that_requires_it(self):
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="fixed_amount", global_value=None, per_key_values=None, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "lender_valuation"
            and i.message == 'Lender valuation basis "fixed_amount" requires a global_value.'
            for i in issues
        ), issues

    def test_rejects_a_missing_per_unit_id(self):
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="per_unit", global_value=None, per_key_values={"u1": 25_000_000}, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "lender_valuation"
            and 'missing a value for unit "u2"' in i.message
            for i in issues
        ), issues

    def test_rejects_a_non_positive_computed_lender_unit_value(self):
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="global_pct", global_value=-100, per_key_values=None, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "lender_valuation" and "must be positive" in i.message
            for i in issues
        ), issues

    def test_rejects_fractional_pence_for_global_per_sqft(self):
        """Task-1-review addition."""
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="global_per_sqft", global_value=200_000.5, per_key_values=None, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "lender_valuation.global_value"
            and "whole number of pence" in i.message
            for i in issues
        ), issues

    def test_rejects_fractional_pence_for_a_per_unit_value(self):
        """Task-1-review addition."""
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="per_unit", global_value=None,
            per_key_values={"u1": 25_000_000.5, "u2": 25_000_000}, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "lender_valuation.per_key_values[u1]"
            and "whole number of pence" in i.message
            for i in issues
        ), issues

    def test_allows_a_fractional_global_pct_percentage_adjustment(self):
        inputs = base_inputs_v3()
        inputs.lender_valuation = LenderValuation(
            basis="global_pct", global_value=-7.5, per_key_values=None, **PROVENANCE,
        )
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("lender_valuation")] == []
