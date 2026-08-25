"""R13b spec Sec 22. Every builder starts from fixture X
(fixtures/financial-model/x-unit-sales-ledger.json) via migrate_inputs_to_v12,
never a hand-authored dict, so the tests and the golden corpus share one
document. Overrides are a snake_case dict, the fixtures_investment_case idiom.
Twin of frontend/src/lib/model/__fixtures__/unit-sales-docs.ts."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable

from app.financial_model.migrate import migrate_inputs_to_v12
from app.financial_model.programme import derive_phases
from app.financial_model.schedule import unit_ancillary_value_pence
from app.financial_model.types import CalculatorInputsV12, PhaseAnchor

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _raw_x() -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / "x-unit-sales-ledger.json").read_text(encoding="utf-8"))["inputs"]


def _fixed(month: int) -> dict[str, Any]:
    return {"month_offset": month, "anchor": None}


def unit_sales_doc(overrides: dict[str, Any] | None = None) -> CalculatorInputsV12:
    """Fixture X, optionally altered. Keys:
    deposit_release: 'held_to_completion' | 'released_on_exchange'
    programme: None  -- drops the network; anchored events become the fixed
                        months they resolve to on X (u1 8/12, u2 13, u3 13)
    pc_early: True   -- construction duration 5 (PC at 9, unit_completions 9-11)
    residue_case: True -- three 10,000,000 units, scheme legal 100, agent 0,
                        rows all-null overrides, fixed completions 12/13/14
    unit_sales: None -- drop the block (the null path)
    sales_phasing_too: True -- ALSO set a single final-month tranche (rule 1 control)
    route: str       -- exit route
    exit_fee_pct: float -- finance.exit_fee_pct override (fee-free twins isolate
                        the phased replay's timing effect from its fee-reservation
                        conservatism, spec Sec 5.11)
    drop_row: str    -- remove the row for that unit id
    extra_row: str   -- add a second row copying u4's for that unit id
    rows: list[dict] -- replace unit_sales.units wholesale (raw dicts)
    """
    o = dict(overrides or {})
    raw = _raw_x()
    if o.get("residue_case"):
        raw["unit_mix"]["units"] = [
            {**raw["unit_mix"]["units"][1], "id": f"r{i}", "estimated_value_pence": 10_000_000}
            for i in (1, 2, 3)
        ]
        raw["exit_strategy"]["selling_agent_fee_pct"] = 0
        raw["exit_strategy"]["selling_legal_fee_pence"] = 100
        raw["unit_sales"]["units"] = [
            {"unit_id": f"r{i}", "exchange": None, "completion": _fixed(11 + i),
             "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": None}
            for i in (1, 2, 3)
        ]
    if "deposit_release" in o:
        raw["unit_sales"]["deposit_release"] = o["deposit_release"]
    if o.get("pc_early"):
        for p in raw["programme"]["phases"]:
            if p["id"] == "construction":
                p["duration_months"] = 5
    if "programme" in o and o["programme"] is None:
        raw["programme"] = None
        rows = raw["unit_sales"]["units"]
        rows[0]["exchange"] = _fixed(8)
        rows[0]["completion"] = _fixed(12)
        rows[1]["completion"] = _fixed(13)
        rows[2]["completion"] = _fixed(13)
    if "route" in o:
        raw["exit_strategy"]["route"] = o["route"]
    if "exit_fee_pct" in o:
        raw["finance"]["exit_fee_pct"] = o["exit_fee_pct"]
    if "rows" in o:
        raw["unit_sales"]["units"] = copy.deepcopy(o["rows"])
    if "drop_row" in o:
        raw["unit_sales"]["units"] = [r for r in raw["unit_sales"]["units"] if r["unit_id"] != o["drop_row"]]
    if "extra_row" in o:
        raw["unit_sales"]["units"].append({**copy.deepcopy(raw["unit_sales"]["units"][-1]), "unit_id": o["extra_row"]})
    if o.get("sales_phasing_too"):
        raw["sales_phasing"] = {"tranches": [{"month_offset": 23, "pct_of_gross_receipts": 100, "anchor": None}]}
    if "unit_sales" in o and o["unit_sales"] is None:
        raw["unit_sales"] = None
    return migrate_inputs_to_v12(raw, None)


def held_twin_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"deposit_release": "held_to_completion"})


def no_programme_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"programme": None})


def pc_early_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"pc_early": True})


def residue_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"residue_case": True})


def sold_gross(doc: CalculatorInputsV12) -> list[tuple[str, int]]:
    """The (unit_id, gross) pairs schedule.py hands compute_unit_sales, in
    unit_mix order, for a sell_all document."""
    return [(u.id, u.estimated_value_pence + unit_ancillary_value_pence(u)) for u in doc.unit_mix.units]


def anchor_resolver(doc: CalculatorInputsV12) -> Callable[[PhaseAnchor | None, int], int]:
    """Test-only stand-in for schedule.py's closure (same rule: derived start +
    offset; None or unresolvable -> month_offset)."""
    derivation = derive_phases(doc.programme) if doc.programme is not None and hasattr(doc.programme, "phases") else None

    def resolve(anchor: PhaseAnchor | None, month_offset: int) -> int:
        if anchor is None or derivation is None or derivation.cycle is not None:
            return month_offset
        dp = derivation.by_id.get(anchor.phase_id)
        return dp.start_month + anchor.offset_months if dp is not None else month_offset

    return resolve
