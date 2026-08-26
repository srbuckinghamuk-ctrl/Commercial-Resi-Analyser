"""R15b spec Sec 24.3. The shared cost-plan-in-time document builders. `doc_s()`
loads fixture S (fixtures/financial-model/s-dated-programme.json) via
migrate_inputs_to_v14 -- never a hand-authored dict. `doc_z()` (R15b Task 7)
loads fixture Z (fixtures/financial-model/z-cost-plan-in-time.json) the same
way -- "S plus Z's changes, and no other" (design Sec 13) is now a stored
golden fixture, not a runtime mutation of `doc_s()`'s output; the fixture's
`inputs` was produced by running the pre-Task-7 mutating builder once
(test-cases.md Sec 24.1). `migrate_inputs_to_v14` on an already-v14 document is
a no-op merge, the same discipline every other loader in this module uses.
Twin of frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts, using
this language's own naming convention for the same functions (snake_case
here, camelCase there). Every builder returns a plain dict -- the money-plan
idiom `tests/fixtures_due_diligence.py` and `tests/test_cost_plan.py`'s
`_y_cost_plan_doc` already use -- and `parse()` validates it back into a
CalculatorInputsV14 at the call site."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.financial_model.migrate import migrate_inputs_to_v14
from app.financial_model.types import CalculatorInputsV14, parse_calculator_inputs

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "financial-model"


def parse(doc: dict[str, Any]) -> CalculatorInputsV14:
    parsed = parse_calculator_inputs(doc)
    assert isinstance(parsed, CalculatorInputsV14)
    return parsed


def _load_fixture(stem: str) -> dict[str, Any]:
    raw = json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))["inputs"]
    v14 = migrate_inputs_to_v14(raw, None)
    return v14.model_dump(mode="json")


def doc_s() -> dict[str, Any]:
    return _load_fixture("s-dated-programme")


def doc_z() -> dict[str, Any]:
    """Design Sec 13: S plus Z's changes, and no other (test-cases.md Sec 24.1)."""
    return _load_fixture("z-cost-plan-in-time")


def doc_z_no_allowance() -> dict[str, Any]:
    """Z with the QS provenance kept but the allowance cleared."""
    d = doc_z()
    d["cost_plan"]["qs"] = {**d["cost_plan"]["qs"], "inflation": None}
    return d
