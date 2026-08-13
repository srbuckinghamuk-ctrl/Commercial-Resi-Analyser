import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.engine import exit_fee_amount
from app.financial_model.metrics import pct
from app.financial_model.migrate import migrate_inputs
from app.financial_model.types import CalculatorInputsV3

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


# Minimal flat-key -> nested-summary mapping for the two cost-to-complete fixture keys
# (spec Sec 5.10, Release 2b Task 6). They are not real AppraisalResultV2 attributes --
# a fixture-authoring convenience mapped onto the nested `cost_to_complete` summary. Every
# other expected_metrics key is a real, direct AppraisalResultV2 attribute via getattr below.
_COST_TO_COMPLETE_FLAT_KEYS = {
    "cost_to_complete_first_shortfall_month": lambda s: s.first_shortfall_month if s else None,
    "cost_to_complete_max_shortfall_pence": lambda s: s.max_shortfall_pence if s else None,
}


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    for key, expected in doc["expected_metrics"].items():
        mapper = _COST_TO_COMPLETE_FLAT_KEYS.get(key)
        actual = mapper(run.metrics.cost_to_complete) if mapper else getattr(run.metrics, key)
        assert actual == expected, f"{path.stem}.{key}: {actual} != {expected}"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses


def _invariant_variants(inputs: CalculatorInputsV3) -> list[tuple[str, CalculatorInputsV3]]:
    """Mirrors invariants.test.ts's `variants()`: four derived transformations of each
    fixture, widening coverage without new hand calcs. Each variant is deep-copied off
    the base `inputs` so mutating one never leaks into another (or into the base)."""
    retained = inputs.model_copy(deep=True)
    retained.exit_strategy.route = "retain_all"
    serviced = inputs.model_copy(deep=True)
    serviced.finance.interest_type = "serviced"
    short_term = inputs.model_copy(deep=True)
    short_term.finance.term_months = 1
    return [
        ("base", inputs),
        ("retain_all", retained),
        ("serviced", serviced),
        ("term=1", short_term),
    ]


def _fixture_variant_matrix() -> list[tuple[str, str, CalculatorInputsV3]]:
    out: list[tuple[str, str, CalculatorInputsV3]] = []
    for path in FIXTURES:
        doc = json.loads(path.read_text())
        base_inputs = CalculatorInputsV3.model_validate(doc["inputs"])
        for label, variant_inputs in _invariant_variants(base_inputs):
            out.append((path.stem, label, variant_inputs))
    return out


_FIXTURE_VARIANTS = _fixture_variant_matrix()
_FIXTURE_VARIANT_IDS = [f"{stem}[{label}]" for stem, label, _ in _FIXTURE_VARIANTS]


@pytest.mark.parametrize("stem,label,inputs", _FIXTURE_VARIANTS, ids=_FIXTURE_VARIANT_IDS)
class TestInvariantMatrix:
    """Python port of frontend/src/lib/model/invariants.test.ts's top `describe` block
    (spec Sec 4/Sec 8 roll-forward invariant, Sec 5.7 peak debt, Sec 3.9/Sec 9 zero-debt
    cost, Sec 4.4 retained exits, Sec 6 schedule spreads, Sec 3.12/Sec 7 profit identity,
    Sec 7 TDC identity): every golden fixture run through the same 4 derived variants
    (base/retain_all/serviced/term=1) TS exercises, giving the same widened coverage on
    the Python side. Closes the gap recorded in docs/financial-model/test-cases.md Sec 4
    and Sec 7. Each TS `it()` in that describe block has a one-to-one Python method
    below (same order), rather than one flat function, so a single invariant's failure
    doesn't mask the others -- the same diagnostic granularity as the TS suite."""

    def test_debt_rollforward_reconciles_and_closing_balance_never_negative(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        for m in run.model.months:
            assert m.closing_balance_pence == (
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence - m.repayment_pence
            )
            assert m.closing_balance_pence >= 0

    def test_peak_debt_equals_the_maximum_monthly_pre_repayment_balance(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        max_balance = max(
            [0] + [
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence
                for m in run.model.months
            ]
        )
        assert run.model.peak_debt_pence == max_balance

    def test_cash_funding_produces_zero_debt_cost(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.finance.funding_source == "cash":
            assert run.metrics.finance_costs_pence == 0
            assert run.model.totals.draws_pence == 0

    def test_retained_exits_receive_no_sale_proceeds(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.exit_strategy.route == "retain_all":
            assert all(m.gross_receipts_pence == 0 for m in run.model.months)
            assert run.metrics.selling_costs_pence == 0

    def test_monthly_schedule_spreads_sum_exactly_to_cost_totals(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        assert (
            sum(m.construction_pence for m in run.schedule.uses)
            == run.schedule.totals.construction_pence
        )
        assert (
            sum(m.professional_pence for m in run.schedule.uses)
            == run.schedule.totals.professional_pence
        )
        assert (
            sum(m.statutory_pence for m in run.schedule.uses)
            == run.schedule.totals.statutory_pence
        )

    def test_profit_equals_equity_flows_and_sources_equal_uses_when_fully_realised(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        run = run_appraisal(inputs)
        fully_realised = (
            run.model.senior_outstanding_at_maturity_pence == 0
            and run.schedule.totals.retained_value_pence == 0
            and run.model.totals.funding_gap_pence == 0
        )
        if fully_realised:
            assert run.metrics.profit_pence == sum(run.model.equity_cashflows_pence)
            assert run.reconciliation.sources_equal_uses is True

    def test_tdc_equals_the_sum_of_all_monthly_uses_plus_rolled_interest_capitalised_fees_and_exit_fee(
        self, stem: str, label: str, inputs: CalculatorInputsV3,
    ) -> None:
        # Task 6 correction (spec Sec 7): monthly uses_total_pence includes month-0
        # ancillary fees but NOT the capitalised arrangement fee, while TDC (from
        # metrics) does include it -- so the identity needs an explicit
        # + capitalised_fees_pence term.
        run = run_appraisal(inputs)
        monthly_uses = sum(m.uses_total_pence for m in run.model.months)
        rolled = sum(m.interest_capitalised_pence for m in run.model.months)
        serviced = sum(m.interest_serviced_pence for m in run.model.months)
        assert run.metrics.total_development_cost_pence == (
            monthly_uses + rolled + serviced + run.metrics.selling_costs_pence
            + run.model.totals.exit_fee_pence + run.model.totals.capitalised_fees_pence
        )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_lender_gdv_never_defaults_to_developer_gdv(path: Path) -> None:
    """Spec Sec 3.2 / Release 2b Task 3: lender-basis metrics must never default
    to developer GDV -- null is the only representation of "unknown", exactly
    when the block itself is absent, on every fixture."""
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    block_present = inputs.lender_valuation is not None
    assert (run.metrics.lender_gdv_pence is None) == (not block_present)
    if block_present:
        # Recomputed here (not just re-asserted against the pinned fixture value)
        # so this catches a regression where ltgdv_lender_pct is wired to
        # developer GDV instead of lender GDV.
        assert run.metrics.ltgdv_lender_pct == pct(
            run.model.peak_debt_pence, run.metrics.lender_gdv_pence
        )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 4 (spec Sec 5.11): senior_breakeven_pence is null exactly when
    the ledger recorded no disposal (cash deals, or nothing sold)."""
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    assert (run.metrics.senior_breakeven_pence is None) == (
        run.model.redemption_balance_at_disposal_pence is None
    )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_covers_redemption_plus_exit_fee(path: Path) -> None:
    """When non-null, senior_breakeven_pence >= redemption balance + exit fee due on
    redeeming it (spec Sec 5.11 invariant)."""
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    redemption = run.model.redemption_balance_at_disposal_pence
    if redemption is not None and run.metrics.senior_breakeven_pence is not None:
        exit_fee = exit_fee_amount(
            inputs.finance, run.model.committed_gross_facility_pence, run.model.peak_debt_pence,
            redemption,
        )
        assert run.metrics.senior_breakeven_pence >= redemption + exit_fee


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_percentages_null_unless_lender_gdv_present(path: Path) -> None:
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    lender_gdv_present = run.metrics.lender_gdv_pence is not None
    if run.metrics.senior_breakeven_pence is None or not lender_gdv_present:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None
    else:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is not None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is not None
        total = (
            run.metrics.senior_breakeven_pct_of_lender_gdv
            + run.metrics.senior_breakeven_fall_from_lender_gdv_pct
        )
        assert round(total, 2) == 100.0


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 5 (spec Sec 5.12): developer_breakeven_pence is null exactly when
    the schedule recorded no disposal at all (gross_sales_pence == 0) -- a strictly wider
    condition than senior_breakeven_pence's redemption-balance guard, since it does not
    depend on a facility existing."""
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    assert (run.metrics.developer_breakeven_pence is None) == (
        run.schedule.totals.gross_sales_pence == 0
    )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_covers_tdc_ex_selling_plus_legal(path: Path) -> None:
    """When non-null, developer_breakeven_pence >= TDC-ex-selling + the flat selling
    legal fee (spec Sec 5.12 invariant -- the fixed-cost floor before the agent's
    percentage fee on P itself)."""
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    if run.metrics.developer_breakeven_pence is not None:
        tdc_ex_selling = run.metrics.total_development_cost_pence - run.metrics.selling_costs_pence
        assert run.metrics.developer_breakeven_pence >= (
            tdc_ex_selling + inputs.exit_strategy.selling_legal_fee_pence
        )


def test_developer_breakeven_non_null_for_cash_fixture_a() -> None:
    """Debt-independence: fixture A is a cash deal with no facility (senior_breakeven_pence
    is null for it), but it still sold every unit, so developer_breakeven_pence must be
    non-null."""
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.developer_breakeven_pence is not None


def test_developer_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 5 (spec Sec 5.12): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one developer_breakeven_unsolvable red
    flag on the model, with the exact spec-mandated message -- mirroring Task 4's
    senior_breakeven_unsolvable flag."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.schedule.totals.gross_sales_pence > 0
    assert run.metrics.developer_breakeven_pence is None
    flags = [f for f in run.model.flags if f.code == "developer_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_senior_breakeven_all_null_for_cash_fixture_a() -> None:
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
    assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None


def test_senior_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 4 (spec Sec 5.11): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one senior_breakeven_unsolvable red
    flag on the model, with the exact spec-mandated message."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.model.redemption_balance_at_disposal_pence is not None
    assert run.metrics.senior_breakeven_pence is None
    flags = [f for f in run.model.flags if f.code == "senior_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_migration_preserves_floors_zero() -> None:
    """conversion-defaults.ts:162 uses `project?.floors ?? DEFAULT_DEAL_SPIDER.storeys`
    -- nullish coalescing, which only falls through on None/absent. A Python port
    using `or` instead of a None-check would wrongly replace a genuine `floors: 0`
    (e.g. a single-storey unit) with the default storeys (2), and cascade into a
    non-zero building_height_m. Both must come out as exactly 0."""
    project = {"id": "p1", "price_pence": 0, "floor_area_sqm": 0, "floors": 0}
    run = migrate_inputs({}, project)
    assert run.deal_spider.storeys == 0
    assert run.deal_spider.building_height_m == 0
