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


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV3.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    for key, expected in doc["expected_metrics"].items():
        actual = getattr(run.metrics, key)
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


def test_senior_breakeven_all_null_for_cash_fixture_a() -> None:
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(CalculatorInputsV3.model_validate(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
    assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None


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
