"""Transliteration of the non-cash equity slice of
frontend/src/lib/model/validation.test.ts (spec Sec 2, C1 -- round-2 review).

Both implementations must agree with the spec, not merely with each other. If
Python disagrees, the Python port is wrong -- never adjust these to make peace.
"""
import json
import pathlib

import pydantic
import pytest
from pydantic import ValidationError

from app.financial_model import run_appraisal
from app.financial_model.areas import DEFAULT_AREA_BRIDGE
from app.financial_model.engine import run_ledger
from app.financial_model.migrate import (
    PROGRAMME_FIELD_ALIASES,
    default_calculator_inputs_v2,
    migrate_inputs_to_v4,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_inputs_to_v8,
    migrate_inputs_to_v9,
    migrate_inputs_to_v10,
    migrate_inputs_to_v12,
    migrate_inputs_to_v13,
    migrate_v2_to_v3,
    migrate_v6_to_v7,
    migrate_v8_to_v9,
)
from app.financial_model.schedule import build_schedule
from app.financial_model.types import (
    AreaBridgeInputs,
    CalculatorInputsV2,
    CalculatorInputsV3,
    CalculatorInputsV4,
    CalculatorInputsV6,
    CalculatorInputsV7,
    CalculatorInputsV8,
    CalculatorInputsV9,
    CalculatorInputsV10,
    CalculatorInputsV11,
    CategoryPhaseIds,
    ContingencyClass,
    CostPackage,
    CostPlanInputs,
    DdItem,
    Dependency,
    EquitySource,
    FeeLine,
    LenderValuation,
    MONITORING_CATEGORIES,
    MonitoringCategory,
    MonitoringLineInputs,
    OperatingLine,
    Phase,
    PhaseAnchor,
    ProgrammeInputs,
    ProgrammeNetwork,
    ProgrammePackage,
    ProgrammePackages,
    ProposedUnit,
    ProposedUnitV6,
    QsProvenance,
    RefinanceInputs,
    RefinanceInputsV9,
    RetainedUnit,
    SalesPhasingInputsV9,
    SalesPhasingTrancheV9,
    SimpleSpendCurve,
    SourceRecord,
    UnitMixInputsV6,
    UserDefinedSpendCurve,
    VatOverride,
)
from app.financial_model.validation import reconcile, validate_inputs
from app.financial_model.vat import DEFAULT_VAT, VAT_CHARGE_CATEGORIES, default_vat_treatments

from .fixtures_due_diligence import QS, dd_doc, raw_y_as_v12
from .fixtures_investment_case import ic_doc
from .fixtures_unit_sales import no_programme_doc, unit_sales_doc

FIXTURE_DIR = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


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


class TestV4ProgrammeValidation:
    """Transliteration of validation.test.ts's `v4 programme validation`
    describe block (Release 3a Task 5, spec Sec 6.1 / calc 2.2.0)."""

    OK = {"start_offset": 1, "duration_months": 6, "curve": {"kind": "straight_line"}}

    def with_programme(self, pkg: dict) -> CalculatorInputsV4:
        doc = migrate_inputs_to_v4({})
        doc["finance"]["term_months"] = 12
        doc["programme"] = {
            "anchor_month": None,
            "packages": {
                "construction": {**self.OK, **pkg},
                "professional": {**self.OK},
                "statutory": {**self.OK},
            },
        }
        return CalculatorInputsV4.model_validate(doc)

    @staticmethod
    def errors_on(field_: str, v4: CalculatorInputsV4) -> bool:
        return any(
            i.severity == "error" and i.field.startswith(field_) for i in validate_inputs(v4)
        )

    def test_accepts_a_well_formed_programme(self):
        issues = validate_inputs(self.with_programme({}))
        assert [i for i in issues if i.field.startswith("programme")] == []

    def test_rejects_duration_below_1(self):
        assert self.errors_on(
            "programme.packages.construction", self.with_programme({"duration_months": 0}),
        )

    def test_rejects_negative_start_offset(self):
        assert self.errors_on(
            "programme.packages.construction", self.with_programme({"start_offset": -1}),
        )

    def test_rejects_a_window_breaching_the_two_month_sale_tail(self):
        # start 6 + duration 6 - 1 = 11 > term - 2 = 10 (start 5 is the legal
        # boundary: 10 <= 10)
        assert self.errors_on(
            "programme.packages.construction",
            self.with_programme({"start_offset": 6, "duration_months": 6}),
        )
        assert not self.errors_on(
            "programme.packages.construction",
            self.with_programme({"start_offset": 5, "duration_months": 6}),
        )

    def test_rejects_user_defined_weights_wrong_length_negative_or_all_zero(self):
        for weights in ([1, 2], [1, -1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]):
            assert self.errors_on(
                "programme.packages.construction",
                self.with_programme({"curve": {"kind": "user_defined", "weights": weights}}),
            ), weights

    def test_rejects_non_finite_user_defined_weights(self):
        """I3 (final R3a review): NaN slips past every other weight rule -- NaN < 0
        is False, and a sum containing NaN is never <= 0 -- and then reaches
        build_schedule, which raises `ValueError: cannot convert float NaN to
        integer` (a 500 at the API boundary). json.loads accepts literal
        NaN/Infinity, so this is reachable straight off the wire."""
        for weights in (
            [1, float("nan"), 1, 1, 1, 1],
            [1, float("inf"), 1, 1, 1, 1],
            [1, float("-inf"), 1, 1, 1, 1],
        ):
            issues = validate_inputs(
                self.with_programme({"curve": {"kind": "user_defined", "weights": weights}}),
            )
            assert any(
                i.field == "programme.packages.construction"
                and i.severity == "error"
                and i.message == "user_defined weights must be finite numbers."
                for i in issues
            ), weights

    def test_fractional_duration_months_is_rejected_by_pydantic_at_parse(self):
        """CRITICAL 1b: validation.py gained a Number.isInteger-equivalent check
        for textual parity with validation.ts, but it is unreachable in practice
        here -- ProgrammePackage.duration_months/start_offset are typed `int`,
        so Pydantic already rejects a fractional value at parse (a 422), before
        validate_inputs ever runs. This pins that parse-time rejection, which is
        why the rule is comment-only, not test-reachable, on the Python side."""
        with pytest.raises(pydantic.ValidationError):
            self.with_programme({"duration_months": 2.5})

    def test_fractional_start_offset_is_rejected_by_pydantic_at_parse(self):
        with pytest.raises(pydantic.ValidationError):
            self.with_programme({"start_offset": 1.5})

    def test_every_package_is_checked_not_just_the_first(self):
        """Deviation-guard (no TS counterpart): Python iterates a fixed tuple
        rather than `Object.entries`, so this pins that all three packages are
        actually visited and reported under their own field path."""
        doc = migrate_inputs_to_v4({})
        doc["finance"]["term_months"] = 12
        doc["programme"] = {
            "anchor_month": None,
            "packages": {
                "construction": {**self.OK},
                "professional": {**self.OK, "start_offset": -1},
                "statutory": {**self.OK, "duration_months": 0},
            },
        }
        v4 = CalculatorInputsV4.model_validate(doc)
        assert not self.errors_on("programme.packages.construction", v4)
        assert self.errors_on("programme.packages.professional", v4)
        assert self.errors_on("programme.packages.statutory", v4)


class TestV4SalesPhasingValidation:
    """Transliteration of validation.test.ts's `v4 sales_phasing validation
    (calc 2.3.0)` describe block (Release 3b Task 3, spec Sec 4.4.1)."""

    @staticmethod
    def with_tranches(tranches: list[dict], route: str = "sell_all") -> CalculatorInputsV4:
        doc = migrate_inputs_to_v4({})
        doc["finance"]["term_months"] = 12
        doc["exit_strategy"]["route"] = route
        doc["sales_phasing"] = {"tranches": tranches}
        return CalculatorInputsV4.model_validate(doc)

    @staticmethod
    def errors_on(field_: str, inputs: CalculatorInputsV4) -> bool:
        return any(
            i.severity == "error" and i.field.startswith(field_) for i in validate_inputs(inputs)
        )

    def test_accepts_a_well_formed_tranche_set(self):
        assert not self.errors_on("sales_phasing", self.with_tranches([
            {"month_offset": 9, "pct_of_gross_receipts": 40},
            {"month_offset": 10, "pct_of_gross_receipts": 35},
            {"month_offset": 11, "pct_of_gross_receipts": 25},
        ]))

    def test_rejects_the_block_on_retain_all(self):
        assert self.errors_on(
            "sales_phasing",
            self.with_tranches([{"month_offset": 11, "pct_of_gross_receipts": 100}], "retain_all"),
        )

    def test_rejects_an_empty_tranche_list(self):
        assert self.errors_on("sales_phasing", self.with_tranches([]))

    def test_rejects_out_of_range_non_increasing_months_and_non_positive_or_non_finite_pcts(self):
        for tranches in (
            [{"month_offset": 12, "pct_of_gross_receipts": 100}],
            [{"month_offset": -1, "pct_of_gross_receipts": 100}],
            [
                {"month_offset": 10, "pct_of_gross_receipts": 50},
                {"month_offset": 10, "pct_of_gross_receipts": 50},
            ],
            [
                {"month_offset": 10, "pct_of_gross_receipts": 50},
                {"month_offset": 9, "pct_of_gross_receipts": 50},
            ],
            [{"month_offset": 11, "pct_of_gross_receipts": 0}],
            [{"month_offset": 11, "pct_of_gross_receipts": float("nan")}],
        ):
            assert self.errors_on("sales_phasing", self.with_tranches(tranches)), tranches

    def test_rejects_percentages_not_summing_to_100_beyond_1e_9(self):
        assert self.errors_on("sales_phasing", self.with_tranches([
            {"month_offset": 10, "pct_of_gross_receipts": 60},
            {"month_offset": 11, "pct_of_gross_receipts": 39.9},
        ]))


class TestV4RefinanceValidation:
    """Transliteration of validation.test.ts's `v4 refinance validation
    (calc 2.3.0)` describe block (Release 3b Task 3, spec Sec 4.5)."""

    @staticmethod
    def with_refi(refi: dict, route: str = "retain_all") -> CalculatorInputsV4:
        doc = migrate_inputs_to_v4({})
        doc["finance"]["term_months"] = 12
        doc["exit_strategy"]["route"] = route
        doc["refinance"] = {
            "month_offset": 11, "investment_value_pence": 30_000_000, "ltv_pct": 65,
            "arrangement_fee_pence": 0, "legal_costs_pence": 0, **refi,
        }
        return CalculatorInputsV4.model_validate(doc)

    @staticmethod
    def errors_on(inputs: CalculatorInputsV4) -> bool:
        return any(
            i.severity == "error" and i.field.startswith("refinance") for i in validate_inputs(inputs)
        )

    def test_accepts_a_well_formed_block_on_retain_all_and_blended(self):
        assert not self.errors_on(self.with_refi({}))
        assert not self.errors_on(self.with_refi({}, "blended"))

    def test_rejects_the_block_on_sell_all(self):
        assert self.errors_on(self.with_refi({}, "sell_all"))

    def test_rejects_bad_months_values_fees_and_ltv(self):
        for bad in (
            {"month_offset": 12}, {"month_offset": -1},
            {"investment_value_pence": -1},
            {"ltv_pct": 0}, {"ltv_pct": 101}, {"ltv_pct": float("nan")},
            {"arrangement_fee_pence": -1}, {"legal_costs_pence": -1},
        ):
            assert self.errors_on(self.with_refi(bad)), bad


class TestReconcileRefinanceShortfall:
    """Coordinator fix (spec Sec 4.5/Sec 7, fixture J invariant-matrix defect): a
    refinance whose net proceeds fall short of the outstanding balance + exit fee
    injects additional equity to fund the facility's full redemption -- a
    financing-side flow, like sale-proceeds repayments, that spec Sec 7's
    sources-and-uses identity deliberately excludes."""

    def test_a_refinance_shortfall_does_not_break_sources_equal_uses_reconciliation(self):
        doc = migrate_inputs_to_v4({})
        inputs = CalculatorInputsV4.model_validate(doc)
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
        inputs.finance.committed_net_facility_pence = 50_000_000
        inputs.finance.committed_gross_facility_pence = 55_000_000
        inputs.finance.day_one_advance_pence = 30_000_000
        inputs.finance.term_months = 12
        inputs.equity_sources[0].amount_pence = 40_000_000
        inputs.exit_strategy.route = "retain_all"
        # Net proceeds = round(1,000,000 x 50 / 100) - 0 - 0 = 500,000 -- a small fraction
        # of the outstanding senior balance, guaranteeing the shortfall branch fires.
        inputs.refinance = RefinanceInputs(
            month_offset=11, investment_value_pence=1_000_000, ltv_pct=50,
            arrangement_fee_pence=0, legal_costs_pence=0,
        )
        schedule = build_schedule(inputs)
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        assert model.totals.refinance_shortfall_equity_pence > 0
        rec = reconcile(inputs, schedule, model)
        assert rec.sources_equal_uses is True
        assert any(f.code == "additional_equity_required" for f in model.flags)


class TestAcquisitionTaxValidation:
    """Port of the R8 'acquisition tax validation' describe block in
    validation.test.ts -- same field codes, severities and messages."""

    @staticmethod
    def v5():
        return migrate_inputs_to_v5({"inputs_version": 1})

    def test_rejects_an_override_with_no_reason(self):
        inputs = self.v5()
        inputs.acquisition.acquisition_tax_override_pence = 500_000
        inputs.acquisition.acquisition_tax_override_reason = "   "
        issues = validate_inputs(inputs)
        issue = next(
            (i for i in issues if i.field == "acquisition.acquisition_tax_override_reason"), None,
        )
        assert issue is not None
        assert issue.severity == "error"

    def test_accepts_an_override_with_a_reason(self):
        inputs = self.v5()
        inputs.acquisition.acquisition_tax_override_pence = 500_000
        inputs.acquisition.acquisition_tax_override_reason = "Group relief claimed."
        issues = validate_inputs(inputs)
        assert not any(i.field == "acquisition.acquisition_tax_override_reason" for i in issues)

    def test_rejects_an_acquisition_date_no_band_set_covers(self):
        inputs = self.v5()
        inputs.acquisition.jurisdiction = "wales"
        inputs.acquisition.acquisition_date = "1990-01-01"
        issue = next(
            (i for i in validate_inputs(inputs) if i.field == "acquisition.acquisition_date"), None,
        )
        assert issue is not None
        assert issue.severity == "error"
        assert "2020-12-22" in issue.message

    def test_rejects_a_malformed_acquisition_date(self):
        inputs = self.v5()
        inputs.acquisition.acquisition_date = "17/08/2026"
        issue = next(
            (i for i in validate_inputs(inputs) if i.field == "acquisition.acquisition_date"), None,
        )
        assert issue is not None
        assert issue.severity == "error"

    # R9 Task 12 -- the R8 carry-forward. The shape-only regex that stood here until
    # this release accepted any four-two-two digit string, so "2026-02-31" validated
    # and was then reported as date_basis 'transaction_date'. Both halves are asserted:
    # the impossible date is rejected, and a real leap day is still accepted -- a check
    # that rejected every February date would satisfy the first alone. Mirrors
    # validation.test.ts.
    @pytest.mark.parametrize("bad_date", [
        "2026-02-31", "2026-13-01", "2026-00-15", "2026-01-00", "2026-04-31", "2027-02-29",
    ])
    def test_rejects_a_date_that_matches_the_pattern_but_does_not_exist(self, bad_date):
        issues = validate_inputs(make_v6_inputs(acquisition={"acquisition_date": bad_date}))
        assert any(
            i.severity == "error" and i.field == "acquisition.acquisition_date"
            for i in issues
        )

    def test_accepts_29_february_in_a_leap_year(self):
        issues = validate_inputs(make_v6_inputs(acquisition={"acquisition_date": "2028-02-29"}))
        assert [i for i in issues if i.field == "acquisition.acquisition_date"] == []

    def test_warns_but_does_not_error_on_an_unconfirmed_jurisdiction(self):
        inputs = self.v5()
        issues = validate_inputs(inputs)
        issue = next(
            (i for i in issues if i.field == "acquisition.jurisdiction_evidence_status"), None,
        )
        assert issue is not None
        assert issue.severity == "warning"
        assert not any(i.severity == "error" for i in issues)

    # Fix round 1. Before this fix, run_appraisal computed the acquisition cost
    # stack (build_schedule/derive_metrics) *before* validate_inputs ran, and
    # both reached select_band_set unwrapped -- a bad date crashed the whole
    # appraisal with an uncaught ValueError instead of surfacing the
    # field-level error above. This proves the full pipeline now degrades
    # instead of raising, while the hard error (and report_safe=False) still
    # fire. Mirrors validation.test.ts.
    @pytest.mark.parametrize("bad_date", ["1990-01-01", "17/08/2026"])
    def test_completes_the_full_pipeline_on_a_bad_date_instead_of_raising(self, bad_date):
        inputs = self.v5()
        inputs.acquisition.acquisition_date = bad_date

        run = run_appraisal(inputs)  # must not raise

        assert run.metrics.acquisition_tax.date_basis == "assumed_current"
        issue = next(
            (i for i in run.validation if i.field == "acquisition.acquisition_date"), None,
        )
        assert issue is not None
        assert issue.severity == "error"
        assert run.reconciliation.report_safe is False


def make_v6_inputs(
    *,
    areas: dict | None = None,
    units: list[dict] | None = None,
    conversion_costs: dict | None = None,
    acquisition: dict | None = None,
) -> CalculatorInputsV6:
    """R9 (Task 8). A structurally-valid v6 document built off the migration
    chain's own defaults -- the Python twin of validation.test.ts's
    makeV6Inputs. Only `areas`/`units`/`conversion_costs`/`acquisition` are
    accepted since that is all the area-bridge and calendar-date suites need."""
    v6 = migrate_inputs_to_v6({"inputs_version": 1})
    if acquisition is not None:
        v6.acquisition = v6.acquisition.model_copy(update=acquisition)
    if areas is not None:
        v6.areas = AreaBridgeInputs(**areas)
    if conversion_costs is not None:
        v6.conversion_costs = v6.conversion_costs.model_copy(update=conversion_costs)
    if units is not None:
        v6.unit_mix = UnitMixInputsV6(units=[
            ProposedUnitV6(
                id=u["id"],
                type=u.get("type", "1bed"),
                floor_area_sqm=u["floor_area_sqm"],
                estimated_value_pence=u["estimated_value_pence"],
                comparable_notes=u.get("comparable_notes", ""),
            )
            for u in units
        ])
    return v6


def _negative_area(field_name: str) -> AreaBridgeInputs:
    """AreaBridgeInputs fields all carry `Field(ge=0)`, so a negative value is
    unreachable through the ordinary Pydantic boundary -- `model_construct`
    bypasses validation, the same established idiom
    TestValidateInputsLenderValuationHardErrors uses for LenderValuation, to
    pin validate_inputs's defense-in-depth check as correct anyway."""
    data = {**DEFAULT_AREA_BRIDGE, field_name: -1.0}
    return AreaBridgeInputs.model_construct(**data)


class TestAreaBridgeValidation:
    """R9 (Task 8, spec Sec 15.6). Python twin of the 'R9 - area bridge
    validation' describe block in validation.test.ts -- same fields,
    severities and gating logic."""

    AREA_FIELDS = [
        "existing_gia_sqm", "demolished_gia_sqm", "extension_gia_sqm",
        "retained_commercial_gia_sqm", "untouched_gia_sqm", "circulation_common_sqm",
        "plant_riser_sqm", "store_bin_cycle_sqm", "amenity_sqm", "external_amenity_sqm",
    ]

    def test_hard_errors_on_a_negative_entered_area_for_every_bridge_field(self):
        for field_name in self.AREA_FIELDS:
            inputs = make_v6_inputs()
            inputs.areas = _negative_area(field_name)
            issues = validate_inputs(inputs)
            assert any(
                i.severity == "error" and i.field == f"areas.{field_name}" for i in issues
            ), field_name

    def test_does_not_hard_error_on_an_all_zero_bridge(self):
        inputs = make_v6_inputs(areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"})
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("areas.")] == []

    def test_does_not_hard_error_on_an_all_zero_bridge_with_a_real_unit_schedule(self):
        """Review fix round 1 (Important 1): the case above passes no units,
        so it never exercises `bridge.developed_gia_sqm > 0` -- the guard that
        keeps the units-over-fill hard error inert for a zeroed bridge. A
        zeroed bridge WITH a real unit schedule is exactly the state every
        migrated legacy document is in, and is the single highest-value
        scenario for that guard. Confirmed by hand: removing
        `bridge.developed_gia_sqm > 0 and` from validation.py's
        `unit_mix.units` check makes this test fail (available_for_units_sqm
        is 0, unit_nia_sqm is 300, unallocated_sqm is -300 < 0)."""
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"},
            units=[
                {"id": "u1", "floor_area_sqm": 100, "estimated_value_pence": 1},
                {"id": "u2", "floor_area_sqm": 100, "estimated_value_pence": 1},
                {"id": "u3", "floor_area_sqm": 100, "estimated_value_pence": 1},
            ],
        )
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("areas.")] == []
        assert not any(i.severity == "error" and i.field == "unit_mix.units" for i in issues)

    def test_hard_errors_when_the_bridge_basis_is_selected_with_no_bridge(self):
        inputs = make_v6_inputs(areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived"})
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "areas.existing_gia_sqm" for i in issues
        ), issues

    def test_no_error_once_the_bridge_produces_area(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1},
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.existing_gia_sqm" for i in issues)

    def test_hard_errors_when_demolition_exceeds_the_existing_building(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
            "existing_gia_sqm": 100, "demolished_gia_sqm": 150,
        })
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "areas.demolished_gia_sqm" for i in issues
        )

    def test_no_error_when_demolition_exactly_consumes_the_existing_building(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
            "existing_gia_sqm": 100, "demolished_gia_sqm": 100,
        })
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.demolished_gia_sqm" for i in issues)

    def test_hard_errors_when_retained_and_untouched_exceed_proposed_gia(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 500,
            "retained_commercial_gia_sqm": 400, "untouched_gia_sqm": 200,
        })
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "areas.retained_commercial_gia_sqm"
            for i in issues
        )

    def test_no_error_when_retained_and_untouched_exactly_consume_proposed_gia(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 500,
            "retained_commercial_gia_sqm": 300, "untouched_gia_sqm": 200,
        })
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.retained_commercial_gia_sqm" for i in issues)

    def test_hard_errors_when_non_saleable_deductions_exceed_developed_gia(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
            "existing_gia_sqm": 100, "circulation_common_sqm": 200,
        })
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "areas.circulation_common_sqm" for i in issues
        )

    def test_no_error_when_deductions_exactly_consume_developed_gia(self):
        inputs = make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
            "existing_gia_sqm": 100, "circulation_common_sqm": 100,
        })
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.circulation_common_sqm" for i in issues)

    def test_hard_errors_when_units_over_fill_the_space_available(self):
        # Over-allocating the building is impossible, not questionable.
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 200},
            units=[{"id": "u1", "floor_area_sqm": 300, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "unit_mix.units" for i in issues)

    def test_no_error_when_the_schedule_exactly_fills_the_space_available(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 200},
            units=[{"id": "u1", "floor_area_sqm": 200, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "unit_mix.units" for i in issues)

    def test_warns_when_more_than_10pct_of_developed_area_is_unallocated(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": 100, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.unallocated_sqm" for i in issues)

    def test_no_warning_at_exactly_the_10pct_unallocated_boundary(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": 900, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.unallocated_sqm" for i in issues)

    def test_warning_just_past_the_10pct_unallocated_boundary(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": 899, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.unallocated_sqm" for i in issues)

    def test_warns_when_net_to_gross_efficiency_falls_outside_65_90pct(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": 100, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.nia_to_gia_pct" for i in issues)

    @pytest.mark.parametrize("floor_area", [650, 900])  # pct(650,1000)=65.00, pct(900,1000)=90.00
    def test_no_warning_at_exactly_the_65_and_90pct_boundaries(self, floor_area):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": floor_area, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.nia_to_gia_pct" for i in issues)

    @pytest.mark.parametrize("floor_area", [649, 901])
    def test_warning_just_past_the_65_and_90pct_boundaries(self, floor_area):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 1000},
            units=[{"id": "u1", "floor_area_sqm": floor_area, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.nia_to_gia_pct" for i in issues)

    def test_warns_when_manual_basis_disagrees_with_a_populated_bridge_by_over_5pct(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual", "existing_gia_sqm": 1000},
            conversion_costs={"total_construction_sqm": 500},
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.basis" for i in issues)

    def test_no_warning_at_exactly_the_5pct_manual_vs_bridge_boundary(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual", "existing_gia_sqm": 1000},
            conversion_costs={"total_construction_sqm": 950},
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.basis" for i in issues)

    def test_warning_just_past_the_5pct_manual_vs_bridge_boundary(self):
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual", "existing_gia_sqm": 1000},
            conversion_costs={"total_construction_sqm": 949},
        )
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == "areas.basis" for i in issues)

    def test_no_warning_when_the_bridge_itself_is_zeroed(self):
        # Every migrated pre-v6 fixture lands here: basis manual, bridge all zero.
        inputs = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"},
            conversion_costs={"total_construction_sqm": 500},
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == "areas.basis" for i in issues)

    def test_gates_the_negative_construction_area_error_on_the_manual_basis(self):
        """Binding correction to the brief: developed_area_sqm is DERIVED under
        the bridge basis, so a negative value there must not be blamed on the
        manual field the bridge-basis user cannot see -- the derived-negative
        rules above already cover it."""
        bridge_negative = validate_inputs(make_v6_inputs(areas={
            **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 500,
            "retained_commercial_gia_sqm": 400, "untouched_gia_sqm": 200,
        }))
        assert not any(i.field == "conversion_costs.total_construction_sqm" for i in bridge_negative)
        assert any(
            i.severity == "error" and i.field == "areas.retained_commercial_gia_sqm"
            for i in bridge_negative
        )

        manual_negative_inputs = make_v6_inputs(areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"})
        manual_negative_inputs.conversion_costs = manual_negative_inputs.conversion_costs.model_copy(
            update={"total_construction_sqm": -1},
        )
        manual_negative = validate_inputs(manual_negative_inputs)
        assert any(
            i.severity == "error" and i.field == "conversion_costs.total_construction_sqm"
            for i in manual_negative
        )

    def test_still_hard_errors_a_negative_construction_area_on_a_pre_v6_document(self):
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        inputs.conversion_costs.total_construction_sqm = -1
        issues = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "conversion_costs.total_construction_sqm"
            for i in issues
        )

    def test_stays_silent_on_a_bridge_that_ties_within_policy(self):
        inputs = make_v6_inputs(
            areas={
                **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
                "existing_gia_sqm": 500, "circulation_common_sqm": 50,
            },
            units=[{"id": "u1", "floor_area_sqm": 450, "estimated_value_pence": 1}],
        )
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("areas.")] == []


class TestThe25PctWarningIsRetiredNotSoftened:
    """Python twin of validation.test.ts's 'R9 - the +/-25% warning is
    retired, not softened' describe block."""

    RETIRED_25PCT = "differ by more than 25%"

    def test_is_emitted_by_no_input_at_all(self):
        # R8 lesson: a positive `in` check sails straight past an old sentence
        # being re-added ALONGSIDE the true one. Zero-counts on retired
        # strings are load-bearing.
        manual = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"},
            conversion_costs={"total_construction_sqm": 500},
            units=[{"id": "u1", "floor_area_sqm": 252, "estimated_value_pence": 1}],
        )
        bridge = make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "bridge_derived", "existing_gia_sqm": 500},
            units=[{"id": "u1", "floor_area_sqm": 252, "estimated_value_pence": 1}],
        )
        for inputs in (manual, bridge):
            issues = validate_inputs(inputs)
            assert [i for i in issues if self.RETIRED_25PCT in i.message] == []

    def test_is_absent_from_the_source_of_both_engines(self):
        repo_root = pathlib.Path(__file__).resolve().parents[1]
        py_src = (repo_root / "app" / "financial_model" / "validation.py").read_text()
        ts_src = (repo_root / "frontend" / "src" / "lib" / "model" / "validation.ts").read_text(
            encoding="utf-8",
        )
        assert self.RETIRED_25PCT not in py_src
        assert self.RETIRED_25PCT not in ts_src


def make_v7_inputs(
    *,
    cost_plan: dict | None = None,
    conversion_costs: dict | None = None,
) -> CalculatorInputsV7:
    """R10 (Task 10). A v7 document built from the migration chain's own
    defaults, the Python twin of validation.test.ts's makeV7Inputs.
    migrate_v6_to_v7 derives its cost_plan via cost_plan_from_legacy_costs, so
    the baseline is a structurally valid headline-mode plan with eight
    fixed-basis fee lines and three contingency classes, without hand-rolling
    any of it. `model_copy(update=...)` does not validate, so `cost_plan`
    values must already be model instances -- see _pkg/_fee_line below."""
    v6 = migrate_inputs_to_v6({"inputs_version": 1})
    v7 = migrate_v6_to_v7(v6)
    if conversion_costs is not None:
        v7.conversion_costs = v7.conversion_costs.model_copy(update=conversion_costs)
    if cost_plan is not None:
        v7.cost_plan = v7.cost_plan.model_copy(update=cost_plan)
    return v7


def make_v8_inputs(
    *,
    cost_plan: dict | None = None,
    conversion_costs: dict | None = None,
    finance: dict | None = None,
    exit_strategy: dict | None = None,
) -> CalculatorInputsV8:
    """R11 (Task 9, spec Sec 17.9). A v8 document built on make_v7_inputs --
    there is no migrate_v7_to_v8 yet (Task 10 lands it), so the `vat` block is
    added directly from DEFAULT_VAT here via model_dump()/model_validate(),
    mirroring _build_worked_vat_case's approach in test_vat.py. The Python twin
    of validation.test.ts's makeV8Inputs.

    The model_dump()/model_validate() roundtrip that adds the vat block runs
    on the UNMODIFIED v7 defaults, deliberately BEFORE the cost_plan/
    conversion_costs/finance/exit_strategy overrides are applied:
    model_validate() (unlike model_copy(update=...)) DOES enforce Field(ge=0),
    so applying a deliberately out-of-bounds override (e.g. a package's
    vat_override.rate_pct = -1) before that roundtrip would raise a
    pydantic.ValidationError inside this helper instead of ever reaching
    validate_inputs.

    Callers set `vat.registered`, `vat.treatments`, `vat.purchase`,
    `vat.first_period_end_month` and `vat.repayment_lag_months` by mutating the
    returned object's `.vat` attribute directly after construction -- pydantic
    models here are NOT `validate_assignment`, so this is the same established
    idiom as `_negative_area` and line 869's `inputs.conversion_costs.total_construction_sqm
    = -1` above, and it is what lets a test express an out-of-bounds value that
    Field(ge=0) would otherwise reject at construction time."""
    v7 = make_v7_inputs()
    data = v7.model_dump()
    data["inputs_version"] = 8
    data["vat"] = DEFAULT_VAT.model_dump()
    v8 = CalculatorInputsV8.model_validate(data)
    if conversion_costs is not None:
        v8.conversion_costs = v8.conversion_costs.model_copy(update=conversion_costs)
    if cost_plan is not None:
        v8.cost_plan = v8.cost_plan.model_copy(update=cost_plan)
    if finance is not None:
        v8.finance = v8.finance.model_copy(update=finance)
    if exit_strategy is not None:
        v8.exit_strategy = v8.exit_strategy.model_copy(update=exit_strategy)
    return v8


def _pkg(**overrides) -> CostPackage:
    """`model_construct` bypasses Pydantic validation (CostPackage.amount_pence
    carries `Field(ge=0)`) -- the same idiom `_negative_area` above uses to pin
    validate_inputs's defense-in-depth negative-amount check as correct even
    though the ordinary Pydantic boundary already forbids the value."""
    base = dict(
        id="pkg-1", code="structure", label="Structure", amount_pence=1_000_000,
        contingency_class="general", lender_eligible=True, notes="",
    )
    base.update(overrides)
    return CostPackage.model_construct(**base)


def _fee_line(**overrides) -> FeeLine:
    base = dict(
        id="fee-x", code="other", category="professional", label="X",
        basis="fixed", amount_pence=1000, pct=0, per_dwelling=False,
    )
    base.update(overrides)
    return FeeLine.model_construct(**base)


def _three_classes(*, general=None, existing_building=None, abnormal=None) -> list[ContingencyClass]:
    """Builds the three-class contingency array in CONTINGENCY_CLASS_NAMES
    order, each overridable independently -- the Python twin of the inline
    three-element arrays in validation.test.ts's R10 suite. `model_construct`
    for the same reason as `_pkg` (ContingencyClass.pct carries `Field(ge=0)`,
    and the negative-pct rule pins the defense-in-depth check)."""
    defaults = {
        "general": dict(name="general", pct=10),
        "existing_building": dict(name="existing_building", pct=0),
        "abnormal": dict(name="abnormal", pct=0),
    }
    overrides = {"general": general, "existing_building": existing_building, "abnormal": abnormal}
    for key, override in overrides.items():
        if override is not None:
            defaults[key].update(override)
    return [ContingencyClass.model_construct(**defaults[k]) for k in ("general", "existing_building", "abnormal")]


class TestCostPlanValidation:
    """R10 (Task 10, spec Sec 16). Python twin of the 'R10 - cost plan
    validation' describe block in validation.test.ts -- same fields,
    severities and gating logic."""

    def test_does_not_gain_errors_on_a_pre_v7_document(self):
        inputs = make_v6_inputs()
        issues = validate_inputs(inputs)
        assert [i for i in issues if i.field.startswith("cost_plan.")] == []

    def test_hard_errors_when_headline_mode_carries_packages(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={"mode": "headline", "packages": [_pkg()]}))
        assert any(i.severity == "error" and i.field == "cost_plan.mode" for i in invalid)

        valid = validate_inputs(make_v7_inputs())
        assert not any(i.field == "cost_plan.mode" for i in valid)

    def test_hard_errors_when_detailed_mode_has_no_packages(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={"mode": "detailed", "packages": []}))
        assert any(i.severity == "error" and i.field == "cost_plan.packages" for i in invalid)

        valid = validate_inputs(make_v7_inputs(cost_plan={"mode": "detailed", "packages": [_pkg()]}))
        assert not any(i.field == "cost_plan.packages" for i in valid)

    def test_hard_errors_when_detailed_mode_packages_sum_to_zero(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed",
            "packages": [_pkg(amount_pence=0), _pkg(id="pkg-2", amount_pence=0)],
        }))
        assert any(i.severity == "error" and i.field == "cost_plan.packages" for i in invalid)

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(amount_pence=1000)],
        }))
        assert not any(i.field == "cost_plan.packages" for i in valid)

    def test_hard_errors_on_a_negative_package_amount(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(amount_pence=-1)],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].amount_pence" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(amount_pence=1000)],
        }))
        assert not any(i.field == "cost_plan.packages[0].amount_pence" for i in valid)

    def test_hard_errors_on_a_negative_contingency_percentage(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "contingency": _three_classes(existing_building={"pct": -5}),
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.contingency[1].pct" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "contingency": _three_classes(existing_building={"pct": 5}),
        }))
        assert not any(i.field == "cost_plan.contingency[1].pct" for i in valid)

    def test_hard_errors_on_a_duplicate_package_id(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed",
            "packages": [_pkg(id="dup"), _pkg(id="dup", amount_pence=2000)],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages" and "unique" in i.message
            for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed",
            "packages": [_pkg(id="a"), _pkg(id="b", amount_pence=2000)],
        }))
        assert not any(i.field == "cost_plan.packages" and "unique" in i.message for i in valid)

    def test_hard_errors_on_a_duplicate_fee_line_id(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(id="dup"), _fee_line(id="dup", label="Y")],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.fee_lines" and "unique" in i.message
            for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(id="a"), _fee_line(id="b")],
        }))
        assert not any(i.field == "cost_plan.fee_lines" and "unique" in i.message for i in valid)

    def test_hard_errors_when_there_are_not_exactly_three_contingency_classes(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "contingency": _three_classes()[:2],
        }))
        assert any(i.severity == "error" and i.field == "cost_plan.contingency" for i in invalid)

        valid = validate_inputs(make_v7_inputs())
        assert not any(i.field == "cost_plan.contingency" for i in valid)

    def test_hard_errors_when_a_contingency_class_name_repeats(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "contingency": _three_classes(existing_building={"name": "general"}),
        }))
        assert any(i.severity == "error" and i.field == "cost_plan.contingency" for i in invalid)

        valid = validate_inputs(make_v7_inputs())
        assert not any(i.field == "cost_plan.contingency" for i in valid)

    def test_hard_errors_when_detailed_mode_carries_a_non_zero_flat_fire_safety_figure(self):
        """Spec Sec 3.2.1."""
        invalid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"fire_safety_pence": 100},
        ))
        assert any(
            i.severity == "error" and i.field == "conversion_costs.fire_safety_pence" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"fire_safety_pence": 0},
        ))
        assert not any(i.field == "conversion_costs.fire_safety_pence" for i in valid)

    def test_hard_errors_when_detailed_mode_carries_a_non_zero_flat_sound_insulation_figure(self):
        """Spec Sec 3.2.1."""
        invalid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"sound_insulation_pence": 100},
        ))
        assert any(
            i.severity == "error" and i.field == "conversion_costs.sound_insulation_pence" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"sound_insulation_pence": 0},
        ))
        assert not any(i.field == "conversion_costs.sound_insulation_pence" for i in valid)

    def test_hard_errors_when_detailed_mode_carries_a_non_zero_flat_part_l_compliance_figure(self):
        """Spec Sec 3.2.1."""
        invalid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"part_l_compliance_pence": 100},
        ))
        assert any(
            i.severity == "error" and i.field == "conversion_costs.part_l_compliance_pence" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(
            cost_plan={"mode": "detailed", "packages": [_pkg()]},
            conversion_costs={"part_l_compliance_pence": 0},
        ))
        assert not any(i.field == "conversion_costs.part_l_compliance_pence" for i in valid)

    def test_hard_errors_when_a_fixed_basis_fee_line_carries_a_non_zero_percentage(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="fixed", pct=5)],
        }))
        assert any(i.severity == "error" and i.field == "cost_plan.fee_lines[0].pct" for i in invalid)

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="fixed", pct=0)],
        }))
        assert not any(i.field == "cost_plan.fee_lines[0].pct" for i in valid)

    def test_hard_errors_when_a_percentage_basis_fee_line_carries_a_non_zero_fixed_amount(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=500, pct=5)],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.fee_lines[0].amount_pence" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=0, pct=5)],
        }))
        assert not any(i.field == "cost_plan.fee_lines[0].amount_pence" for i in valid)

    def test_hard_errors_when_a_percentage_basis_fee_line_is_marked_per_dwelling(self):
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=0, pct=5, per_dwelling=True)],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.fee_lines[0].per_dwelling" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=0, pct=5, per_dwelling=False)],
        }))
        assert not any(i.field == "cost_plan.fee_lines[0].per_dwelling" for i in valid)

    def test_hard_errors_when_a_fee_line_category_contradicts_its_code(self):
        """building_control is statutory despite sitting in the professional
        block of ConversionCostInputs (spec Sec 3.4)."""
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(code="building_control", category="professional")],
        }))
        assert any(
            i.severity == "error" and i.field == "cost_plan.fee_lines[0].category" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(code="building_control", category="statutory")],
        }))
        assert not any(i.field == "cost_plan.fee_lines[0].category" for i in valid)

    def test_warns_not_errors_when_detailed_mode_non_general_contingency_has_no_tagged_package(self):
        """R11 ruling R46. Python twin of the same-named test in
        validation.test.ts."""
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed",
            "packages": [_pkg(contingency_class="general")],
            "contingency": _three_classes(general={"pct": 5}, abnormal={"pct": 8}),
        }))
        assert any(
            i.severity == "warning" and i.field == "cost_plan.contingency[2].pct" for i in invalid
        )
        # R46 is a deliberate warning, not a hard error -- an error would
        # repeat R38's defect by turning a migrated document's state into a
        # hard error that silently downgrades a report to DRAFT.
        assert not any(
            i.severity == "error" and i.field == "cost_plan.contingency[2].pct" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(cost_plan={
            "mode": "detailed",
            "packages": [_pkg(contingency_class="abnormal")],
            "contingency": _three_classes(general={"pct": 5}, abnormal={"pct": 8}),
        }))
        assert not any(i.field == "cost_plan.contingency[2].pct" for i in valid)

    def test_does_not_warn_r46_in_headline_mode(self):
        invalid = validate_inputs(make_v7_inputs(
            conversion_costs={"total_construction_sqm": 100},
            cost_plan={"mode": "headline", "contingency": _three_classes(general={"pct": 5}, abnormal={"pct": 8})},
        ))
        assert not any(i.field.startswith("cost_plan.contingency[2]") for i in invalid)

    def test_warns_when_contingency_exceeds_50pct_of_the_base_build_cost(self):
        invalid = validate_inputs(make_v7_inputs(
            conversion_costs={"total_construction_sqm": 100},
            cost_plan={"mode": "headline", "contingency": _three_classes(general={"pct": 60})},
        ))
        assert any(
            i.severity == "warning" and i.field == "cost_plan.contingency" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(
            conversion_costs={"total_construction_sqm": 100},
            cost_plan={"mode": "headline", "contingency": _three_classes(general={"pct": 10})},
        ))
        assert not any(
            i.severity == "warning" and i.field == "cost_plan.contingency" for i in valid
        )

    def test_warns_when_a_percentage_basis_fee_line_resolves_against_a_zero_base(self):
        # make_v7_inputs defaults total_construction_sqm to 0, so headline-mode
        # base_build is 0.
        invalid = validate_inputs(make_v7_inputs(cost_plan={
            "fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=0, pct=5)],
        }))
        assert any(
            i.severity == "warning" and i.field == "cost_plan.fee_lines[0].basis" for i in invalid
        )

        valid = validate_inputs(make_v7_inputs(
            conversion_costs={"total_construction_sqm": 100},
            cost_plan={"fee_lines": [_fee_line(basis="pct_of_base_build", amount_pence=0, pct=5)]},
        ))
        assert not any(
            i.severity == "warning" and i.field == "cost_plan.fee_lines[0].basis" for i in valid
        )


def _treatments(**overrides: dict) -> list:
    """Builds the six-row `treatments` list from the production default,
    applying a partial patch to the named category's row only -- keyword name
    IS the category, e.g. `_treatments(construction={"rate_pct": -1})`. Every
    other row (and the order) stays exactly as `default_vat_treatments()`
    produces it. `model_copy(update=...)` does not validate (see
    `make_v7_inputs`'s docstring above), which is what lets a row carry an
    out-of-bounds value that `Field(ge=0)` would otherwise reject. Python twin
    of validation.test.ts's `vatTreatments()`."""
    return [
        t.model_copy(update=overrides[t.category]) if t.category in overrides else t
        for t in default_vat_treatments()
    ]


def _override(**overrides) -> VatOverride:
    """`model_construct` bypasses Pydantic validation (VatOverride.rate_pct/
    recoverable_pct carry `Field(ge=0)`) -- the same idiom as `_pkg`/
    `_fee_line` above."""
    base = dict(rate_pct=0, recoverable_pct=0, recovery_basis="unconfirmed")
    base.update(overrides)
    return VatOverride.model_construct(**base)


class TestVatValidationHardErrors:
    """R11 (Task 9, spec Sec 17.9). Python twin of the 'R11 -- VAT validation
    (spec Sec17.9)' describe block in validation.test.ts -- same fields,
    severities and gating logic. Ruling R27's pre-existing
    'registered: false while purchase VAT is chargeable' hard error (Task 7)
    already sits in validate_inputs alongside these and is covered by its own
    six tests in test_vat.py; it is not re-tested here."""

    def test_does_not_gain_a_vat_issue_on_a_pre_v8_document_no_vat_attribute(self):
        issues = validate_inputs(make_v7_inputs())
        assert [
            i for i in issues if i.field.startswith("vat.") or "vat_override" in i.field
        ] == []

    def test_produces_no_vat_issue_on_the_all_defaults_v8_document(self):
        issues = validate_inputs(make_v8_inputs())
        assert [
            i for i in issues if i.field.startswith("vat.") or "vat_override" in i.field
        ] == []

    def test_hard_errors_on_a_package_vat_override_in_headline_mode(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "headline", "packages": [_pkg(vat_override=_override())],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].vat_override" for i in invalid
        )

        # Fix round 1 (minor 3): the near-miss of the actual precondition is the
        # SAME override present in DETAILED mode, not the override removed
        # entirely -- that changes only the one field the rule actually gates on.
        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override())],
        }))
        assert not any(i.field == "cost_plan.packages[0].vat_override" for i in valid)

    def test_hard_errors_on_a_fee_line_vat_override_in_headline_mode(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "headline", "fee_lines": [_fee_line(vat_override=_override())],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.fee_lines[0].vat_override" for i in invalid
        )

        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "fee_lines": [_fee_line(vat_override=_override())],
        }))
        assert not any(i.field == "cost_plan.fee_lines[0].vat_override" for i in valid)

    def test_hard_errors_when_a_treatment_row_rate_pct_is_negative(self):
        idx = VAT_CHARGE_CATEGORIES.index("construction")
        inputs = make_v8_inputs()
        inputs.vat.treatments = _treatments(construction={"rate_pct": -1})
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == f"vat.treatments[{idx}].rate_pct" for i in invalid
        )

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.treatments = _treatments(construction={"rate_pct": 20})
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == f"vat.treatments[{idx}].rate_pct" for i in valid)

    def test_hard_errors_when_a_treatment_row_rate_pct_exceeds_100(self):
        idx = VAT_CHARGE_CATEGORIES.index("construction")
        inputs = make_v8_inputs()
        inputs.vat.treatments = _treatments(construction={"rate_pct": 101})
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == f"vat.treatments[{idx}].rate_pct" for i in invalid
        )

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.treatments = _treatments(construction={"rate_pct": 100})
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == f"vat.treatments[{idx}].rate_pct" for i in valid)

    def test_hard_errors_when_a_package_vat_override_rate_pct_is_negative(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(rate_pct=-1))],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].vat_override.rate_pct"
            for i in invalid
        )

        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(rate_pct=20))],
        }))
        assert not any(i.field == "cost_plan.packages[0].vat_override.rate_pct" for i in valid)

    def test_hard_errors_when_a_package_vat_override_rate_pct_exceeds_100(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(rate_pct=101))],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].vat_override.rate_pct"
            for i in invalid
        )

        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(rate_pct=100))],
        }))
        assert not any(i.field == "cost_plan.packages[0].vat_override.rate_pct" for i in valid)

    def test_hard_errors_when_a_treatment_row_recoverable_pct_is_negative(self):
        idx = VAT_CHARGE_CATEGORIES.index("construction")
        inputs = make_v8_inputs()
        inputs.vat.treatments = _treatments(construction={"recoverable_pct": -1})
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == f"vat.treatments[{idx}].recoverable_pct" for i in invalid
        )

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.treatments = _treatments(construction={"recoverable_pct": 50})
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == f"vat.treatments[{idx}].recoverable_pct" for i in valid)

    def test_hard_errors_when_a_treatment_row_recoverable_pct_exceeds_100(self):
        idx = VAT_CHARGE_CATEGORIES.index("construction")
        inputs = make_v8_inputs()
        inputs.vat.treatments = _treatments(construction={"recoverable_pct": 101})
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == f"vat.treatments[{idx}].recoverable_pct" for i in invalid
        )

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.treatments = _treatments(construction={"recoverable_pct": 100})
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == f"vat.treatments[{idx}].recoverable_pct" for i in valid)

    def test_hard_errors_when_a_package_vat_override_recoverable_pct_is_negative(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(recoverable_pct=-1))],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].vat_override.recoverable_pct"
            for i in invalid
        )

        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(recoverable_pct=50))],
        }))
        assert not any(i.field == "cost_plan.packages[0].vat_override.recoverable_pct" for i in valid)

    def test_hard_errors_when_a_package_vat_override_recoverable_pct_exceeds_100(self):
        inputs = make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(recoverable_pct=101))],
        })
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == "cost_plan.packages[0].vat_override.recoverable_pct"
            for i in invalid
        )

        valid = validate_inputs(make_v8_inputs(cost_plan={
            "mode": "detailed", "packages": [_pkg(vat_override=_override(recoverable_pct=100))],
        }))
        assert not any(i.field == "cost_plan.packages[0].vat_override.recoverable_pct" for i in valid)

    def test_hard_errors_when_a_treatments_category_is_missing(self):
        inputs = make_v8_inputs()
        inputs.vat.treatments = [
            t for t in default_vat_treatments() if t.category != "lender_ancillary"
        ]
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.treatments" for i in invalid)

        valid = validate_inputs(make_v8_inputs())
        assert not any(i.field == "vat.treatments" for i in valid)

    def test_hard_errors_when_a_treatments_category_is_duplicated(self):
        treatments = default_vat_treatments()
        treatments[5] = treatments[5].model_copy(update={"category": "acquisition"})
        inputs = make_v8_inputs()
        inputs.vat.treatments = treatments
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.treatments" for i in invalid)

        valid = validate_inputs(make_v8_inputs())
        assert not any(i.field == "vat.treatments" for i in valid)

    def test_hard_errors_when_the_six_categories_are_present_but_out_of_order(self):
        inputs = make_v8_inputs()
        inputs.vat.treatments = list(reversed(default_vat_treatments()))
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.treatments" for i in invalid)

        valid = validate_inputs(make_v8_inputs())
        assert not any(i.field == "vat.treatments" for i in valid)

    # --- The two RETURN-CYCLE bounds (ruling R38, spec Sec 17.11).
    #
    # These four cases were originally written on make_v8_inputs() unmodified,
    # i.e. on `registered: False` documents. That was asserting the wrong
    # thing: a rule about a LIVE return cycle has to be tested on a document
    # whose cycle is live. Written that way they also pinned the defect R38
    # exists to fix -- the migration writes `first_period_end_month: 2` onto
    # EVERY document, so an ungated rule made every stored appraisal with
    # `term_months <= 2` a hard error, and a hard error marks the report DRAFT.
    #
    # `_registered_v8` therefore switches the engine on, and the two
    # `..._is_not_validated_while_the_engine_is_dormant` cases below pin the
    # gate itself in the other direction.

    @staticmethod
    def _registered_v8(**kwargs):
        inputs = make_v8_inputs(**kwargs)
        inputs.vat.registered = True
        return inputs

    def test_hard_errors_when_first_period_end_month_is_negative(self):
        inputs = self._registered_v8()
        inputs.vat.first_period_end_month = -1
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.first_period_end_month" for i in invalid)

        valid_inputs = self._registered_v8()
        valid_inputs.vat.first_period_end_month = 0
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == "vat.first_period_end_month" for i in valid)

    def test_hard_errors_when_first_period_end_month_is_at_or_past_term_months(self):
        inputs = self._registered_v8(finance={"term_months": 3})
        inputs.vat.first_period_end_month = 3
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.first_period_end_month" for i in invalid)

        valid_inputs = self._registered_v8(finance={"term_months": 3})
        valid_inputs.vat.first_period_end_month = 2
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == "vat.first_period_end_month" for i in valid)

    def test_first_period_end_month_is_not_validated_while_the_engine_is_dormant(self):
        """R38. The migration's own write -- `first_period_end_month: 2` on a
        1-month term -- must produce NO issue while `registered` is false.
        Ungated this was a hard error, which makes `report_safe` false and
        marks the report DRAFT: an "inert" migration would have silently
        downgraded every short-term appraisal in the database."""
        inputs = make_v8_inputs(finance={"term_months": 1})
        assert inputs.vat.registered is False
        assert inputs.vat.first_period_end_month == 2
        assert not any(i.field == "vat.first_period_end_month" for i in validate_inputs(inputs))

        # And the moment the document registers, the error arrives -- which is
        # the right moment for it. The gate defers the rule, it does not
        # delete it.
        inputs.vat.registered = True
        assert any(
            i.severity == "error" and i.field == "vat.first_period_end_month"
            for i in validate_inputs(inputs)
        )

    def test_hard_errors_when_repayment_lag_months_is_negative(self):
        inputs = self._registered_v8()
        inputs.vat.repayment_lag_months = -1
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.repayment_lag_months" for i in invalid)

        valid_inputs = self._registered_v8()
        valid_inputs.vat.repayment_lag_months = 0
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == "vat.repayment_lag_months" for i in valid)

    def test_hard_errors_when_repayment_lag_months_exceeds_6(self):
        inputs = self._registered_v8()
        inputs.vat.repayment_lag_months = 7
        invalid = validate_inputs(inputs)
        assert any(i.severity == "error" and i.field == "vat.repayment_lag_months" for i in invalid)

        valid_inputs = self._registered_v8()
        valid_inputs.vat.repayment_lag_months = 6
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == "vat.repayment_lag_months" for i in valid)

    def test_repayment_lag_months_is_not_validated_while_the_engine_is_dormant(self):
        """R38's second gated field. Tested with a value that is nonsense in
        any state (7 > the 6-month cap) so this cannot pass merely because the
        default happens to be in range."""
        inputs = make_v8_inputs()
        inputs.vat.repayment_lag_months = 7
        assert inputs.vat.registered is False
        assert not any(i.field == "vat.repayment_lag_months" for i in validate_inputs(inputs))

        inputs.vat.registered = True
        assert any(
            i.severity == "error" and i.field == "vat.repayment_lag_months"
            for i in validate_inputs(inputs)
        )

    def test_hard_errors_when_togc_applies_with_a_non_zero_acquisition_rate(self):
        acq_idx = VAT_CHARGE_CATEGORIES.index("acquisition")
        inputs = make_v8_inputs()
        inputs.vat.treatments = _treatments(acquisition={"rate_pct": 20})
        inputs.vat.purchase.togc_treatment = "applies"
        inputs.vat.purchase.vendor_opted_to_tax = True
        invalid = validate_inputs(inputs)
        assert any(
            i.severity == "error" and i.field == f"vat.treatments[{acq_idx}].rate_pct" for i in invalid
        )

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.treatments = _treatments(acquisition={"rate_pct": 0})
        valid_inputs.vat.purchase.togc_treatment = "applies"
        valid_inputs.vat.purchase.vendor_opted_to_tax = True
        valid = validate_inputs(valid_inputs)
        assert not any(i.field == f"vat.treatments[{acq_idx}].rate_pct" for i in valid)


class TestVatValidationWarnings:
    """R11 (Task 9, spec Sec 17.9). Every case here must appear on
    validate_inputs/run.validation and NOT on reconcile().issues, which
    carries only errors bar one 'model' warning -- see the module note above
    validate_inputs. Python twin of the 'R11 -- VAT warnings (spec Sec17.9)'
    describe block in validation.test.ts."""

    @staticmethod
    def _assert_warning_channel(inputs: CalculatorInputsV8, field_name: str) -> None:
        issues = validate_inputs(inputs)
        assert any(i.severity == "warning" and i.field == field_name for i in issues)

        schedule = build_schedule(inputs)
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        rec_issues = reconcile(inputs, schedule, model).issues
        assert not any(i.field == field_name for i in rec_issues)

    def test_warns_on_zero_rated_sale_with_a_retain_all_exit(self):
        idx = VAT_CHARGE_CATEGORIES.index("selling")
        inputs = make_v8_inputs(exit_strategy={"route": "retain_all"})
        inputs.vat.registered = True
        inputs.vat.treatments = _treatments(
            selling={"rate_pct": 20, "recoverable_pct": 100, "recovery_basis": "zero_rated_sale"},
        )
        self._assert_warning_channel(inputs, f"vat.treatments[{idx}].recovery_basis")

    def test_warns_on_zero_rated_sale_with_a_blended_exit_retaining_one_unit(self):
        idx = VAT_CHARGE_CATEGORIES.index("selling")
        inputs = make_v8_inputs(exit_strategy={
            "route": "blended",
            "retained_units": [RetainedUnit(unit_id="u1", monthly_rent_pence=1000)],
        })
        inputs.vat.registered = True
        inputs.vat.treatments = _treatments(
            selling={"rate_pct": 20, "recoverable_pct": 100, "recovery_basis": "zero_rated_sale"},
        )
        self._assert_warning_channel(inputs, f"vat.treatments[{idx}].recovery_basis")

    def test_does_not_warn_on_zero_rated_sale_with_a_sell_all_exit(self):
        idx = VAT_CHARGE_CATEGORIES.index("selling")
        inputs = make_v8_inputs(exit_strategy={"route": "sell_all"})
        inputs.vat.registered = True
        inputs.vat.treatments = _treatments(
            selling={"rate_pct": 20, "recoverable_pct": 100, "recovery_basis": "zero_rated_sale"},
        )
        issues = validate_inputs(inputs)
        assert not any(i.field == f"vat.treatments[{idx}].recovery_basis" for i in issues)

    # Fix round 1 (Ruling R35). A VatOverride carries its OWN recovery_basis --
    # exactly the same unsafe assumption is expressible on a package or fee
    # line, and a scan of vat.treatments alone never sees it. Two more cases,
    # making this rule's total four, not two.
    def test_warns_on_a_package_override_recovered_as_zero_rated_sale(self):
        inputs = make_v8_inputs(
            cost_plan={
                "mode": "detailed",
                "packages": [_pkg(vat_override=_override(
                    rate_pct=20, recoverable_pct=100, recovery_basis="zero_rated_sale",
                ))],
            },
            exit_strategy={"route": "retain_all"},
        )
        inputs.vat.registered = True
        self._assert_warning_channel(inputs, "cost_plan.packages[0].vat_override.recovery_basis")

    def test_warns_on_a_fee_line_override_recovered_as_zero_rated_sale(self):
        inputs = make_v8_inputs(
            cost_plan={
                "mode": "detailed",
                "fee_lines": [_fee_line(vat_override=_override(
                    rate_pct=20, recoverable_pct=100, recovery_basis="zero_rated_sale",
                ))],
            },
            exit_strategy={"route": "retain_all"},
        )
        inputs.vat.registered = True
        self._assert_warning_channel(inputs, "cost_plan.fee_lines[0].vat_override.recovery_basis")

    def test_does_not_warn_on_a_package_override_recovered_as_zero_rated_sale_when_no_unit_is_retained(self):
        inputs = make_v8_inputs(
            cost_plan={
                "mode": "detailed",
                "packages": [_pkg(vat_override=_override(
                    rate_pct=20, recoverable_pct=100, recovery_basis="zero_rated_sale",
                ))],
            },
            exit_strategy={"route": "sell_all"},
        )
        inputs.vat.registered = True
        issues = validate_inputs(inputs)
        assert not any(i.field == "cost_plan.packages[0].vat_override.recovery_basis" for i in issues)

    def test_warns_when_togc_applies_but_the_vendor_has_not_opted_to_tax(self):
        inputs = make_v8_inputs()
        inputs.vat.purchase.togc_treatment = "applies"
        inputs.vat.purchase.vendor_opted_to_tax = False
        self._assert_warning_channel(inputs, "vat.purchase.togc_treatment")

        valid_inputs = make_v8_inputs()
        valid_inputs.vat.purchase.togc_treatment = "does_not_apply"
        valid_inputs.vat.purchase.vendor_opted_to_tax = False
        valid = validate_inputs(valid_inputs)
        assert not any(
            i.field == "vat.purchase.togc_treatment" and i.severity == "warning" for i in valid
        )

    def test_warns_when_registered_is_false_but_construction_cost_is_non_zero(self):
        inputs = make_v8_inputs(conversion_costs={
            "construction_cost_per_sqm_pence": 100_000, "total_construction_sqm": 100,
        })
        self._assert_warning_channel(inputs, "vat.registered")

        valid = validate_inputs(make_v8_inputs())
        assert not any(i.field == "vat.registered" and i.severity == "warning" for i in valid)

    def test_warns_when_the_final_vat_return_period_reclaim_falls_outside_the_term(self):
        # Ruling R4: derived from vat_return_periods(vat, term_months), gated on
        # a non-zero resolved rate -- never from the RESULT field
        # vat.receivable_at_maturity_pence, which validate_inputs cannot see.
        inputs = make_v8_inputs(finance={"term_months": 3})
        inputs.vat.registered = True
        inputs.vat.treatments = _treatments(construction={"rate_pct": 20})
        self._assert_warning_channel(inputs, "vat.repayment_lag_months")

    def test_does_not_warn_where_the_resolved_rate_is_zero_even_though_structurally_out_of_term(self):
        # Same term/lag/frequency as the case above -- the final period's
        # reclaim is still None -- but every treatment rate is 0 (the default),
        # so there is nothing to reclaim and the gate must hold.
        inputs = make_v8_inputs(finance={"term_months": 3})
        inputs.vat.registered = True
        issues = validate_inputs(inputs)
        assert not any(
            i.field == "vat.repayment_lag_months" and i.severity == "warning" for i in issues
        )


# --- R12 Sec 18.8 -- v9 programme network validation (Task 10) -------------
#
# Python twin of validation.test.ts's 'programme network validation --
# spec Sec18.8' and 'anchors and scenario slip -- Sec18.6/18.8/18.9' describe
# blocks. Both implementations must agree with the spec, not merely with each
# other -- see the module docstring at the top of this file.

SL = SimpleSpendCurve(kind="straight_line")


def v9_phase(pid, code, duration, preds=(), *, start_offset=0, slip=0) -> Phase:
    """Mirrors validation.test.ts's `phase()` helper (itself a mirror of
    programme.test.ts's own), and test_financial_model_programme.py's `phase()`
    Python twin exactly: a phase with no overrides is predecessor-free, at
    start_offset 0, with no slip."""
    return Phase(
        id=pid, code=code, label=pid, duration_months=duration,
        slip_months=slip, start_offset=start_offset, curve=SL,
        predecessors=list(preds),
    )


def v9_dep(pid, type_="FS", lag=0) -> Dependency:
    return Dependency(phase_id=pid, type=type_, lag_months=lag)


def v9_doc_with(
    phases: list[Phase], term: int = 24, category_phase_ids: CategoryPhaseIds | None = None,
) -> CalculatorInputsV9:
    """A v9 document carrying the given phases as its programme network. The
    Python twin of validation.test.ts's `docWith`. `category_phase_ids`
    defaults every category onto `phases[0]` -- the tests that care about
    `category_phase_ids` pass it explicitly."""
    d = migrate_inputs_to_v9({})
    d.finance = d.finance.model_copy(update={"term_months": term})
    first = phases[0].id if phases else "x"
    d.programme = ProgrammeNetwork(
        anchor_month=None,
        phases=phases,
        category_phase_ids=category_phase_ids or CategoryPhaseIds(
            construction=first, professional=first, statutory=first,
        ),
    )
    return d


def v9_detailed_cost_plan() -> CostPlanInputs:
    """A minimal, structurally-valid detailed cost plan -- one package, no fee
    lines -- for the tests that tag a cost line onto a phase. The Python twin
    of validation.test.ts's `detailedCostPlan`."""
    return CostPlanInputs(
        mode="detailed",
        packages=[CostPackage(
            id="pkg-1", code="structure", label="Structure", amount_pence=1_000_000,
            contingency_class="general", lender_eligible=True, notes="",
        )],
        contingency=[
            ContingencyClass(name="general", pct=5),
            ContingencyClass(name="existing_building", pct=0),
            ContingencyClass(name="abnormal", pct=0),
        ],
        fee_lines=[],
    )


def v9_errs(d) -> list:
    return [i for i in validate_inputs(d) if i.severity == "error"]


class TestProgrammeNetworkValidation:
    """Python twin of validation.test.ts's 'programme network validation --
    spec Sec18.8' describe block (R12 Task 10)."""

    def test_rejects_a_duplicate_phase_id(self):
        e = v9_errs(v9_doc_with([v9_phase("a", "planning", 2), v9_phase("a", "design", 2)]))
        assert any(
            i.field == "programme.phases.a" and "Duplicate phase id" in i.message for i in e
        )

    def test_rejects_a_dependency_naming_an_absent_phase(self):
        e = v9_errs(v9_doc_with([v9_phase("a", "planning", 2, [v9_dep("ghost")])]))
        assert any('no phase with id "ghost"' in i.message for i in e)

    def test_rejects_a_self_reference(self):
        e = v9_errs(v9_doc_with([v9_phase("a", "planning", 2, [v9_dep("a")])]))
        assert any("cannot depend on itself" in i.message for i in e)

    def test_names_the_cycle_in_order(self):
        e = v9_errs(v9_doc_with([
            v9_phase("a", "planning", 2, [v9_dep("b")]),
            v9_phase("b", "conditions", 2, [v9_dep("a")]),
        ]))
        assert any(i.field == "programme.phases" and "→" in i.message for i in e)

    # Task 16 falsifiability audit. Single-line change that kills this guard --
    # the exact "over-eager detector" the guard's own docstring names:
    # validation.py's `if derivation.cycle is not None:` -> `if True:`, which
    # makes every network (cyclic or not) take the cycle-error branch.
    # Verified: the acyclic twin now raises a TypeError inside validate_inputs
    # (its `derivation.cycle` is None, so `' → '.join(derivation.cycle)`
    # crashes) rather than passing clean -- reverted after confirming the
    # guard, and the rest of this file, pass again clean.
    def test_guard_3_a_cyclic_document_errors_its_acyclic_twin_does_not(self):
        """The twin must CARRY a dependency, not merely lack the cycle --
        otherwise an over-eager detector that rejected every predecessor edge
        still passes. Every other clean-document assertion in this suite uses
        a dependency-free network, so without this pairing nothing
        distinguishes "no cycle" from "no dependencies at all"."""
        cyclic = v9_doc_with([
            v9_phase("a", "planning", 2, [v9_dep("b")]),
            v9_phase("b", "conditions", 2, [v9_dep("a")]),
        ])
        acyclic = v9_doc_with([
            v9_phase("a", "planning", 2, [v9_dep("b")]),
            v9_phase("b", "conditions", 2),
        ])
        assert any(i.field == "programme.phases" and "→" in i.message for i in v9_errs(cyclic))
        assert v9_errs(acyclic) == []

    def test_rejects_negative_duration_lag_or_start_offset_but_allows_a_negative_slip(self):
        # Fix round 1, Finding 6: field + message fragment, not a bare length
        # check that any unrelated error would also satisfy.
        assert any(
            i.field == "programme.phases.a" and "duration_months cannot be negative" in i.message
            for i in v9_errs(v9_doc_with([v9_phase("a", "planning", -1)]))
        )
        assert any(
            i.field == "programme.phases.a" and "start_offset cannot be negative" in i.message
            for i in v9_errs(v9_doc_with([v9_phase("a", "planning", 2, start_offset=-1)]))
        )
        assert any(
            i.field == "programme.phases.a" and "lag_months cannot be negative" in i.message
            for i in v9_errs(v9_doc_with([
                v9_phase("a", "planning", 2, [v9_dep("a2", lag=-1)]),
                v9_phase("a2", "design", 1),
            ]))
        )
        # signed slip is legal (Sec18.2) as long as the resolved start stays >= 0
        assert v9_errs(v9_doc_with([v9_phase("a", "planning", 2, start_offset=3, slip=-1)])) == []

    def test_rejects_a_fractional_slip_is_rejected_by_pydantic_at_parse(self):
        """CRITICAL 1b (textual parity with validation.ts): validation.py
        gained a Number.isInteger-equivalent check for textual parity, but it
        is unreachable in practice here -- Phase.slip_months is typed `int`,
        so Pydantic already rejects a fractional value at parse (a 422),
        before validate_inputs ever runs. Mirrors TestV4ProgrammeValidation's
        identically-reasoned fractional-duration test above."""
        with pytest.raises(pydantic.ValidationError):
            v9_phase("a", "planning", 2, slip=1.5)

    def test_rejects_over_acceleration_below_month_0_rather_than_clamping(self):
        e = v9_errs(v9_doc_with([v9_phase("a", "planning", 2, start_offset=1, slip=-3)]))
        assert any(i.field == "programme.phases.a" and "before month 0" in i.message for i in e)

    def test_rejects_category_phase_ids_pointing_at_an_absent_phase_or_a_milestone(self):
        ms = [v9_phase("a", "construction", 4), v9_phase("pc", "practical_completion", 0)]
        ghost = v9_doc_with(
            ms, category_phase_ids=CategoryPhaseIds(construction="ghost", professional="a", statutory="a"),
        )
        assert any(i.field == "programme.category_phase_ids.construction" for i in v9_errs(ghost))

        milestone = v9_doc_with(
            ms, category_phase_ids=CategoryPhaseIds(construction="pc", professional="a", statutory="a"),
        )
        assert any("milestone" in i.message for i in v9_errs(milestone))

    def test_rejects_a_cost_line_tagged_to_a_milestone_or_an_absent_phase(self):
        d = v9_doc_with([v9_phase("a", "construction", 4), v9_phase("pc", "practical_completion", 0)])
        cp = v9_detailed_cost_plan()
        cp.packages = [cp.packages[0].model_copy(update={"phase_id": "pc"})]
        d.cost_plan = cp
        assert any("milestone" in i.message for i in v9_errs(d))

    def test_fix_round_1_finding_5_absent_phase_arm_of_the_cost_package_rule(self):
        d = v9_doc_with([v9_phase("a", "construction", 4)])
        cp = v9_detailed_cost_plan()
        cp.packages = [cp.packages[0].model_copy(update={"phase_id": "ghost"})]
        d.cost_plan = cp
        e = v9_errs(d)
        assert any(
            i.field == "cost_plan.packages[0].phase_id" and 'no phase with id "ghost"' in i.message
            for i in e
        )

    def test_fix_round_1_finding_5_fee_lines_phase_id_arm_milestone_and_absent_phase(self):
        def fee(**overrides) -> FeeLine:
            base = dict(
                id="fee-x", code="other", category="professional", label="X",
                basis="fixed", amount_pence=1000, pct=0, per_dwelling=False,
            )
            base.update(overrides)
            return FeeLine(**base)

        milestone_doc = v9_doc_with([v9_phase("a", "construction", 4), v9_phase("pc", "practical_completion", 0)])
        milestone_cp = v9_detailed_cost_plan()
        milestone_cp.fee_lines = [fee(phase_id="pc")]
        milestone_doc.cost_plan = milestone_cp
        assert any(
            i.field == "cost_plan.fee_lines[0].phase_id" and "milestone" in i.message
            for i in v9_errs(milestone_doc)
        )

        absent_doc = v9_doc_with([v9_phase("a", "construction", 4)])
        absent_cp = v9_detailed_cost_plan()
        absent_cp.fee_lines = [fee(phase_id="ghost")]
        absent_doc.cost_plan = absent_cp
        assert any(
            i.field == "cost_plan.fee_lines[0].phase_id" and 'no phase with id "ghost"' in i.message
            for i in v9_errs(absent_doc)
        )

    def test_fix_round_1_finding_5_rejects_a_refinance_anchor_naming_an_absent_phase(self):
        d = v9_doc_with([v9_phase("a", "planning", 2)])
        d.exit_strategy = d.exit_strategy.model_copy(update={"route": "retain_all"})
        d.refinance = RefinanceInputsV9(
            month_offset=0, investment_value_pence=0, ltv_pct=50,
            arrangement_fee_pence=0, legal_costs_pence=0,
            anchor=PhaseAnchor(phase_id="ghost", offset_months=0),
        )
        e = v9_errs(d)
        assert any(
            i.field == "refinance.anchor" and 'no phase with id "ghost"' in i.message for i in e
        )

    def test_rejects_an_empty_phases_array(self):
        assert any(i.field == "programme.phases" for i in v9_errs(v9_doc_with([])))

    # Task 10's carried gap (Task 16): the four Sec6.1 user_defined rules are
    # evaluated per phase (validation.py, mirroring validation.ts:759-765) but
    # had NO v9 network test in either engine -- only the v4
    # `programme.packages` arm (TestV4ProgrammeValidation, above) was
    # covered. The mirror was faithful (TS's gap is identical, closed
    # alongside this one), so the gap was real on both sides, not merely
    # under-ported. Field + exact message, not a bare length check any
    # unrelated error would also satisfy.
    @staticmethod
    def _with_weights(weights: list[float]) -> CalculatorInputsV9:
        phase = Phase(
            id="a", code="planning", label="a", duration_months=4,
            slip_months=0, start_offset=0,
            curve=UserDefinedSpendCurve(kind="user_defined", weights=weights),
            predecessors=[],
        )
        return v9_doc_with([phase])

    def test_rejects_user_defined_weights_whose_length_ne_duration(self):
        e = v9_errs(self._with_weights([1, 1]))  # duration is 4, only 2 weights supplied
        assert any(
            i.field == "programme.phases.a"
            and i.message == "user_defined weights must have one entry per window month."
            for i in e
        )

    def test_rejects_non_finite_user_defined_weights_on_a_network_phase(self):
        e = v9_errs(self._with_weights([1, float("nan"), 1, 1]))
        assert any(
            i.field == "programme.phases.a"
            and i.message == "user_defined weights must be finite numbers."
            for i in e
        )

    def test_rejects_a_negative_user_defined_weight_on_a_network_phase(self):
        e = v9_errs(self._with_weights([1, -1, 1, 1]))
        assert any(
            i.field == "programme.phases.a"
            and i.message == "user_defined weights cannot be negative."
            for i in e
        )

    def test_rejects_user_defined_weights_that_sum_to_le_0_on_a_network_phase(self):
        e = v9_errs(self._with_weights([0, 0, 0, 0]))
        assert any(
            i.field == "programme.phases.a"
            and i.message == "user_defined weights must sum to more than zero."
            for i in e
        )

    def test_overrun_names_the_phase_and_the_overrun_in_months(self):
        e = v9_errs(v9_doc_with([
            v9_phase("c", "construction", 9),
            v9_phase("m", "marketing", 15, [v9_dep("c")]),
        ], term=18))
        overrun = next((i for i in e if "after maturity" in i.message), None)
        assert overrun is not None
        assert "Phase 'm'" in overrun.message
        assert "6 months" in overrun.message  # finish 24 vs term 18

    def test_fix_round_1_finding_1_two_breaching_phases_each_get_their_own_overrun_figure(self):
        # Two independent (non-chained) phases, both past term=18: 'a' finishes
        # 20 (own overrun 2), 'b' finishes 30 (own overrun 12, and 'b' is the
        # phase that sets the programme's global finish). Splicing the GLOBAL
        # overrun into every breaching phase's sentence would give 'a' the
        # same "12 months" as 'b' -- wrong, since 'a' itself is only 2 months
        # late.
        e = v9_errs(v9_doc_with([
            v9_phase("a", "construction", 20, start_offset=0),
            v9_phase("b", "marketing", 30, start_offset=0),
        ], term=18))
        a_overrun = next((i for i in e if i.field == "programme.phases.a" and "after maturity" in i.message), None)
        b_overrun = next((i for i in e if i.field == "programme.phases.b" and "after maturity" in i.message), None)
        assert a_overrun is not None
        assert b_overrun is not None
        assert "Programme finishes month 30" in a_overrun.message
        assert "Phase 'a' ends 2 months after maturity" in a_overrun.message
        assert "Programme finishes month 30" in b_overrun.message
        assert "Phase 'b' ends 12 months after maturity" in b_overrun.message

    def test_fix_round_1_finding_3_overrun_milestone_arm_boundary(self):
        """Legal at start = term-1, breaches one month later."""
        legal = v9_doc_with([
            v9_phase("base", "construction", 1),
            v9_phase("a", "unit_completions", 0, start_offset=23),
        ], term=24)
        assert not any("after maturity" in i.message for i in v9_errs(legal))

        breach = v9_doc_with([
            v9_phase("base", "construction", 1),
            v9_phase("a", "unit_completions", 0, start_offset=24),
        ], term=24)
        assert any(
            i.field == "programme.phases.a" and "after maturity" in i.message
            for i in v9_errs(breach)
        )

    def test_fix_round_1_finding_3_tail_milestone_arm_boundary(self):
        """Legal at start = term-2, breaches one month later."""
        legal = v9_doc_with([
            v9_phase("base", "construction", 1),
            v9_phase("pc", "practical_completion", 0, start_offset=22),
        ], term=24)
        assert not any("sale tail" in i.message for i in v9_errs(legal))

        breach = v9_doc_with([
            v9_phase("base", "construction", 1),
            v9_phase("pc", "practical_completion", 0, start_offset=23),
        ], term=24)
        assert any(
            i.field == "programme.phases.pc" and "sale tail" in i.message
            for i in v9_errs(breach)
        )

    def test_tail_binds_pre_completion_codes_and_not_marketing(self):
        # construction (finish 24) breaches the tail -- the boundary is finish
        # <= term - 1 = 23, so finish 23 (duration 23) is exactly LEGAL;
        # duration 24 is the first illegal window.
        assert any(
            "sale tail" in i.message
            for i in v9_errs(v9_doc_with([v9_phase("c", "construction", 24)], term=24))
        )
        # ...but marketing finishing there does not
        assert not any(
            "sale tail" in i.message
            for i in v9_errs(v9_doc_with([v9_phase("m", "marketing", 23)], term=24))
        )

    def test_tail_other_gets_the_weaker_overrun_rule_not_the_tail_rule(self):
        assert not any(
            "sale tail" in i.message
            for i in v9_errs(v9_doc_with([v9_phase("o", "other", 23)], term=24))
        )
        # Fix round 1, Finding 4: pin what "weaker" MEANS -- 'other' is exempt
        # from the tail rule but not from the overrun rule, which still fires.
        e = v9_errs(v9_doc_with([v9_phase("o", "other", 25)], term=24))
        assert any(
            i.field == "programme.phases.o" and "after maturity" in i.message for i in e
        )

    def test_a_migrated_three_phase_network_produces_the_same_tail_issue_as_its_v8_twin(self):
        """This is the property Task 8's alias map depends on. Asserted here
        too, at the rule, so a scope change to PRE_COMPLETION_CODES fails
        twice."""
        v8 = migrate_inputs_to_v8({})
        v8.finance = v8.finance.model_copy(update={"term_months": 6})
        v8.programme = ProgrammeInputs(
            anchor_month=None,
            packages=ProgrammePackages(
                construction=ProgrammePackage(start_offset=0, duration_months=6, curve=SL),
                professional=ProgrammePackage(start_offset=0, duration_months=1, curve=SL),
                statutory=ProgrammePackage(start_offset=0, duration_months=1, curve=SL),
            ),
        )
        before_fields = sorted(i.field for i in validate_inputs(v8))
        after_fields = sorted(i.field for i in validate_inputs(migrate_v8_to_v9(v8)))
        assert after_fields == sorted(PROGRAMME_FIELD_ALIASES.get(f, f) for f in before_fields)


def _v9_network_doc(term: int = 24) -> CalculatorInputsV9:
    """Three independent (non-chained) phases so that slipping one does not
    cascade a start onto the others through a dependency -- the crossing test
    below needs a genuine crossing, not one the derivation would have
    propagated for it. The Python twin of validation.test.ts's `networkDoc`."""
    return v9_doc_with([
        v9_phase("planning", "planning", 3),
        v9_phase("unit_completions", "unit_completions", 0, start_offset=10),
        v9_phase("sales", "sales", 5, start_offset=11),
    ], term)


def _v9_doc_with_tranches(trs: list[dict]) -> CalculatorInputsV9:
    d = _v9_network_doc()
    d.sales_phasing = SalesPhasingInputsV9(tranches=[
        SalesPhasingTrancheV9(
            month_offset=t["month_offset"], pct_of_gross_receipts=t["pct_of_gross_receipts"],
            anchor=t.get("anchor"),
        )
        for t in trs
    ])
    return d


def _v9_with_slip(d: CalculatorInputsV9, phase_id: str, months: int) -> CalculatorInputsV9:
    new_phases = [
        p.model_copy(update={"slip_months": p.slip_months + months}) if p.id == phase_id else p
        for p in d.programme.phases
    ]
    d2 = d.model_copy()
    d2.programme = d.programme.model_copy(update={"phases": new_phases})
    return d2


class TestAnchorsAndScenarioSlip:
    """Python twin of validation.test.ts's 'anchors and scenario slip --
    Sec18.6/18.8/18.9' describe block (R12 Task 10)."""

    def test_rejects_an_anchor_naming_an_absent_phase(self):
        d = _v9_doc_with_tranches([
            {"anchor": PhaseAnchor(phase_id="ghost", offset_months=0), "month_offset": 0, "pct_of_gross_receipts": 100},
        ])
        e = v9_errs(d)
        assert any(
            i.field == "sales_phasing.tranches[0].anchor" and 'no phase with id "ghost"' in i.message
            for i in e
        )

    def test_rejects_resolved_tranche_months_that_are_not_strictly_increasing(self):
        # Two tranches anchored to DIFFERENT phases can cross when one slips.
        # The rule reads the resolved months, not the entered ones -- a
        # document whose entered offsets ascend can still resolve out of
        # order.
        d = _v9_doc_with_tranches([
            {
                "anchor": PhaseAnchor(phase_id="unit_completions", offset_months=0),
                "month_offset": 0, "pct_of_gross_receipts": 40,
            },
            {
                "anchor": PhaseAnchor(phase_id="sales", offset_months=0),
                "month_offset": 0, "pct_of_gross_receipts": 60,
            },
        ])
        crossed = _v9_with_slip(d, "unit_completions", 9)  # pushes tranche 0 past tranche 1
        assert any(
            i.field == "sales_phasing.tranches[1]" and "strictly increasing" in i.message
            for i in v9_errs(crossed)
        )
        # Negative control: unslipped, the same document is clean.
        assert v9_errs(d) == []

    def test_rejects_a_scenario_phase_slip_phase_id_naming_an_absent_phase(self):
        d = _v9_network_doc()
        d.scenarios.downside = d.scenarios.downside.model_copy(
            update={"phase_slip_phase_id": "ghost", "phase_slip_months": 3},
        )
        e = v9_errs(d)
        assert any(
            i.field == "scenarios.downside.phase_slip_phase_id"
            and 'no phase with id "ghost"' in i.message
            for i in e
        )

    def test_rejects_a_scenario_phase_slip_phase_id_set_while_programme_is_none(self):
        # A slip with nothing to slip must not be a silent no-op -- that is
        # what would make the lever look live while doing nothing (Sec18.9).
        d = migrate_inputs_to_v9({})
        d.programme = None
        d.scenarios.downside = d.scenarios.downside.model_copy(
            update={"phase_slip_phase_id": "planning", "phase_slip_months": 3},
        )
        e = v9_errs(d)
        assert any(
            i.field == "scenarios.downside.phase_slip_phase_id"
            and "has no programme network" in i.message
            for i in e
        )


class TestInvestmentCaseValidation:
    """Python twin of validation.test.ts's '§19.7 investment case validation'
    describe block (R13 Task 7). Ported from Task 6's final TS state (twelve
    rules, nine accepting twins and five branch tests added in its fix round)
    -- not the brief's own pseudocode, per this task's brief. Uses
    tests/fixtures_investment_case.py's ic_doc builder throughout, never a
    hand-authored document."""

    @staticmethod
    def _err_fields(doc) -> list[str]:
        return [i.field for i in validate_inputs(doc) if i.severity == "error"]

    def test_rule_1_rejects_an_investment_case_on_a_sell_all_route(self):
        assert "investment_case" in self._err_fields(ic_doc({"route": "sell_all"}))
        assert "investment_case" not in self._err_fields(ic_doc())

    def test_rule_2_rejects_retain_all_with_a_rent_row_missing_for_any_unit(self):
        # The silent-understatement trap: every unit is retained, but only
        # listed units carry a rent, so a short list understates NOI, value
        # and quantum with no error anywhere.
        short = ic_doc({"drop_retained_unit": "u2"})
        assert "exit_strategy.retained_units" in self._err_fields(short)
        assert "exit_strategy.retained_units" not in self._err_fields(ic_doc())

    def test_rule_3_rejects_a_rent_row_naming_a_unit_that_does_not_exist_accepts_its_real_unit_twin(self):
        assert "exit_strategy.retained_units" in self._err_fields(ic_doc({"add_retained_unit_id": "ghost"}))
        assert "exit_strategy.retained_units" not in self._err_fields(ic_doc())

    def test_rule_4_rejects_a_zero_rent_roll_accepts_its_priced_twin(self):
        assert "exit_strategy.retained_units" in self._err_fields(ic_doc({"all_rents_zero": True}))
        assert "exit_strategy.retained_units" not in self._err_fields(ic_doc())

    def test_rule_2_the_missing_unit_message_agrees_in_number_lender_facing_copy(self):
        # drop_retained_unit removes exactly one of the five retained units,
        # so this is the singular case; the plural form is not separately
        # exercised (the builder only drops one at a time) but the same
        # ternary drives both.
        issue = next(
            i for i in validate_inputs(ic_doc({"drop_retained_unit": "u2"}))
            if i.field == "exit_strategy.retained_units"
        )
        assert issue.message.endswith("1 unit has none.")
        assert "unit(s)" not in issue.message

    def test_rule_5_rejects_a_non_null_explicit_value_alongside_an_investment_case(self):
        assert "refinance.investment_value_pence" in self._err_fields(ic_doc({"explicit_value": 5_000_000_00}))

    def test_rule_5_other_arm_rejects_a_null_explicit_value_with_no_investment_case(self):
        assert "refinance.investment_value_pence" in self._err_fields(
            ic_doc({"investment_case": None, "explicit_value": None}),
        )

    def test_rule_5_third_arm_a_null_refinance_alongside_an_investment_case_is_legal(self):
        # The indicative case of Sec 19.1 -- sizing computed and reported,
        # nothing booked.
        assert self._err_fields(ic_doc({"refinance": None})) == []

    def test_rule_6_rejects_a_stabilisation_anchor_naming_an_absent_phase_accepts_its_real_phase_twin(self):
        assert "investment_case.stabilisation.anchor" in self._err_fields(
            ic_doc({"anchor_phase_id": "no_such_phase"}),
        )
        # ic_doc()'s own default anchors to 'practical_completion', a real phase.
        assert "investment_case.stabilisation.anchor" not in self._err_fields(ic_doc())

    def test_rule_7_rejects_a_stabilisation_month_past_maturity_accepts_its_in_term_twin(self):
        assert "investment_case.stabilisation.month_offset" in self._err_fields(
            ic_doc({"stabilisation_month": 24, "term_months": 24}),
        )
        assert "investment_case.stabilisation.month_offset" not in self._err_fields(
            ic_doc({"stabilisation_month": 23, "term_months": 24}),
        )

    def test_rule_8_rejects_an_occupancy_outside_0_100_and_a_fractional_ramp(self):
        assert "investment_case.stabilisation.stabilised_occupancy_pct" in self._err_fields(
            ic_doc({"occupancy_pct": 0}),
        )
        assert "investment_case.stabilisation.stabilised_occupancy_pct" in self._err_fields(
            ic_doc({"occupancy_pct": 100.1}),
        )
        assert "investment_case.stabilisation.stabilised_occupancy_pct" not in self._err_fields(
            ic_doc({"occupancy_pct": 100}),
        )
        assert "investment_case.stabilisation.ramp_months" in self._err_fields(ic_doc({"ramp_months": 2.5}))
        # Accepting twin: same field, a valid whole-month value.
        assert "investment_case.stabilisation.ramp_months" not in self._err_fields(ic_doc({"ramp_months": 6}))

    def test_rule_9_rejects_a_non_positive_yield_accepts_a_positive_one(self):
        assert "investment_case.valuation.cap_yield_pct" in self._err_fields(ic_doc({"cap_yield_pct": 0}))
        assert "investment_case.valuation.cap_yield_pct" not in self._err_fields(ic_doc({"cap_yield_pct": 5}))

    def test_rule_9_rejects_negative_purchasers_costs_accepts_zero(self):
        assert "investment_case.valuation.purchasers_costs_pct" in self._err_fields(
            ic_doc({"purchasers_costs_pct": -1}),
        )
        assert "investment_case.valuation.purchasers_costs_pct" not in self._err_fields(
            ic_doc({"purchasers_costs_pct": 0}),
        )

    def test_rule_10_rejects_each_out_of_range_takeout_term_accepts_each_in_range_twin(self):
        assert "investment_case.takeout.ltv_cap_pct" in self._err_fields(ic_doc({"ltv_cap_pct": 0}))
        assert "investment_case.takeout.ltv_cap_pct" not in self._err_fields(ic_doc({"ltv_cap_pct": 60}))
        assert "investment_case.takeout.dscr_floor" in self._err_fields(ic_doc({"dscr_floor": 0}))
        assert "investment_case.takeout.dscr_floor" not in self._err_fields(ic_doc({"dscr_floor": 1.5}))
        assert "investment_case.takeout.icr_floor" in self._err_fields(ic_doc({"icr_floor": -1}))
        assert "investment_case.takeout.icr_floor" not in self._err_fields(ic_doc({"icr_floor": 1.5}))
        assert "investment_case.takeout.amortisation_years" in self._err_fields(ic_doc({"amortisation_years": 0}))
        assert "investment_case.takeout.amortisation_years" not in self._err_fields(
            ic_doc({"amortisation_years": None}),
        )

    def test_rule_10_rejects_a_negative_take_out_rate_accepts_zero(self):
        assert "investment_case.takeout.annual_rate_pct" in self._err_fields(ic_doc({"annual_rate_pct": -1}))
        assert "investment_case.takeout.annual_rate_pct" not in self._err_fields(ic_doc({"annual_rate_pct": 0}))

    def test_rule_10_rejects_a_non_positive_take_out_term_accepts_a_positive_one(self):
        assert "investment_case.takeout.term_years" in self._err_fields(ic_doc({"term_years": 0}))
        assert "investment_case.takeout.term_years" not in self._err_fields(ic_doc({"term_years": 5}))

    def test_rule_11_rejects_duplicate_line_ids_and_an_over_100_percentage_line_allows_an_empty_schedule(self):
        assert "investment_case.operating_lines" in self._err_fields(ic_doc({"duplicate_line_ids": True}))
        assert "investment_case.operating_lines.l1.value" in self._err_fields(ic_doc({"pct_line_value": 101}))
        assert self._err_fields(ic_doc({"lines": []})) == []

    def test_rule_11_rejects_a_blank_line_id_accepts_its_named_twin(self):
        assert "investment_case.operating_lines" in self._err_fields(ic_doc({"blank_line_id": True}))
        assert "investment_case.operating_lines" not in self._err_fields(ic_doc())

    def test_rule_11_fix_wave_minor_6_two_blank_ids_raise_needs_an_id_twice_not_a_spurious_duplicate(self):
        # R13 fix-wave Minor 6. `seen.add(line.id)` used to run unconditionally,
        # including on the blank-id branch -- so the FIRST blank id got added
        # to `seen`, and the SECOND blank-id line then also failed
        # `line.id in seen`, raising a spurious `Duplicate operating line id
        # ""` alongside the legitimate "needs an id" message.
        doc = ic_doc({
            "lines": [
                OperatingLine(id="", code="management", label="Management fee", basis="pct_of_gross_rent", value=10),
                OperatingLine(
                    id="", code="insurance", label="Buildings insurance",
                    basis="fixed_pence_per_month", value=25000,
                ),
            ],
        })
        messages = [
            i.message for i in validate_inputs(doc)
            if i.severity == "error" and i.field == "investment_case.operating_lines"
        ]
        assert messages.count("Every operating line needs an id.") == 2
        assert not any("Duplicate operating line id" in m for m in messages)

    def test_rule_11_rejects_an_unrecognised_operating_cost_code_accepts_a_real_one(self):
        assert "investment_case.operating_lines.l1.code" in self._err_fields(ic_doc({"invalid_line_code": True}))
        assert "investment_case.operating_lines.l1.code" not in self._err_fields(ic_doc())

    def test_rule_12_rejects_an_out_of_range_arrangement_fee_percentage_even_with_no_investment_case_accepts_an_in_range_one(self):
        assert "refinance.arrangement_fee_pct" in self._err_fields(
            ic_doc({"investment_case": None, "arrangement_fee_pct": 101}),
        )
        assert "refinance.arrangement_fee_pct" not in self._err_fields(ic_doc({"investment_case": None}))


def _retain_all_v10() -> CalculatorInputsV10:
    """Built from fixtures/financial-model/l-retain-all.json via
    migrate_inputs_to_v10 (the task brief's instruction). Cash-funded
    (committed_net_facility_pence == 0), so it also exercises the debt rule's
    cash-deal arm (committed net is 0, not whatever the finance block happens
    to carry)."""
    raw = json.loads((FIXTURE_DIR / "l-retain-all.json").read_text(encoding="utf-8"))
    return migrate_inputs_to_v10(raw["inputs"])


def _valid_monitoring_line(category: MonitoringCategory, **over) -> MonitoringLineInputs:
    base = dict(
        category=category,
        current_budget_pence=100_000,
        certified_to_date_pence=50_000,
        paid_to_date_pence=40_000,
        committed_to_date_pence=60_000,
        forecast_to_complete_pence=20_000,
    )
    base.update(over)
    return MonitoringLineInputs(**base)


def _valid_monitoring(**over):
    base = dict(
        reporting_month=6,
        reporting_date="2026-06-01",
        lines=[_valid_monitoring_line(c) for c in MONITORING_CATEGORIES],
        debt_drawn_to_date_pence=0,
        cash_equity_injected_to_date_pence=500_000,
        author="QS",
        date="2026-06-01",
        note=None,
    )
    base.update(over)
    return base


def _v11_doc(monitoring) -> CalculatorInputsV11:
    v10 = _retain_all_v10()
    return CalculatorInputsV11.model_validate({
        **v10.model_dump(mode="json"),
        "inputs_version": 11,
        "monitoring": monitoring,
    })


class TestMonitoringValidation:
    """Python twin of validation.test.ts's '§20.3 monitoring validation'
    describe block (spec Sec 20.3, R14 Task 5)."""

    CASH_EQUITY_TOTAL = 90_000_000  # l-retain-all.json's single confirmed cash equity source

    def test_a_null_monitoring_block_adds_no_issue_with_a_monitoring_prefix(self):
        issues = validate_inputs(_v11_doc(None))
        assert not any(i.field.startswith("monitoring") for i in issues)

    def test_a_valid_monitoring_block_adds_no_issue(self):
        issues = validate_inputs(_v11_doc(_valid_monitoring()))
        assert not any(i.field.startswith("monitoring") for i in issues)

    def test_rejects_a_reporting_month_outside_1_term(self):
        doc = _v11_doc(_valid_monitoring(reporting_month=13))  # l-retain-all's term is 12
        issue = next(i for i in validate_inputs(doc) if i.field == "monitoring.reporting_month")
        assert issue.severity == "error"
        assert issue.message == "reporting_month must be between 1 and the term (12)"

    def test_rejects_a_lines_block_missing_a_category(self):
        lines = [_valid_monitoring_line(c) for c in MONITORING_CATEGORIES if c != "contingency"]
        doc = _v11_doc(_valid_monitoring(lines=lines))
        issue = next(i for i in validate_inputs(doc) if i.field == "monitoring.lines")
        assert issue.severity == "error"
        assert issue.message == (
            "monitoring must carry exactly one line per category "
            "(acquisition, construction, professional, statutory, contingency)"
        )

    def test_rejects_a_lines_block_with_a_duplicated_category(self):
        lines = [_valid_monitoring_line(c) for c in MONITORING_CATEGORIES if c != "contingency"]
        lines.append(_valid_monitoring_line("acquisition"))
        doc = _v11_doc(_valid_monitoring(lines=lines))
        assert any(i.field == "monitoring.lines" for i in validate_inputs(doc))

    def test_rejects_a_line_whose_paid_exceeds_certified(self):
        lines = [_valid_monitoring_line(c) for c in MONITORING_CATEGORIES]
        lines[0] = _valid_monitoring_line(
            lines[0].category, certified_to_date_pence=100, paid_to_date_pence=101, committed_to_date_pence=200,
        )
        doc = _v11_doc(_valid_monitoring(lines=lines))
        issue = next(i for i in validate_inputs(doc) if i.field == "monitoring.lines[0].paid_to_date_pence")
        assert issue.severity == "error"
        assert issue.message == "paid to date cannot exceed certified to date"

    def test_rejects_a_line_whose_certified_exceeds_committed(self):
        lines = [_valid_monitoring_line(c) for c in MONITORING_CATEGORIES]
        lines[0] = _valid_monitoring_line(
            lines[0].category, certified_to_date_pence=200, paid_to_date_pence=100, committed_to_date_pence=199,
        )
        doc = _v11_doc(_valid_monitoring(lines=lines))
        issue = next(i for i in validate_inputs(doc) if i.field == "monitoring.lines[0].certified_to_date_pence")
        assert issue.severity == "error"
        assert issue.message == "certified to date cannot exceed committed to date"

    def test_rejects_debt_drawn_to_date_exceeding_the_committed_net_facility_zero_for_a_cash_deal(self):
        doc = _v11_doc(_valid_monitoring(debt_drawn_to_date_pence=1))
        issue = next(i for i in validate_inputs(doc) if i.field == "monitoring.debt_drawn_to_date_pence")
        assert issue.severity == "error"
        assert issue.message == "debt drawn to date cannot exceed the committed net facility"

    def test_warns_not_errors_when_cash_equity_injected_exceeds_committed_cash_sources(self):
        doc = _v11_doc(_valid_monitoring(cash_equity_injected_to_date_pence=self.CASH_EQUITY_TOTAL + 1))
        issues = validate_inputs(doc)
        issue = next(i for i in issues if i.field == "monitoring.cash_equity_injected_to_date_pence")
        assert issue.severity == "warning"
        assert issue.message == "equity injected beyond committed sources"
        # Not an error (spec Sec 20.3): report_safe is unaffected by this alone.
        assert not any(
            i.severity == "error" and i.field == "monitoring.cash_equity_injected_to_date_pence" for i in issues
        )

    def test_accepts_cash_equity_injected_exactly_at_the_committed_total_boundary(self):
        doc = _v11_doc(_valid_monitoring(cash_equity_injected_to_date_pence=self.CASH_EQUITY_TOTAL))
        issues = validate_inputs(doc)
        assert not any(i.field == "monitoring.cash_equity_injected_to_date_pence" for i in issues)


def _extract_ts_err_message(block: str, i: int) -> tuple[str, int]:
    """Reads one quoted string (``'``, ``"`` or `` ` ``-delimited) starting at
    ``block[i]``, honouring a backslash escape, and returns ``(content,
    index_after_closing_quote)``."""
    quote = block[i]
    j = i + 1
    buf: list[str] = []
    while block[j] != quote:
        if block[j] == "\\":
            buf.append(block[j])
            buf.append(block[j + 1])
            j += 2
            continue
        buf.append(block[j])
        j += 1
    return "".join(buf), j + 1


def _skip_ts_argument(block: str, i: int) -> int:
    """Advances past ONE call argument, returning the index of the top-level
    comma that ends it.

    R15 Task 6 widened the drift window onto the Sec 22.7 block, whose err()
    calls pass a VARIABLE as the field (``err(field, ...)``, and
    ``err(`${field}.exchange`, ...)``) rather than the plain string literal
    every Sec 19.7 call happens to use. Reading the field argument as a quoted
    string, as this extractor did until now, walked straight off the end of a
    bare identifier and mis-parsed the rest of the file. Quoted strings
    (including template literals) and bracket nesting are both tracked, so any
    argument shape is skipped cleanly."""
    depth = 0
    while True:
        c = block[i]
        if c in "'\"`":
            _content, i = _extract_ts_err_message(block, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            assert depth > 0, f"err() call ended before its message argument at {block[i:i + 40]!r}"
            depth -= 1
        elif c == "," and depth == 0:
            return i
        i += 1


def _extract_ts_err_messages(block: str) -> list[str]:
    """Every ``err(field, message)`` call's raw message argument in ``block``.

    The brief's own extractor (a single ``[^']+`` regex) breaks on rule 2's
    pluralisation ternary -- a template literal containing a NESTED single
    quote (`` `...${n === 1 ? '' : 's'}...` ``) closes the regex's character
    class early and silently truncates the match. This walks the source
    character-by-character instead, matching whichever quote character each
    string actually opens with, so a different quote type nested inside is
    just content."""
    import re

    out: list[str] = []
    for m in re.finditer(r"\berr\(", block):
        i = _skip_ts_argument(block, m.end())  # the field argument, discarded
        assert block[i] == ",", f"unexpected err() call shape at {block[i:i + 40]!r}"
        i += 1
        while block[i] in " \n\t":
            i += 1
        if block[i] in "'\"`":
            message, i = _extract_ts_err_message(block, i)
        else:
            # Sec 22.7 rule 1 hoists ONE message into a `const msg = '...'` and
            # raises it on both `unit_sales` and `sales_phasing`. Resolve the
            # binding rather than skip the call: that hoisted string is a real
            # rule message, and it is one of the messages that drifted.
            #
            # Fix round 1, Minor 2: resolve against the source BEFORE the call
            # site and take the LAST match, i.e. the nearest preceding
            # declaration. Searching the whole window and taking the first
            # match returns the wrong string the moment a second `const msg`
            # is declared later in the window -- and `msg` is exactly the kind
            # of short, reusable name a second rule block would pick.
            name_match = re.match(r"[A-Za-z_$][\w$]*", block[i:])
            assert name_match is not None, f"unreadable err() message argument at {block[i:i + 40]!r}"
            name = name_match.group(0)
            decls = list(re.finditer(rf"\bconst {re.escape(name)} = (?=['\"`])", block[:i]))
            assert decls, f"cannot resolve the err() message identifier {name!r}"
            message, _ = _extract_ts_err_message(block, decls[-1].end())
            i += len(name)
        out.append(message)
    return out


def test_the_extractor_resolves_a_hoisted_const_to_the_nearest_preceding_declaration():
    """Fix round 1, Minor 2 -- a test of the test. Two `const msg` bindings in
    one window, each raised on its own rule: the extractor must return each
    call's OWN message, in source order. Resolving by first-match-anywhere
    returns the first message twice, which is a drift guard silently
    comparing the wrong string."""
    snippet = """
      const msg = 'the first hoisted rule message';
      err('alpha', msg);
      if (other) {
        const msg = 'the second hoisted rule message';
        err('beta', msg);
      }
    """
    assert _extract_ts_err_messages(snippet) == [
        "the first hoisted rule message",
        "the second hoisted rule message",
    ]


def test_validation_messages_match_the_typescript_engine():
    """Governance Sec 1: every rule added to validation.ts is added to
    validation.py with the SAME field string and the SAME message text. This
    test reads the TS source and requires each in-window message to appear in
    the Python source verbatim -- the two files drift silently otherwise, and
    a lender reading two different wordings for one rule is the visible
    symptom.

    R15 Task 6 widened the window. It covered the Sec 19.7 block alone until
    this release; it now runs from the Sec 22.7 unit-sales block (so Sec 22.7
    and Sec 19.7 are both inside it) and reads validateDueDiligence's body as
    a second window, because that function -- like validateMonitoring -- sits
    below validateInputs and no start anchor inside validateInputs can reach
    it. Widening it found three Sec 22.7 messages that had drifted since R13b
    (the TS em-dash against an ASCII " - " in Python); the Python strings were
    moved to the TS text, message text only.

    Two robustness fixes over the brief's own Step-4 pseudocode (both
    necessary -- the brief's version does not run; see this task's report):

    1. TS extraction is scoped by source location, not matched by field-prefix
       across the WHOLE file. The brief's `err\\('(?:investment_case|
       refinance|exit_strategy)...` pattern also catches pre-existing,
       out-of-scope rules (e.g. the Release 3b sell-all refinance guard) that
       this task does not own and that already carry an unrelated ASCII-hyphen
       vs em-dash drift between the two engines -- scoping by source location
       is both more correct (it is what "a Sec N message" means) and avoids
       failing on a pre-existing, unrelated mismatch.
    2. Python-side matching walks the AST (`ast.parse`) instead of doing a raw
       substring search on file text. Two things a text search gets wrong and
       the AST does not: (a) this file wraps long messages across adjacent
       string literals to stay under the 100-column limit -- adjacent Python
       string literals are ONE token to the parser but not to a text search,
       so a message split at the "wrong" point reads as absent even though it
       is present; (b) a message containing an embedded `"` is written here as
       either `f'...' + '"'`-free single-quoted text or an escaped `\\"`
       inside a double-quoted string -- the AST's `Constant.value` is the
       actual (unescaped) string, so either spelling matches, where a text
       search over raw source only matches the one that happens not to need
       escaping.
    """
    import ast
    from pathlib import Path

    ts = Path("frontend/src/lib/model/validation.ts").read_text(encoding="utf-8")
    py = Path("app/financial_model/validation.py").read_text(encoding="utf-8")

    start = ts.index("const unitSales = 'unit_sales' in inputs ? inputs.unit_sales : null;")
    end = ts.index("if ('jurisdiction' in inputs.acquisition) {")
    # R15 Task 6, second window: validateDueDiligence is a separate function
    # (validateMonitoring's shape), so its err() calls sit BELOW validateInputs
    # and outside the window above however far its start anchor is moved. The
    # Sec 23.9 messages are the ones this release adds, so the guard reads
    # that function's body too rather than covering only the blocks it happens
    # to enclose -- the brief's "so the drift guard's window covers it".
    dd_start = ts.index("export function validateDueDiligence(")
    dd_end = ts.index("export function validateMonitoring(")
    # Fix round 1, I1. `ts.index` cannot tell the two anchors apart if
    # validateDueDiligence is ever moved BELOW validateMonitoring: the slice
    # would silently be empty, and the first window alone still clears a
    # single combined bound -- so every Sec 23.9 message would stop being
    # compared with the suite fully green. This repo's rule is that a guard
    # must not be able to go vacuous by its own subject moving, so the order
    # is asserted and EACH window carries its own bound rather than one total.
    assert dd_start < dd_end, (
        "validateDueDiligence must be declared before validateMonitoring in validation.ts -- "
        "this guard slices between those two anchors, and the reversed order silently empties "
        "the Sec 23.9 window"
    )
    unit_sales_msgs = _extract_ts_err_messages(ts[start:end])
    due_diligence_msgs = _extract_ts_err_messages(ts[dd_start:dd_end])
    assert len(unit_sales_msgs) >= 45, "the extractor stopped matching — fix it, do not lower the bound"
    assert len(due_diligence_msgs) >= 25, "the extractor stopped matching — fix it, do not lower the bound"
    ts_msgs = unit_sales_msgs + due_diligence_msgs

    tree = ast.parse(py)
    py_strings: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            py_strings.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            # The constant prefix ahead of the first `{...}` interpolation --
            # the same slice `prefix = m.split("${")[0])` takes on the TS side.
            prefix_parts: list[str] = []
            for part in node.values:
                if isinstance(part, ast.Constant):
                    prefix_parts.append(part.value)
                else:
                    break
            if prefix_parts:
                py_strings.append("".join(prefix_parts))

    for m in ts_msgs:
        # Template literals are compared on their fixed prefix, which is what
        # makes a reworded message fail while an interpolated id does not.
        prefix = m.split("${")[0].strip()
        if len(prefix) > 20:
            assert any(prefix in s for s in py_strings), f"message missing from the Python engine: {prefix!r}"


class TestUnitSalesValidation:
    """Sec 22.7. Twin of validation.test.ts's '§22.7 unit sales validation'."""

    @staticmethod
    def _errs(doc):
        return [i for i in validate_inputs(doc) if i.severity == "error"]

    def _fields(self, doc):
        return [i.field for i in self._errs(doc)]

    def _row(self, **changes):
        base = {"unit_id": "u1", "exchange": {"month_offset": 8, "anchor": None},
                "completion": {"month_offset": 12, "anchor": None},
                "deposit_pct": 10, "agent_fee_pct": None, "legal_fee_pence": None}
        return {**base, **changes}

    def _rows_with(self, **changes):
        rows = [self._row(), self._row(unit_id="u2", exchange={"month_offset": 10, "anchor": None}, completion={"month_offset": 13, "anchor": None}),
                self._row(unit_id="u3", exchange=None, deposit_pct=0, completion={"month_offset": 13, "anchor": None}),
                self._row(unit_id="u4", exchange={"month_offset": 11, "anchor": None}, completion={"month_offset": 20, "anchor": None}, deposit_pct=5)]
        rows[0] = {**rows[0], **changes}
        return rows

    def test_the_four_valid_builders_are_clean(self):
        assert self._fields(unit_sales_doc()) == []
        assert self._fields(no_programme_doc()) == []

    def test_rule_1_both_blocks_set_errors_on_both_fields(self):
        f = self._fields(unit_sales_doc({"sales_phasing_too": True}))
        assert "unit_sales" in f and "sales_phasing" in f

    def test_rule_2_retain_all_rejects_the_block(self):
        assert "unit_sales" in self._fields(unit_sales_doc({"route": "retain_all"}))

    @staticmethod
    def _reparse(doc, mutate):
        """Dump, mutate the raw dict in place, re-parse through the migration
        -- the only way to build a shape the builder does not offer."""
        raw = doc.model_dump(mode="json")
        mutate(raw)
        return migrate_inputs_to_v12(raw, None)

    def test_rule_3_four_distinct_messages(self):
        e = self._errs(unit_sales_doc({"drop_row": "u3"}))
        assert any(i.field == "unit_sales" and 'Sold unit "u3" has no sale row.' == i.message for i in e)
        e = self._errs(unit_sales_doc({"extra_row": "u9"}))
        assert any(i.field == "unit_sales.units[4]" and 'does not exist in the unit mix' in i.message for i in e)
        e = self._errs(unit_sales_doc({"extra_row": "u4"}))
        assert any(i.field == "unit_sales.units[4]" and 'has more than one sale row' in i.message for i in e)
        # Retained under blended: u2 retained, so its row names a retained unit.
        def retain_u2(raw):
            raw["exit_strategy"]["retained_units"] = [{"unit_id": "u2", "monthly_rent_pence": 100_000}]
        e = self._errs(self._reparse(unit_sales_doc({"route": "blended"}), retain_u2))
        assert any(i.field == "unit_sales.units[1]" and 'is retained and cannot carry a sale row' in i.message for i in e)

    def test_rule_4_window_anchor_and_resolved_month(self):
        assert "unit_sales.units[0].completion" in self._fields(
            unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 24, "anchor": None})}))
        assert "unit_sales.units[0].exchange" in self._fields(
            unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": -1, "anchor": None})}))
        # anchor on a document with no network
        def anchor_without_network(raw):
            raw["unit_sales"]["units"][0]["completion"] = {"month_offset": 0, "anchor": {"phase_id": "construction", "offset_months": 0}}
        assert "unit_sales.units[0].completion" in self._fields(self._reparse(no_programme_doc(), anchor_without_network))
        # anchor naming an absent phase
        assert "unit_sales.units[0].completion.anchor" in self._fields(
            unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "ghost", "offset_months": 0}})}))
        # resolved past the term: practical_completion (12) + 12 = 24
        e = self._errs(unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 12}})}))
        assert any(i.field == "unit_sales.units[0].completion" and "resolves to month 24" in i.message for i in e)
        # its twin one month earlier is clean
        assert self._fields(unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 11}})})) == []

    def test_rule_5_exchange_after_completion(self):
        e = self._errs(unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": 13, "anchor": None})}))
        assert any(i.field == "unit_sales.units[0].exchange" and "(resolved months 13 > 12)" in i.message for i in e)
        assert self._fields(unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": 12, "anchor": None})})) == []

    def test_rule_6_deposit_range_and_exchange_requirement(self):
        assert "unit_sales.units[0].deposit_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(deposit_pct=101)}))
        assert "unit_sales.units[0].deposit_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(exchange=None, deposit_pct=10)}))
        assert self._fields(unit_sales_doc({"rows": self._rows_with(exchange=None, deposit_pct=0)})) == []

    def test_rule_7_overrides(self):
        assert "unit_sales.units[0].agent_fee_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(agent_fee_pct=100)}))
        assert "unit_sales.units[0].legal_fee_pence" in self._fields(unit_sales_doc({"rows": self._rows_with(legal_fee_pence=-1)}))

    def test_rule_9_zero_sold_value(self):
        def zero_values(raw):
            for u in raw["unit_mix"]["units"]:
                u["estimated_value_pence"] = 0
                u["ancillary"]["parking_value_pence"] = 0
        assert "unit_sales" in self._fields(self._reparse(unit_sales_doc(), zero_values))

    def test_sales_slip_must_be_whole_months(self):
        # Pydantic's int field already refuses 1.5 at parse time in Python; the
        # spec rule is enforced structurally here and by validateInputs in TS.
        def fractional_slip(raw):
            raw["scenarios"]["downside"]["sales_slip_months"] = 1.5
        with pytest.raises(ValidationError):
            self._reparse(unit_sales_doc(), fractional_slip)


class TestDueDiligenceValidation:
    """Sec 23.9. Twin of validation.test.ts's '23.9 due diligence validation'.

    Reachability, stated once here rather than repeated on every test: several
    Sec 23.9 rules guard a field Pydantic ALREADY constrains, so in Python the
    stray value is a 422 raised by ``model_validate`` and never reaches
    ``validate_inputs`` at all. Those are asserted here as ``ValidationError``
    and exercised as validation ISSUES in the TypeScript engine only, where a
    raw JSON payload is not coerced:

      * rule 0 (``status``) and rule 1f (``category``) -- ``DdStatus`` and
        ``DdCategory`` are ``Literal``s;
      * rule 6 (``cost_impact_pence`` / ``programme_impact_months``) -- ``int``
        with ``ge=0``;
      * rule 7's numeric and enum arms (``floor_area_sqm`` ``ge=0``,
        ``lease_years_remaining`` ``int``/``ge=0``, ``tenure`` a ``Literal``);
      * rule 8's ``stage``/``status`` and rule 9's ``price_basis``, all
        ``Literal``s.

    The rules themselves are implemented in validation.py regardless, for the
    reason the Sec 22.7 sales-slip rule is (see its comment there): a rule
    present in one engine and absent from the other is exactly the silent
    asymmetry the dual-engine mirror exists to prevent, and the drift guard
    compares the two engines' message lists.
    """

    @staticmethod
    def _issues(doc):
        return [i for i in validate_inputs(doc) if i.severity == "error"]

    def _fields(self, doc):
        return [i.field for i in self._issues(doc)]

    def _has(self, doc, field_, message):
        return any(i.field == field_ and i.message == message for i in self._issues(doc))

    @staticmethod
    def _item(**changes):
        """A complete raw due-diligence item -- every field written, never
        defaulted, because the TS twin reads the object as-is and a missing
        key there is `undefined`, not the schema default."""
        base = {
            "id": "dd-extra", "code": "custom", "category": "existing_building",
            "label": "Basement drainage", "status": "unknown", "evidence": None,
            "expiry_date": None, "owner": "", "due_date": None,
            "cost_impact_pence": None, "programme_impact_months": None,
            "action": "", "notes": "",
        }
        return {**base, **changes}

    @staticmethod
    def _record(**changes):
        """Fixture Y's captured listing record, optionally altered."""
        base = {
            "captured_at": "2026-08-25T09:00:00Z", "source_name": "rightmove",
            "source_url": "https://example.test/listing/y", "is_vacant": False,
            "tenure": "freehold", "lease_years_remaining": None,
            "floor_area_sqm": 360, "use_class": "office", "epc_rating": "D",
        }
        return {**base, **changes}

    def test_fixture_y_raises_no_error(self):
        assert self._fields(dd_doc()) == []

    def test_a_migrated_document_raises_no_due_diligence_issue(self):
        # The seed writes every entered item `unknown` with no evidence, no
        # action and no notes, `source_record` None, `qs` None and every
        # `price_basis` None -- nothing for Sec 23.9 to fire on.
        assert self._fields(migrate_inputs_to_v13(raw_y_as_v12(), None)) == []
        assert self._fields(dd_doc({"seed": True})) == []
        # A pre-v13 document has no due_diligence attribute at all.
        v12 = migrate_inputs_to_v12(raw_y_as_v12(), None)
        assert [f for f in self._fields(v12) if f.startswith(("due_diligence", "cost_plan.qs"))] == []

    # --- rule 1: the catalogue --------------------------------------------

    def test_rule_1a_a_missing_catalogue_item(self):
        assert self._has(
            dd_doc({"drop_item": "party_wall"}), "due_diligence",
            'Due diligence item "party_wall" is missing - every catalogue item must be present.',
        )
        assert self._fields(dd_doc()) == []

    def test_rule_1b_a_repeated_code(self):
        assert self._has(
            dd_doc({"dup_item": "insurance"}), "due_diligence.items[24].code",
            'Due diligence item "insurance" appears more than once.',
        )
        # Accepting twin: `custom` is the ONE repeatable code -- it names no
        # catalogue entry, so a second user-added item is a normal document,
        # not a duplicate.
        assert self._fields(dd_doc({"add_item": self._item(id="dd-custom-drainage")})) == []

    def test_rule_1c_a_derived_code_cannot_be_entered(self):
        assert self._has(
            dd_doc({"add_item": self._item(code="lender_valuation", category="exit")}),
            "due_diligence.items[24].code",
            'Due diligence item "lender_valuation" is derived from the model and cannot be entered.',
        )
        assert self._fields(dd_doc({"add_item": self._item(category="exit")})) == []

    def test_rule_1d_a_code_outside_the_catalogue(self):
        assert self._has(
            dd_doc({"add_item": self._item(code="drainage_survey")}),
            "due_diligence.items[24].code",
            'Due diligence item code "drainage_survey" is not in the catalogue.',
        )
        assert self._fields(dd_doc({"add_item": self._item()})) == []

    def test_rule_1e_a_custom_item_needs_a_label(self):
        assert self._has(
            dd_doc({"add_item": self._item(label="   ")}), "due_diligence.items[24].label",
            "A custom due diligence item needs a label.",
        )
        assert self._fields(dd_doc({"add_item": self._item(label="Drainage survey")})) == []

    def test_rule_1f_a_category_outside_the_enum_is_a_pydantic_422(self):
        # See the class docstring: DdCategory is a Literal, so this never
        # reaches validate_inputs in Python. The ISSUE arm is tested in TS.
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(category="drainage"))
        assert DdItem.model_validate(self._item(category="construction")).category == "construction"

    def test_rule_1g_a_duplicate_id(self):
        assert self._has(
            dd_doc({"add_item": self._item(id="dd-insurance")}), "due_diligence.items[24].id",
            'Due diligence item id "dd-insurance" is not unique.',
        )
        assert self._fields(dd_doc({"add_item": self._item(id="dd-extra")})) == []

    def test_rule_0_a_status_outside_the_enum_is_a_pydantic_422(self):
        # See the class docstring: DdStatus is a Literal. The ISSUE arm is TS's.
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(status="purple"))
        assert DdItem.model_validate(self._item(status="green")).status == "green"

    # --- rules 2-4: a status and the evidence it owes ----------------------

    def test_rule_2_a_green_status_needs_evidence(self):
        msg = "A green status needs evidence: record the source and the date."
        field_ = "due_diligence.items[4].evidence"   # cil_s106
        assert self._has(dd_doc({"status": {"cil_s106": "green"}}), field_, msg)
        assert self._has(dd_doc({
            "status": {"cil_s106": "green"},
            "evidence": {"cil_s106": {"source": "  ", "reference": "CIL notice", "date": "2026-07-01"}},
        }), field_, msg)
        assert self._has(dd_doc({
            "status": {"cil_s106": "green"},
            "evidence": {"cil_s106": {"source": "City of York Council", "reference": "CIL notice", "date": "  "}},
        }), field_, msg)
        assert self._fields(dd_doc({
            "status": {"cil_s106": "green"},
            "evidence": {"cil_s106": {
                "source": "City of York Council", "reference": "CIL notice", "date": "2026-07-01"}},
        })) == []

    def test_rule_3_a_red_or_amber_status_needs_an_action(self):
        msg = "A red or amber status needs an action."
        field_ = "due_diligence.items[4].action"
        assert self._has(dd_doc({"status": {"cil_s106": "amber"}}), field_, msg)
        assert self._has(dd_doc({"status": {"cil_s106": "red"}}), field_, msg)
        assert self._has(dd_doc({"status": {"cil_s106": "amber"}, "action": {"cil_s106": " "}}), field_, msg)
        assert self._fields(dd_doc({
            "status": {"cil_s106": "amber"}, "action": {"cil_s106": "Request the CIL liability notice"},
        })) == []

    def test_rule_4_a_not_applicable_status_needs_a_reason(self):
        msg = "A not-applicable status needs a reason in notes."
        field_ = "due_diligence.items[4].notes"
        assert self._has(dd_doc({"status": {"cil_s106": "not_applicable"}}), field_, msg)
        assert self._fields(dd_doc({
            "status": {"cil_s106": "not_applicable"}, "notes": {"cil_s106": "Outside the CIL charging area"},
        })) == []

    # --- rule 5: every present date is a real calendar date ----------------

    def test_rule_5_evidence_date(self):
        bad = {"source": "City of York Council", "reference": "26/01234/FUL", "date": "2026-02-31"}
        assert self._has(
            dd_doc({"evidence": {"planning_route": bad}}), "due_diligence.items[0].evidence.date",
            "Evidence date must be a real calendar date in yyyy-mm-dd form.",
        )
        assert self._fields(dd_doc({"evidence": {"planning_route": {**bad, "date": "2026-02-28"}}})) == []

    def test_rule_5_expiry_date(self):
        assert self._has(
            dd_doc({"expiry": {"planning_route": "2026-13-01"}}), "due_diligence.items[0].expiry_date",
            "Expiry date must be a real calendar date in yyyy-mm-dd form.",
        )
        assert self._fields(dd_doc({"expiry": {"planning_route": "2026-12-01"}})) == []
        assert self._fields(dd_doc({"expiry": {"planning_route": None}})) == []

    def test_rule_5_due_date(self):
        assert self._has(
            dd_doc({"add_item": self._item(due_date="2026-02-30")}), "due_diligence.items[24].due_date",
            "Due date must be a real calendar date in yyyy-mm-dd form.",
        )
        assert self._fields(dd_doc({"add_item": self._item(due_date="2026-02-28")})) == []

    def test_rule_5_qs_dates(self):
        assert self._has(
            dd_doc({"qs": {**QS, "date": "2026-02-31"}}), "cost_plan.qs.date",
            "QS date must be a real calendar date in yyyy-mm-dd form.",
        )
        assert self._has(
            dd_doc({"qs": {**QS, "base_date": "01-07-2026"}}), "cost_plan.qs.base_date",
            "QS base date must be a real calendar date in yyyy-mm-dd form.",
        )
        assert self._fields(dd_doc({"qs": dict(QS)})) == []

    # --- rule 6: the impacts -----------------------------------------------

    def test_rule_6_impacts_are_whole_and_non_negative(self):
        # See the class docstring: both fields are `int` with `ge=0`, so these
        # are 422s in Python. The ISSUE arm is tested in TS.
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(cost_impact_pence=-1))
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(cost_impact_pence=1.5))
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(programme_impact_months=-1))
        with pytest.raises(ValidationError):
            DdItem.model_validate(self._item(programme_impact_months=0.5))
        assert self._fields(dd_doc({"impacts": {"cil_s106": (0, 0)}})) == []

    # --- rule 7: the captured listing record -------------------------------

    def test_rule_7_captured_at_is_required(self):
        assert self._has(
            dd_doc({"source_record": self._record(captured_at="   ")}),
            "due_diligence.source_record.captured_at",
            "The captured listing record needs a captured_at timestamp.",
        )
        assert self._fields(dd_doc({"source_record": self._record()})) == []
        assert self._fields(dd_doc({"source_record": None})) == []

    def test_rule_7_numeric_and_enum_arms_are_pydantic_422s(self):
        # See the class docstring. The ISSUE arms are tested in TS.
        with pytest.raises(ValidationError):
            SourceRecord.model_validate(self._record(floor_area_sqm=-1))
        with pytest.raises(ValidationError):
            SourceRecord.model_validate(self._record(lease_years_remaining=-1))
        with pytest.raises(ValidationError):
            SourceRecord.model_validate(self._record(lease_years_remaining=12.5))
        with pytest.raises(ValidationError):
            SourceRecord.model_validate(self._record(tenure="commonhold"))
        assert self._fields(dd_doc({"source_record": self._record(
            floor_area_sqm=0, lease_years_remaining=0, tenure="leasehold")})) == []

    # --- rule 8: QS provenance ---------------------------------------------

    def test_rule_8_qs_provenance_is_detailed_mode_only(self):
        assert self._has(
            dd_doc({"mode": "headline"}), "cost_plan.qs",
            "QS provenance applies to a detailed cost plan only - switch to detailed mode or remove it.",
        )
        assert self._fields(dd_doc({"mode": "headline", "qs": None})) == []

    def test_rule_8_qs_needs_a_source(self):
        assert self._has(
            dd_doc({"qs": {**QS, "source": "  "}}), "cost_plan.qs.source",
            "QS provenance needs a source.",
        )
        assert self._fields(dd_doc({"qs": {**QS, "source": "Gleeds"}})) == []

    def test_rule_8_stage_and_status_enums_are_pydantic_422s(self):
        # See the class docstring. The ISSUE arms are tested in TS.
        with pytest.raises(ValidationError):
            QsProvenance.model_validate({**QS, "stage": "riba_9"})
        with pytest.raises(ValidationError):
            QsProvenance.model_validate({**QS, "status": "superseded"})
        assert self._fields(dd_doc({"qs": {**QS, "stage": "tender", "status": "reviewed"}})) == []

    def test_rule_8_both_qs_dates_must_be_recorded(self):
        """R15 fix wave. Rule 5 reads blank-after-trim as absence, so a QS
        record could print with no date at all. Rule 8 overrides that for its
        own two dates. Twin of validation.test.ts's "rule 8: both QS dates must
        be recorded"."""
        assert self._has(
            dd_doc({"qs": {**QS, "date": "  "}}), "cost_plan.qs.date",
            "QS date must be recorded.",
        )
        assert self._has(
            dd_doc({"qs": {**QS, "base_date": ""}}), "cost_plan.qs.base_date",
            "QS base date must be recorded.",
        )
        assert self._fields(dd_doc({"qs": {**QS, "date": "2026-08-02", "base_date": "2026-07-02"}})) == []

    # --- rule 9: the package price basis ------------------------------------

    def test_rule_9_price_basis_enum_is_a_pydantic_422(self):
        # See the class docstring. The ISSUE arm is tested in TS.
        with pytest.raises(ValidationError):
            CostPackage.model_validate({"id": "pkg-x", "code": "structure", "price_basis": "guess"})
        assert self._fields(dd_doc({"price_basis": {"pkg-mande": "estimate"}})) == []
        assert self._fields(dd_doc({"price_basis": {"pkg-mande": None}})) == []
