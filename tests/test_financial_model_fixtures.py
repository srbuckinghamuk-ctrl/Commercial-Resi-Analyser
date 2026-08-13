import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import migrate_inputs
from app.financial_model.types import CalculatorInputsV2, CalculatorInputsV3

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


def _v3_fixture_to_engine_v2(raw: dict) -> CalculatorInputsV2:
    """The golden fixtures are stored as v3 documents (calc 2.1.0, Task 2).
    Validate the full v3 shape first (proves the fixture is well-formed v3),
    then adapt to the v2 shape the engine still consumes -- `lender_valuation`
    isn't wired into the engine yet (Task 1: null-wired result fields only;
    Task 3+ wires the block itself), so dropping it here changes nothing
    about the computed metrics (design Sec B1: outputs unchanged while the
    block is absent). Mirrors app/api/app.py::calculate_authoritative."""
    v3 = CalculatorInputsV3.model_validate(raw)
    engine_dict = v3.model_dump(mode="json")
    engine_dict.pop("lender_valuation", None)
    engine_dict["inputs_version"] = 2
    return CalculatorInputsV2.model_validate(engine_dict)


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = json.loads(path.read_text())
    inputs = _v3_fixture_to_engine_v2(doc["inputs"])
    run = run_appraisal(inputs)
    for key, expected in doc["expected_metrics"].items():
        actual = getattr(run.metrics, key)
        assert actual == expected, f"{path.stem}.{key}: {actual} != {expected}"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = json.loads(path.read_text())
    run = run_appraisal(_v3_fixture_to_engine_v2(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses


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
