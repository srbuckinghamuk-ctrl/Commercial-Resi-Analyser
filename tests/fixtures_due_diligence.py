"""R15 spec Sec 23. Every builder starts from fixture Y
(fixtures/financial-model/y-due-diligence.json) via migrate_inputs_to_v13,
never a hand-authored dict, so the tests and the golden corpus share one
document. Overrides are a snake_case dict, the fixtures_unit_sales idiom.
Twin of frontend/src/lib/model/__fixtures__/due-diligence-docs.ts."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from app.financial_model import run_appraisal
from app.financial_model.due_diligence import DueDiligenceResult, compute_due_diligence, seed_items
from app.financial_model.migrate import migrate_inputs_to_v13
from app.financial_model.schedule import Schedule, build_schedule
from app.financial_model.types import CalculatorInputsV13

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"

#: Fixture Y's QS provenance record, exported so a test can vary ONE of its
#: fields (`{**QS, "status": "draft"}`) rather than restate the block.
QS: dict[str, Any] = {
    "source": "Gardiner & Theobald", "stage": "riba_3", "date": "2026-08-01",
    "status": "issued", "base_date": "2026-07-01",
}


def _raw_y() -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / "y-due-diligence.json").read_text(encoding="utf-8"))["inputs"]


def raw_y_as_v12() -> dict[str, Any]:
    """Fixture Y's inputs as a genuine v12 document: the three Sec 23 additions
    (`due_diligence`, `cost_plan.qs`, every package's `price_basis`) deleted and
    the version stamped back to 12. Not a v13 document with keys blanked -- a
    document the v12 schema itself accepts, which is what the pre-v13 read path
    actually receives."""
    raw = _raw_y()
    del raw["due_diligence"]
    del raw["cost_plan"]["qs"]
    for package in raw["cost_plan"]["packages"]:
        del package["price_basis"]
    raw["inputs_version"] = 12
    return raw


def _seed_raw_items() -> list[dict[str, Any]]:
    return [item.model_dump(mode="json") for item in seed_items()]


def dd_doc(overrides: dict[str, Any] | None = None) -> CalculatorInputsV13:
    """Fixture Y, optionally altered. Every key is a SINGLE named deviation.
    Keys:
    status: {code: status}      -- sets those items' statuses (a status change
                                   ALONE; the caller supplies evidence/action/
                                   notes via the keys below when a rule needs them)
    evidence: {code: {source, reference, date} | None}
    action: {code: str}
    notes: {code: str}
    expiry: {code: str | None}  -- the item's expiry_date
    impacts: {code: (cost_pence | None, months | None)}
    source_record: None | dict  -- replaces the captured listing record
    is_vacant: bool | None      -- sets that one field on the record
    listing_area: float | None  -- the record's floor_area_sqm
    existing_gia: float         -- areas.existing_gia_sqm
    equity_status: str          -- e1's evidence_status
    lender_valuation: dict      -- the lender_valuation block
    requires_confirmation: bool -- finance.requires_confirmation
    qs: None | dict             -- cost_plan.qs
    price_basis: {package_id: str | None}
    mode: 'headline'            -- headline mode AND no packages, as the Costs
                                   page's own mode switch leaves the document
    drop_item: code             -- removes that catalogue item
    dup_item: code              -- appends a copy of that item (a duplicate code)
    add_item: dict              -- appends a raw item
    items: list                 -- replaces due_diligence.items wholesale
    acquisition_date: str | None
    programme: None             -- drops the network, so the construction start
                                   falls to 0 under Sec 6
    seed: True                  -- replaces `items` with the migration seed and
                                   clears source_record, qs and every
                                   price_basis: the money-inertness twin
    """
    o = dict(overrides or {})
    raw = _raw_y()
    dd = raw["due_diligence"]

    if o.get("seed"):
        dd["items"] = _seed_raw_items()
        dd["source_record"] = None
        raw["cost_plan"]["qs"] = None
        for package in raw["cost_plan"]["packages"]:
            package["price_basis"] = None
    if "items" in o:
        dd["items"] = copy.deepcopy(o["items"])

    by_code = {item["code"]: item for item in dd["items"]}
    for code, status in (o.get("status") or {}).items():
        by_code[code]["status"] = status
    for code, evidence in (o.get("evidence") or {}).items():
        by_code[code]["evidence"] = copy.deepcopy(evidence)
    for code, action in (o.get("action") or {}).items():
        by_code[code]["action"] = action
    for code, notes in (o.get("notes") or {}).items():
        by_code[code]["notes"] = notes
    for code, expiry in (o.get("expiry") or {}).items():
        by_code[code]["expiry_date"] = expiry
    for code, (cost, months) in (o.get("impacts") or {}).items():
        by_code[code]["cost_impact_pence"] = cost
        by_code[code]["programme_impact_months"] = months

    if "drop_item" in o:
        dd["items"] = [item for item in dd["items"] if item["code"] != o["drop_item"]]
    if "dup_item" in o:
        dd["items"].append(copy.deepcopy(by_code[o["dup_item"]]))
    if "add_item" in o:
        dd["items"].append(copy.deepcopy(o["add_item"]))

    if "source_record" in o:
        dd["source_record"] = copy.deepcopy(o["source_record"])
    if "is_vacant" in o and dd["source_record"] is not None:
        dd["source_record"]["is_vacant"] = o["is_vacant"]
    if "listing_area" in o and dd["source_record"] is not None:
        dd["source_record"]["floor_area_sqm"] = o["listing_area"]

    if "existing_gia" in o:
        raw["areas"]["existing_gia_sqm"] = o["existing_gia"]
    if "equity_status" in o:
        raw["equity_sources"][0]["evidence_status"] = o["equity_status"]
    if "lender_valuation" in o:
        raw["lender_valuation"] = copy.deepcopy(o["lender_valuation"])
    if "requires_confirmation" in o:
        raw["finance"]["requires_confirmation"] = o["requires_confirmation"]

    if "qs" in o:
        raw["cost_plan"]["qs"] = copy.deepcopy(o["qs"])
    for package_id, basis in (o.get("price_basis") or {}).items():
        for package in raw["cost_plan"]["packages"]:
            if package["id"] == package_id:
                package["price_basis"] = basis
    if o.get("mode") == "headline":
        raw["cost_plan"]["mode"] = "headline"
        raw["cost_plan"]["packages"] = []

    if "acquisition_date" in o:
        raw["acquisition"]["acquisition_date"] = o["acquisition_date"]
    if "programme" in o and o["programme"] is None:
        raw["programme"] = None

    return migrate_inputs_to_v13(raw, None)


def schedule_for(doc: Any) -> Schedule:
    return build_schedule(doc)


def compute(doc: Any) -> DueDiligenceResult:
    """The derivation as the engine will call it (Task 5): every argument comes
    off ONE run of the appraisal, so the cost plan, the VAT result and the
    acquisition tax the schedule is built from are the very ones the rows read.
    Re-deriving any of them here would let the fixture drift from the run."""
    run = run_appraisal(doc)
    return compute_due_diligence(
        doc, run.metrics.cost_plan, run.schedule.vat, run.metrics.acquisition_tax, run.schedule,
    )
