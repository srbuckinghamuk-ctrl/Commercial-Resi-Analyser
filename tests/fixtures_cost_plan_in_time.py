"""R15b spec Sec 24.3. The shared cost-plan-in-time document builders. `doc_s()`
loads fixture S (fixtures/financial-model/s-dated-programme.json) via
migrate_inputs_to_v14 -- never a hand-authored dict. `doc_z()` is "S plus Z's
changes, and no other" (design Sec 13): a QS provenance record with a
tender-price inflation allowance, a new `mande_fitout` phase carrying
pkg-mande's spend, per-package price basis tags, a VAT override on
pkg-externals, an extra pct-of-construction-total fee line, and VAT
registration switched on. Twin of
frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts, using this
language's own naming convention for the same functions (snake_case here,
camelCase there). Every builder returns a plain dict -- the money-plan idiom
`tests/fixtures_due_diligence.py` and `tests/test_cost_plan.py`'s
`_y_cost_plan_doc` already use -- and `parse()` validates it back into a
CalculatorInputsV14 at the call site.

R15b Task 6 moved this module onto `migrate_inputs_to_v14` (spec Sec 24.8's
entry-point cutover); Task 7 loads Z directly from its own fixture file
rather than building it here by mutation."""
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


def doc_s() -> dict[str, Any]:
    raw = json.loads((FIXTURE_DIR / "s-dated-programme.json").read_text(encoding="utf-8"))["inputs"]
    v14 = migrate_inputs_to_v14(raw, None)
    return v14.model_dump(mode="json")


def doc_z() -> dict[str, Any]:
    """Design Sec 13: S plus Z's changes, and no other."""
    d = doc_s()
    d["cost_plan"]["qs"] = {
        "source": "Gleeds", "stage": "riba_3", "date": "2026-02-15", "status": "issued",
        "base_date": "2026-02-01", "inflation": {"annual_pct": 6},
    }
    d["programme"]["phases"].append({
        "id": "mande_fitout", "code": "other", "label": "M&E fit-out", "duration_months": 3,
        "slip_months": 0, "start_offset": 0, "curve": {"kind": "back_loaded"},
        "predecessors": [{"phase_id": "construction", "type": "SS", "lag_months": 3}],
    })
    basis = {
        "pkg-enabling": "fixed_price", "pkg-structure": "fixed_price", "pkg-envelope": "fixed_price",
        "pkg-mande": "estimate", "pkg-externals": "provisional_sum",
    }
    for p in d["cost_plan"]["packages"]:
        p["price_basis"] = basis[p["id"]]
        if p["id"] == "pkg-mande":
            p["phase_id"] = "mande_fitout"
        if p["id"] == "pkg-externals":
            p["vat_override"] = {"rate_pct": 20, "recoverable_pct": 0, "recovery_basis": "blocked"}
    d["cost_plan"]["fee_lines"].append({
        "id": "fee-pm", "code": "other_professional", "category": "professional", "label": "Project manager",
        "basis": "pct_of_construction_total", "amount_pence": 0, "pct": 1, "per_dwelling": False,
        "vat_override": None, "phase_id": None,
    })
    d["vat"]["registered"] = True
    return d


def doc_z_no_allowance() -> dict[str, Any]:
    """Z with the QS provenance kept but the allowance cleared."""
    d = doc_z()
    d["cost_plan"]["qs"] = {**d["cost_plan"]["qs"], "inflation": None}
    return d
