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
)
from app.financial_model.schedule import build_schedule
from app.financial_model.types import (
    AreaBridgeInputs,
    CalculatorInputsV2,
    CalculatorInputsV3,
    CalculatorInputsV4,
    CalculatorInputsV6,
    EquitySource,
    LenderValuation,
    ProposedUnit,
    ProposedUnitV6,
    RefinanceInputs,
    UnitMixInputsV6,
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
) -> CalculatorInputsV6:
    """R9 (Task 8). A structurally-valid v6 document built off the migration
    chain's own defaults -- the Python twin of validation.test.ts's
    makeV6Inputs. Only `areas`/`units`/`conversion_costs` are accepted since
    that is all the area-bridge suite needs."""
    v6 = migrate_inputs_to_v6({"inputs_version": 1})
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
