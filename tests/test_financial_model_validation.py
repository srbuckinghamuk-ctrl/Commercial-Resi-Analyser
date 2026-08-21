"""Transliteration of the non-cash equity slice of
frontend/src/lib/model/validation.test.ts (spec Sec 2, C1 -- round-2 review).

Both implementations must agree with the spec, not merely with each other. If
Python disagrees, the Python port is wrong -- never adjust these to make peace.
"""
import pathlib

import pydantic
import pytest

from app.financial_model import run_appraisal
from app.financial_model.areas import DEFAULT_AREA_BRIDGE
from app.financial_model.engine import run_ledger
from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    migrate_inputs_to_v4,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_v2_to_v3,
    migrate_v6_to_v7,
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
    ContingencyClass,
    CostPackage,
    EquitySource,
    FeeLine,
    LenderValuation,
    ProposedUnit,
    ProposedUnitV6,
    RefinanceInputs,
    RetainedUnit,
    UnitMixInputsV6,
    VatOverride,
)
from app.financial_model.validation import reconcile, validate_inputs
from app.financial_model.vat import DEFAULT_VAT, VAT_CHARGE_CATEGORIES, default_vat_treatments


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
