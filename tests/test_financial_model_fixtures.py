import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.types import CalculatorInputsV2

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV2.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    for key, expected in doc["expected_metrics"].items():
        actual = getattr(run.metrics, key)
        assert actual == expected, f"{path.stem}.{key}: {actual} != {expected}"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV2.model_validate(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses
