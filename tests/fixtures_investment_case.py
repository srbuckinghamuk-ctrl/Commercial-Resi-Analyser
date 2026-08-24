"""R13 spec Sec 19, Task 5b (moved to v11 by R14 Task 14, the entry-point
cutover): the shared test-document builders every downstream task consumes,
in this engine. Mirror of
frontend/src/lib/model/__fixtures__/investment-case-docs.ts, using this
language's own naming convention for the same functions (snake_case here,
camelCase there -- the same per-language split every migrate_inputs_to_vN /
migrateInputsToVN pair in this repo already uses).

Every builder is built from a fixture JSON file (or another builder) via
migrate_inputs_to_v11 -- never a hand-authored default dict -- so a fixture
and a builder can never disagree about what a valid v11 document looks like.

SCOPE NOTE (read before hand-deriving pins against these documents):
ic_doc / investment_case_doc / explicit_refinance_doc / anchored_slipped_doc
are exercised by tests/test_fixtures_investment_case.py and their numbers are
hand-derived and verified (see the JSON fixtures' own notes, and this file's
inline comments for anchored_slipped_doc). The NOI/ledger family below them
(noi_doc, retain_all_noi_doc, blended_doc, mixed_noi_doc,
all_four_in_one_month_doc, noi_redeems_doc) are built to be VALID, structurally
correct documents that exercise their named concept -- verified to validate
cleanly and run without error -- but their exact monthly economics are NOT
tuned to any downstream task's plan-text pinned figures. Tasks 9-11 must
hand-derive their own expected numbers against what these builders actually
produce.

memo_text has NO Python counterpart: this codebase's investment-memo PDF
generator (frontend/src/lib/export-investment-memo.ts, generateInvestmentMemo)
exists only in TypeScript -- there is no app/financial_model memo module for
a Python wrapper to call. Task 16 ("The memo's investment-case section")
modifies only export-investment-memo.ts, confirming this is a TS-only
surface. Deliberately omitted here rather than stubbed, per the standing
instruction against inventing behaviour that does not exist.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Literal

from app.financial_model import engine
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.engine import MonthlyModel
from app.financial_model.migrate import migrate_inputs_to_v11
from app.financial_model.schedule import build_schedule
from app.financial_model.types import (
    CalculatorInputsV11,
    InvestmentCaseInputs,
    OperatingLine,
    PhaseAnchor,
    RetainedUnit,
    ScenarioOverrides,
    StabilisationInputs,
    TakeoutInputs,
    ValuationInputs,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"

SensitivityLever = Literal[
    "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    "exit_yield", "operating_cost", "vacancy",
]


def _load_fixture_inputs(stem: str) -> dict[str, Any]:
    doc = json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))
    return doc["inputs"]


# --- icDoc / investmentCaseDoc -------------------------------------------

_FOUR_LINES = [
    {"id": "l1", "code": "management", "label": "Management fee",
     "basis": "pct_of_gross_rent", "value": 10},
    {"id": "l2", "code": "letting_and_re_letting", "label": "Letting and re-letting",
     "basis": "pct_of_gross_rent", "value": 2},
    {"id": "l3", "code": "insurance", "label": "Buildings insurance",
     "basis": "fixed_pence_per_month", "value": 25_000},
    {"id": "l4", "code": "compliance_and_safety", "label": "Compliance and safety",
     "basis": "fixed_pence_per_month", "value": 8_000},
]

_TAKEOUT = {
    "ltv_cap_pct": 65, "dscr_floor": 1.3, "icr_floor": 1.3,
    "annual_rate_pct": 6, "amortisation_years": 25, "term_years": 5,
}


def ic_doc(overrides: dict[str, Any] | None = None) -> CalculatorInputsV11:
    """A valid retain-all v11 document with an investment case (built from
    fixtures/financial-model/t-investment-case.json -- DSCR binds, hand-
    derived there). ``overrides`` applies zero or more single, named
    deviations -- the same key set investment-case-docs.ts's IcDocOverrides
    documents, snake_cased: route, refinance, investment_case, explicit_value,
    arrangement_fee_pct, drop_retained_unit, add_retained_unit_id,
    all_rents_zero, anchor_phase_id, stabilisation_month, ramp_months,
    term_months, occupancy_pct, cap_yield_pct, purchasers_costs_pct,
    ltv_cap_pct, dscr_floor, icr_floor, annual_rate_pct, amortisation_years,
    term_years, lines, duplicate_line_ids, pct_line_value, blank_line_id,
    invalid_line_code, opex_heavy, opex_exceeds_rent, ltv_binds,
    takeout_shortfall, sales_sweep_pct.
    """
    doc = migrate_inputs_to_v11(_load_fixture_inputs("t-investment-case"))
    return _apply_ic_doc_overrides(doc, overrides or {})


investment_case_doc = ic_doc


def _apply_ic_doc_overrides(
    doc: CalculatorInputsV11, o: dict[str, Any],
) -> CalculatorInputsV11:
    next_doc = doc.model_copy(deep=True)

    if "route" in o:
        next_doc.exit_strategy.route = o["route"]
    if "refinance" in o:
        next_doc.refinance = None
    if "investment_case" in o:
        next_doc.investment_case = None
    if "explicit_value" in o and next_doc.refinance is not None:
        next_doc.refinance.investment_value_pence = o["explicit_value"]
    if "arrangement_fee_pct" in o and next_doc.refinance is not None:
        next_doc.refinance.arrangement_fee_pct = o["arrangement_fee_pct"]
    if "drop_retained_unit" in o:
        next_doc.exit_strategy.retained_units = [
            r for r in next_doc.exit_strategy.retained_units if r.unit_id != o["drop_retained_unit"]
        ]
    if "add_retained_unit_id" in o:
        next_doc.exit_strategy.retained_units.append(
            RetainedUnit(unit_id=o["add_retained_unit_id"], monthly_rent_pence=1_000_00),
        )
    if o.get("all_rents_zero"):
        for r in next_doc.exit_strategy.retained_units:
            r.monthly_rent_pence = 0
    if "sales_sweep_pct" in o:
        next_doc.finance.sales_sweep_pct = o["sales_sweep_pct"]
    if "term_months" in o:
        next_doc.finance.term_months = o["term_months"]

    ic = next_doc.investment_case
    if ic is not None:
        if "anchor_phase_id" in o:
            offset = ic.stabilisation.anchor.offset_months if ic.stabilisation.anchor else 0
            ic.stabilisation.anchor = PhaseAnchor(phase_id=o["anchor_phase_id"], offset_months=offset)
        # A stabilisation_month override means "use this explicit month
        # instead of the anchor" -- ONE coherent deviation (anchored ->
        # explicit), not two independent field writes. See the matching TS
        # comment in investment-case-docs.ts for the full reasoning.
        if "stabilisation_month" in o:
            ic.stabilisation.anchor = None
            ic.stabilisation.month_offset = o["stabilisation_month"]
        if "ramp_months" in o:
            ic.stabilisation.ramp_months = o["ramp_months"]
        if "occupancy_pct" in o:
            ic.stabilisation.stabilised_occupancy_pct = o["occupancy_pct"]
        if "cap_yield_pct" in o:
            ic.valuation.cap_yield_pct = o["cap_yield_pct"]
        # R13 Task 7: the five keys below (purchasers_costs_pct, annual_rate_pct,
        # term_years, blank_line_id, invalid_line_code) were missing from this
        # builder -- investment-case-docs.ts's IcDocOverrides already documents
        # them, but this Python port (Task 5b) predates the TS fix round that
        # exercises them (Task 6). Added here, mirroring the TS arms exactly,
        # because Sec 19.7 rules 9 and 10's own out-of-range/accepting-twin
        # tests and rule 11's two remaining branches need them and the brief
        # for this task says "do not hand-author documents".
        if "purchasers_costs_pct" in o:
            ic.valuation.purchasers_costs_pct = o["purchasers_costs_pct"]
        if "ltv_cap_pct" in o:
            ic.takeout.ltv_cap_pct = o["ltv_cap_pct"]
        if "dscr_floor" in o:
            ic.takeout.dscr_floor = o["dscr_floor"]
        if "icr_floor" in o:
            ic.takeout.icr_floor = o["icr_floor"]
        if "annual_rate_pct" in o:
            ic.takeout.annual_rate_pct = o["annual_rate_pct"]
        if "amortisation_years" in o:
            ic.takeout.amortisation_years = o["amortisation_years"]
        if "term_years" in o:
            ic.takeout.term_years = o["term_years"]
        if "lines" in o:
            ic.operating_lines = list(o["lines"])
        # Sec 19.7 rule 11's blank-id arm -- 'l1's id blanked, everything else
        # untouched (parallel to duplicate_line_ids's single deviation).
        if o.get("blank_line_id") and len(ic.operating_lines) >= 1:
            ic.operating_lines[0].id = ""
        # Sec 19.7 rule 11's OPEX_CODES membership arm -- 'l1's code set to a
        # string no OpexCode names. Assigned directly (bypassing the Literal
        # type, exactly as the TS builder casts at the write site) precisely
        # to construct the malformed-at-runtime document validation must
        # defend against.
        if o.get("invalid_line_code") and len(ic.operating_lines) >= 1:
            ic.operating_lines[0].code = "not_a_real_code"  # type: ignore[assignment]
        if o.get("duplicate_line_ids") and len(ic.operating_lines) >= 2:
            ic.operating_lines[1].id = ic.operating_lines[0].id
        # 'l1' is ic_doc()'s management line -- see the matching TS comment.
        if "pct_line_value" in o:
            for line in ic.operating_lines:
                if line.id == "l1":
                    line.value = o["pct_line_value"]
        if o.get("opex_heavy"):
            for line in ic.operating_lines:
                line.value = line.value * 5
        if o.get("opex_exceeds_rent"):
            for line in ic.operating_lines:
                if line.id == "l3":
                    line.value = 500_000
        # The EXACT pair u-investment-case-ltv-binds.json uses.
        if o.get("ltv_binds"):
            ic.valuation.cap_yield_pct = 7.5
            ic.takeout.ltv_cap_pct = 55
        if o.get("takeout_shortfall"):
            ic.takeout.ltv_cap_pct = 1
            ic.takeout.dscr_floor = 100
            ic.takeout.icr_floor = 100

    return next_doc


def explicit_refinance_doc() -> CalculatorInputsV11:
    """``investment_case: None``, an explicit ``investment_value_pence`` of
    5,000,000.00 and ``ltv_pct`` 60 -- the calc 2.11.0 path that must stay
    bit-identical."""
    doc = ic_doc({"investment_case": None})
    assert doc.refinance is not None
    doc.refinance.investment_value_pence = 5_000_000_00
    doc.refinance.ltv_pct = 60
    doc.refinance.arrangement_fee_pence = 30_000_00
    doc.refinance.arrangement_fee_basis = "fixed_pence"
    doc.refinance.arrangement_fee_pct = 0
    doc.refinance.legal_costs_pence = 20_000_00
    return doc


def anchored_slipped_doc() -> CalculatorInputsV11:
    """A programme network with a slipped phase, one sale tranche anchored to
    resolve to month 14, a second tranche and the refinance both anchored to
    resolve to month 18. See investment-case-docs.ts's anchored_slipped_doc
    for the full hand-derived forward pass -- identical here, both engines
    must agree."""
    raw = _load_fixture_inputs("j-blended-refinance")
    doc: dict[str, Any] = copy.deepcopy(raw)
    doc["inputs_version"] = 10
    doc["investment_case"] = None
    doc["acquisition"].update({
        "jurisdiction": "england_ni", "jurisdiction_source": "user",
        "jurisdiction_evidence_status": "confirmed", "acquisition_date": "2026-08-01",
        "acquisition_tax_override_pence": None, "acquisition_tax_override_reason": "",
    })
    doc["areas"] = {
        "basis": "manual", "existing_gia_sqm": 0, "demolished_gia_sqm": 0, "extension_gia_sqm": 0,
        "retained_commercial_gia_sqm": 0, "untouched_gia_sqm": 0, "circulation_common_sqm": 0,
        "plant_riser_sqm": 0, "store_bin_cycle_sqm": 0, "amenity_sqm": 0, "external_amenity_sqm": 0,
    }
    doc["cost_plan"] = {
        "mode": "headline", "packages": [],
        "contingency": [
            {"name": "general", "pct": 10}, {"name": "existing_building", "pct": 0}, {"name": "abnormal", "pct": 0},
        ],
        "fee_lines": [
            {"id": "fee-architect", "code": "architect", "category": "professional", "label": "Architect", "basis": "fixed", "amount_pence": 1_500_000, "pct": 0, "per_dwelling": False, "vat_override": None, "phase_id": None},
            {"id": "fee-structural", "code": "structural_engineer", "category": "professional", "label": "Structural engineer", "basis": "fixed", "amount_pence": 500_000, "pct": 0, "per_dwelling": False, "vat_override": None, "phase_id": None},
            {"id": "fee-mande", "code": "mande", "category": "professional", "label": "M&E", "basis": "fixed", "amount_pence": 500_000, "pct": 0, "per_dwelling": False, "vat_override": None, "phase_id": None},
            {"id": "fee-planning", "code": "planning_consultant", "category": "professional", "label": "Planning consultant", "basis": "fixed", "amount_pence": 300_000, "pct": 0, "per_dwelling": False, "vat_override": None, "phase_id": None},
            {"id": "fee-prior-approval", "code": "prior_approval", "category": "statutory", "label": "Prior approval fee", "basis": "fixed", "amount_pence": 9_600, "pct": 0, "per_dwelling": True, "vat_override": None, "phase_id": None},
        ],
    }
    doc["vat"] = {
        "registered": False, "return_frequency": "quarterly", "first_period_end_month": 2, "repayment_lag_months": 1,
        "treatments": [
            {"category": c, "rate_pct": 0, "recoverable_pct": 0, "recovery_basis": "unconfirmed",
             "evidence_status": "unconfirmed", "notes": ""}
            for c in ("acquisition", "construction", "professional", "statutory", "selling", "lender_ancillary")
        ],
        "purchase": {"vendor_opted_to_tax": False, "togc_treatment": "unconfirmed", "evidence_status": "unconfirmed", "notes": ""},
    }
    doc["finance"]["term_months"] = 22
    doc["programme"] = {
        "anchor_month": "2026-08",
        "phases": [
            {"id": "acquisition", "code": "acquisition", "label": "Acquisition", "duration_months": 1, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": []},
            {"id": "construction", "code": "construction", "label": "Main construction", "duration_months": 6, "slip_months": 2, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "acquisition", "type": "FS", "lag_months": 0}]},
            {"id": "practical_completion", "code": "practical_completion", "label": "Practical completion", "duration_months": 0, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "construction", "type": "FS", "lag_months": 0}]},
            {"id": "unit_completions", "code": "unit_completions", "label": "Unit completions", "duration_months": 2, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "practical_completion", "type": "FS", "lag_months": 0}]},
            {"id": "sales", "code": "sales", "label": "Sales run-off", "duration_months": 3, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "unit_completions", "type": "FS", "lag_months": 0}]},
            {"id": "maturity_tail", "code": "maturity_tail", "label": "Maturity", "duration_months": 0, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "sales", "type": "FS", "lag_months": 0}]},
        ],
        "category_phase_ids": {"construction": "construction", "professional": "acquisition", "statutory": "acquisition"},
    }
    doc["sales_phasing"] = {
        "tranches": [
            {"month_offset": 12, "pct_of_gross_receipts": 60, "anchor": {"phase_id": "sales", "offset_months": 3}},
            {"month_offset": 15, "pct_of_gross_receipts": 40, "anchor": {"phase_id": "maturity_tail", "offset_months": 4}},
        ],
    }
    doc["refinance"] = {
        "month_offset": 16, "investment_value_pence": 30_000_000, "ltv_pct": 65,
        "arrangement_fee_pence": 300_000, "legal_costs_pence": 100_000,
        "anchor": {"phase_id": "maturity_tail", "offset_months": 4},
        "arrangement_fee_basis": "fixed_pence", "arrangement_fee_pct": 0,
    }
    return migrate_inputs_to_v11(doc)


# --- The NOI / ledger family -----------------------------------------------
#
# Unlike ic_doc()'s base (cash-funded), the ledger tests these feed need a
# real development facility. See investment-case-docs.ts's matching section
# header for the full reasoning; _facility_noi_base is the shared building
# block.

def _facility_noi_base() -> CalculatorInputsV11:
    doc = anchored_slipped_doc()
    doc.finance.term_months = 24
    doc.programme = None
    doc.sales_phasing = None
    doc.refinance = None
    doc.exit_strategy.route = "blended"
    doc.exit_strategy.retained_units = [RetainedUnit(unit_id="u4", monthly_rent_pence=150_000)]
    doc.investment_case = InvestmentCaseInputs(
        stabilisation=StabilisationInputs(anchor=None, month_offset=1, ramp_months=1, stabilised_occupancy_pct=96),
        operating_lines=[OperatingLine(**line) for line in _FOUR_LINES],
        valuation=ValuationInputs(cap_yield_pct=5.5, purchasers_costs_pct=6.75),
        takeout=TakeoutInputs(**_TAKEOUT),
    )
    return doc


def noi_doc(overrides: dict[str, Any] | None = None) -> CalculatorInputsV11:
    """A facility-funded document whose investment case is already stabilised
    by month 4 (see _facility_noi_base), so mid-term ledger months carry full
    NOI. ``overrides`` reuses ic_doc's override contract."""
    return _apply_ic_doc_overrides(_facility_noi_base(), overrides or {})


def retain_all_noi_doc() -> CalculatorInputsV11:
    """The retain-all variant of the NOI base: every unit retained, still
    facility-funded."""
    doc = _facility_noi_base()
    doc.exit_strategy.route = "retain_all"
    doc.exit_strategy.retained_units = [
        RetainedUnit(unit_id=u.id, monthly_rent_pence=150_000) for u in doc.unit_mix.units
    ]
    return doc


def blended_doc(rents: Literal["market", "zero"]) -> CalculatorInputsV11:
    """The blended exit itself: ``rents='market'`` keeps the retained unit's
    rent at _facility_noi_base's figure; ``rents='zero'`` zeroes it."""
    doc = _facility_noi_base()
    for r in doc.exit_strategy.retained_units:
        if rents == "zero":
            r.monthly_rent_pence = 0
    return doc


def mixed_noi_doc() -> CalculatorInputsV11:
    """Named separately from blended_doc because the reconciliation tests
    read it under its own name; the document is the market-rent blended
    case."""
    return blended_doc("market")


def all_four_in_one_month_doc() -> CalculatorInputsV11:
    """VAT reclaim, NOI, a sale and a refinance all converging in month 6 of a
    12-month term. See investment-case-docs.ts's matching docstring for the
    full verification note -- built and checked identically here."""
    raw = _load_fixture_inputs("r-vat-quarterly")
    doc: dict[str, Any] = copy.deepcopy(raw)
    doc["inputs_version"] = 10
    doc["programme"] = None
    doc["finance"]["term_months"] = 12
    doc["exit_strategy"] = {
        **doc["exit_strategy"], "route": "blended",
        "retained_units": [{"unit_id": "u3", "monthly_rent_pence": 200_000}],
    }
    doc["sales_phasing"] = {"tranches": [{"month_offset": 6, "pct_of_gross_receipts": 100, "anchor": None}]}
    doc["refinance"] = {
        "month_offset": 6, "investment_value_pence": None, "ltv_pct": None,
        "arrangement_fee_pence": 0, "legal_costs_pence": 50_000, "anchor": None,
        "arrangement_fee_basis": "pct_of_quantum", "arrangement_fee_pct": 1.5,
    }
    doc["investment_case"] = {
        "stabilisation": {"anchor": None, "month_offset": 1, "ramp_months": 1, "stabilised_occupancy_pct": 96},
        "operating_lines": _FOUR_LINES,
        "valuation": {"cap_yield_pct": 5.5, "purchasers_costs_pct": 6.75},
        "takeout": _TAKEOUT,
    }
    return migrate_inputs_to_v11(doc)


def noi_redeems_doc() -> CalculatorInputsV11:
    """A compact, dedicated retain-all document with a SMALL facility relative
    to its NOI, so cumulative NOI alone can plausibly clear the balance within
    the term once Task 9 wires NOI into the ledger's repayment path. See
    investment-case-docs.ts's matching docstring for the full reasoning."""
    doc: dict[str, Any] = {
        "inputs_version": 10, "project_id": None,
        "acquisition": {
            "purchase_price_pence": 3_000_000, "legal_fees_pence": 50_000, "survey_cost_pence": 30_000,
            "broker_fee_pct": 1.0, "other_acquisition_costs_pence": 0,
            "jurisdiction": "england_ni", "jurisdiction_source": "user", "jurisdiction_evidence_status": "confirmed",
            "acquisition_date": "2026-08-01", "acquisition_tax_override_pence": None, "acquisition_tax_override_reason": "",
        },
        "areas": {
            "basis": "manual", "existing_gia_sqm": 0, "demolished_gia_sqm": 0, "extension_gia_sqm": 0,
            "retained_commercial_gia_sqm": 0, "untouched_gia_sqm": 0, "circulation_common_sqm": 0,
            "plant_riser_sqm": 0, "store_bin_cycle_sqm": 0, "amenity_sqm": 0, "external_amenity_sqm": 0,
        },
        "unit_mix": {"units": [
            {"id": f"u{i}", "type": "1bed", "floor_area_sqm": 40, "estimated_value_pence": 1_000_000, "comparable_notes": "",
             "ancillary": {"balcony_terrace_sqm": 0, "balcony_terrace_value_pence": 0, "parking_spaces": 0, "parking_value_pence": 0}}
            for i in range(1, 4)
        ]},
        "conversion_costs": {
            "prior_approval_fee_per_dwelling_pence": 0, "cil_s106_pence": 0, "architect_pence": 0,
            "structural_engineer_pence": 0, "mande_pence": 0, "planning_consultant_pence": 0,
            "building_control_pence": 0, "other_professional_fees_pence": 0,
            "construction_cost_per_sqm_pence": 30_000, "total_construction_sqm": 120, "contingency_pct": 0,
            "fire_safety_pence": 0, "sound_insulation_pence": 0, "part_l_compliance_pence": 0,
        },
        "cost_plan": {
            "mode": "headline", "packages": [],
            "contingency": [{"name": "general", "pct": 10}, {"name": "existing_building", "pct": 0}, {"name": "abnormal", "pct": 0}],
            "fee_lines": [],
        },
        "programme": None,
        "vat": {
            "registered": False, "return_frequency": "quarterly", "first_period_end_month": 2, "repayment_lag_months": 1,
            "treatments": [
                {"category": c, "rate_pct": 0, "recoverable_pct": 0, "recovery_basis": "unconfirmed",
                 "evidence_status": "unconfirmed", "notes": ""}
                for c in ("acquisition", "construction", "professional", "statutory", "selling", "lender_ancillary")
            ],
            "purchase": {"vendor_opted_to_tax": False, "togc_treatment": "unconfirmed", "evidence_status": "unconfirmed", "notes": ""},
        },
        "finance": {
            "funding_source": "development_finance", "day_one_advance_pence": 0, "day_one_market_value_pence": None,
            "development_cost_advance_pct": 100, "committed_net_facility_pence": 8_000_000,
            "committed_gross_facility_pence": 8_800_000, "annual_interest_rate_pct": 8.0, "interest_type": "rolled_up",
            "arrangement_fee_pct": 2.0, "arrangement_fee_basis": "committed_net_facility", "exit_fee_pct": 1.0,
            "exit_fee_basis": "committed_gross_facility", "broker_fee_pence": 0, "lender_legal_fee_pence": 0,
            "valuation_fee_pence": 0, "monitoring_surveyor_fee_pence": 0, "interest_reserve_pence": None,
            "term_months": 36, "equity_draw_rule": "equity_first", "sales_sweep_pct": 100,
            "legacy_leverage_pct": None, "requires_confirmation": False, "enforcement_cost_assumption_pence": 0,
        },
        "equity_sources": [{"id": "e1", "classification": "cash", "amount_pence": 1_000_000, "timing_month": 0,
                             "repayment_priority": 1, "evidence_status": "confirmed", "notes": ""}],
        "exit_strategy": {
            "route": "retain_all", "selling_agent_fee_pct": 1.5, "selling_legal_fee_pence": 0,
            "retained_units": [{"unit_id": f"u{i}", "monthly_rent_pence": 150_000} for i in range(1, 4)],
        },
        "sales_phasing": None,
        "refinance": None,
        "investment_case": {
            "stabilisation": {"anchor": None, "month_offset": 1, "ramp_months": 1, "stabilised_occupancy_pct": 96},
            "operating_lines": _FOUR_LINES,
            "valuation": {"cap_yield_pct": 5.5, "purchasers_costs_pct": 6.75},
            "takeout": _TAKEOUT,
        },
        "risks": [],
        "scenarios": {
            "base": {"label": "Base Case", "gdv_adjustment_pct": 0, "construction_cost_adjustment_pct": 0, "timeline_adjustment_months": 0, "interest_rate_adjustment_pct": 0, "phase_slip_phase_id": None, "phase_slip_months": 0},
            "upside": {"label": "Upside", "gdv_adjustment_pct": 10, "construction_cost_adjustment_pct": -5, "timeline_adjustment_months": -2, "interest_rate_adjustment_pct": 0, "phase_slip_phase_id": None, "phase_slip_months": 0},
            "downside": {"label": "Downside", "gdv_adjustment_pct": -10, "construction_cost_adjustment_pct": 15, "timeline_adjustment_months": 3, "interest_rate_adjustment_pct": 1, "phase_slip_phase_id": None, "phase_slip_months": 0},
            "severe": {"label": "Severe", "gdv_adjustment_pct": -15, "construction_cost_adjustment_pct": 20, "timeline_adjustment_months": 6, "interest_rate_adjustment_pct": 2, "phase_slip_phase_id": None, "phase_slip_months": 0},
        },
        "deal_spider": {
            "storeys": 2, "building_height_m": 7, "bsa_higher_risk": False, "daylight_pass_pct": 100,
            "absorption_months": 6, "exit_sell": False, "exit_refinance": False, "exit_hold": True,
            "exit_part_sale": False, "prior_approval_window_months": 2, "programme_contingency_months": 1,
            "cil_offset_pence": 0, "target_profit_on_cost_pct": 20, "weights": {},
        },
        "lender_valuation": None,
    }
    return migrate_inputs_to_v11(doc)


def retain_all_doc_missing_rents() -> CalculatorInputsV11:
    """A retain-all document with a rent MISSING for one unit (Sec 19.7 rule
    2's silent-understatement trap) -- Task 15's editor test uses this
    directly."""
    return ic_doc({"drop_retained_unit": "u2"})


# --- Thin plumbing wrappers -------------------------------------------------

def run_ledger(doc: CalculatorInputsV11) -> MonthlyModel:
    """Runs the ledger for a document -- a thin wrapper over build_schedule +
    engine.run_ledger, so no later task re-derives this two-call plumbing
    itself."""
    schedule = build_schedule(doc)
    return engine.run_ledger(schedule, doc.finance, doc.equity_sources)


_ZERO_OVERRIDES = {
    "label": "apply_levers_in_order", "gdv_adjustment_pct": 0, "construction_cost_adjustment_pct": 0,
    "timeline_adjustment_months": 0, "interest_rate_adjustment_pct": 0,
    "phase_slip_phase_id": None, "phase_slip_months": 0,
}

_LEVER_FIELD: dict[str, str] = {
    "gdv": "gdv_adjustment_pct",
    "construction_cost": "construction_cost_adjustment_pct",
    "timeline": "timeline_adjustment_months",
    "interest_rate": "interest_rate_adjustment_pct",
    # R13 spec Sec 19.8. Task 13 extended this table with its own three levers.
    "exit_yield": "exit_yield_adjustment_pct",
    "operating_cost": "operating_cost_adjustment_pct",
    "vacancy": "vacancy_adjustment_pct",
}


def apply_levers_in_order(
    doc: CalculatorInputsV11, lever_names: list[SensitivityLever],
) -> CalculatorInputsV11:
    """Applies a named sequence of sensitivity levers to a document, one
    apply_scenario call per lever, folding left to right. Mirrors
    investment-case-docs.ts's apply_levers_in_order."""
    acc = doc
    for lever in lever_names:
        if lever == "phase_slip":
            phase_id = acc.programme.phases[0].id if acc.programme is not None and acc.programme.phases else None
            overrides = ScenarioOverrides(**{
                **_ZERO_OVERRIDES,
                "phase_slip_phase_id": phase_id,
                "phase_slip_months": 0 if phase_id is None else 1,
            })
        else:
            field = _LEVER_FIELD[lever]
            overrides = ScenarioOverrides(**{**_ZERO_OVERRIDES, field: 5})
        acc = apply_scenario(acc, overrides)
    return acc
