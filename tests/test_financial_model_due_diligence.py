"""R15 spec Sec 23. Twin of due-diligence.test.ts."""
import json

from app.financial_model import run_appraisal
from app.financial_model.due_diligence import (
    DD_CATALOGUE,
    DERIVED_CODES,
    ENTERED_CODES,
    construction_start_month,
    due_diligence_flags,
    months_between,
)
from app.financial_model.schedule import build_schedule
from app.financial_model.types import parse_calculator_inputs

from .fixtures_due_diligence import FIXTURE_DIR, QS, compute, dd_doc, raw_y_as_v12

# The literal table BOTH test files carry (spec Sec 23.2). A relabelled or
# reordered entry fails here and in due-diligence.test.ts alike.
CATALOGUE_TRIPLES = [
    ("planning_route", "planning", "Planning consent or prior approval", False),
    ("planning_conditions", "planning", "Planning conditions", False),
    ("article_4_direction", "planning", "Article 4 direction", False),
    ("conservation_listed", "planning", "Conservation area and listed status", False),
    ("cil_s106", "planning", "CIL and S106 liability", False),
    ("title_report", "title_occupation", "Report on title", False),
    ("vacant_possession", "title_occupation", "Vacant possession", False),
    ("leases_tenancies", "title_occupation", "Occupational leases and tenancies", False),
    ("rights_of_light", "title_occupation", "Rights of light", False),
    ("party_wall", "title_occupation", "Party wall", False),
    ("structural_survey", "existing_building", "Structural survey", False),
    ("asbestos_survey", "existing_building", "Asbestos survey", False),
    ("measured_survey", "existing_building", "Measured survey", False),
    ("higher_risk_building", "existing_building", "Higher-risk building confirmation", False),
    ("fire_strategy", "existing_building", "Fire strategy", False),
    ("acoustic_thermal", "existing_building", "Acoustic and thermal compliance", False),
    ("services_mande", "existing_building", "Services, drainage and utilities", False),
    ("cost_plan_qs", "construction", "QS cost plan", True),
    ("procurement_contractor", "construction", "Procurement and contractor", False),
    ("warranties_building_control", "construction", "Warranty and building control", False),
    ("insurance", "construction", "Insurance", False),
    ("facility_terms", "finance", "Facility terms", True),
    ("equity_sources", "finance", "Equity sources", True),
    ("sponsor_entity", "finance", "Sponsor entity", False),
    ("tax_basis", "finance", "Tax and VAT basis", True),
    ("sales_evidence", "exit", "Sales evidence", False),
    ("lender_valuation", "exit", "Lender valuation", True),
    ("exit_route_evidence", "exit", "Exit route evidence", False),
]


def test_catalogue_is_exactly_the_spec_sec_23_2_table():
    assert [(e.code, e.category, e.label, e.derived) for e in DD_CATALOGUE] == CATALOGUE_TRIPLES
    assert len(DD_CATALOGUE) == 28


def test_entered_and_derived_partition_the_catalogue():
    assert len(ENTERED_CODES) == 23
    assert set(DERIVED_CODES) == {"cost_plan_qs", "facility_terms", "equity_sources", "tax_basis", "lender_valuation"}
    assert set(ENTERED_CODES).isdisjoint(DERIVED_CODES)


# --- Sec 23.3/23.4: the derivation ------------------------------------------

def test_months_between_is_whole_months_floored():
    assert months_between("2026-09-01", "2026-11-01") == 2
    assert months_between("2024-01-31", "2024-02-29") == 0   # leap-day pair: day-of-month not reached
    assert months_between("2024-01-29", "2024-02-29") == 1
    assert months_between("2026-09-01", "2026-08-15") == -1  # a lapse before acquisition is negative


def test_category_counts_match_the_hand_table():
    r = compute(dd_doc())
    assert [(c.category, c.red, c.amber, c.green, c.unknown, c.not_applicable, c.total) for c in r.categories] == [
        ("planning", 0, 1, 3, 1, 0, 5),
        ("title_occupation", 1, 0, 1, 1, 2, 5),
        ("existing_building", 0, 2, 5, 1, 0, 8),
        ("construction", 0, 1, 3, 0, 0, 4),
        ("finance", 0, 0, 3, 1, 0, 4),
        ("exit", 0, 0, 2, 1, 0, 3),
    ]
    t = r.totals
    assert (t.red, t.amber, t.green, t.unknown, t.not_applicable, t.total) == (1, 4, 17, 5, 2, 29)
    assert t.entered_unknown_count == 3
    assert t.addressed_pct == 87.5
    assert t.cost_impact_total_pence == 2_550_000
    assert t.programme_impact_max_months == 3
    assert t.unassessed_impact_count == 1


def test_row_order_is_catalogue_then_custom_and_derived_rows_name_their_source():
    r = compute(dd_doc())
    assert [row.code for row in r.rows][:28] == [e.code for e in DD_CATALOGUE]
    assert r.rows[28].code == "custom" and r.rows[28].kind == "custom" and r.rows[28].label == "Basement water ingress"
    derived = {row.code: row for row in r.rows if row.kind == "derived"}
    assert derived["equity_sources"].status == "unknown" and derived["equity_sources"].source == "equity_sources[].evidence_status"
    assert derived["lender_valuation"].status == "unknown" and derived["lender_valuation"].source == "lender_valuation"
    assert derived["tax_basis"].status == "green" and derived["tax_basis"].source == "acquisition.jurisdiction_evidence_status + vat"
    assert derived["facility_terms"].status == "green" and derived["facility_terms"].source == "finance.requires_confirmation"
    assert derived["cost_plan_qs"].status == "green" and derived["cost_plan_qs"].source == "cost_plan.qs"


def test_not_applicable_counts_as_addressed_but_is_its_own_column():
    r = compute(dd_doc({"status": {"rights_of_light": "unknown"}, "notes": {"rights_of_light": ""}}))
    assert r.totals.entered_unknown_count == 4
    assert r.totals.addressed_pct == 83.33   # pct(20, 24)


def test_impact_totals_sum_assessed_red_amber_only_and_max_months():
    # A green with an impact contributes nothing.
    r = compute(dd_doc({"impacts": {"asbestos_survey": (9_999_999, 9)}}))
    assert r.totals.cost_impact_total_pence == 2_550_000 and r.totals.programme_impact_max_months == 3
    # Assessing structural_survey moves the total and clears the unassessed count.
    r2 = compute(dd_doc({"impacts": {"structural_survey": (100_000, 0)}}))
    assert r2.totals.cost_impact_total_pence == 2_650_000 and r2.totals.unassessed_impact_count == 0


def test_derived_row_mapping_each_status_by_one_field():
    assert next(x for x in compute(dd_doc({"equity_status": "confirmed"})).rows if x.code == "equity_sources").status == "green"
    assert next(x for x in compute(dd_doc({"equity_status": "rejected"})).rows if x.code == "equity_sources").status == "red"
    assert next(x for x in compute(dd_doc({"requires_confirmation": True})).rows if x.code == "facility_terms").status == "unknown"
    lv = {"basis": "global_pct", "global_value": -5, "per_key_values": None, "reason": "Valuer haircut", "author": "Knight Frank", "date": "2026-08-20"}
    assert next(x for x in compute(dd_doc({"lender_valuation": lv})).rows if x.code == "lender_valuation").status == "green"
    assert next(x for x in compute(dd_doc({"qs": {**QS, "status": "draft"}})).rows if x.code == "cost_plan_qs").status == "amber"
    assert next(x for x in compute(dd_doc({"qs": None})).rows if x.code == "cost_plan_qs").status == "unknown"
    assert next(x for x in compute(dd_doc({"mode": "headline"})).rows if x.code == "cost_plan_qs").status == "unknown"
    assert next(x for x in compute(dd_doc({"acquisition_date": None})).rows if x.code == "tax_basis").status == "unknown"


def test_source_conflicts_two_rules_and_their_negatives():
    r = compute(dd_doc())
    assert [c.rule for c in r.source_conflicts] == ["occupation", "existing_area"]
    assert compute(dd_doc({"is_vacant": None})).source_conflicts[0].rule == "existing_area"
    assert [c.rule for c in compute(dd_doc({"status": {"vacant_possession": "amber"}, "action": {"vacant_possession": "Agree surrender"}})).source_conflicts] == ["existing_area"]
    # exactly 25% does not fire (strict): listing 400 vs existing 500
    assert [c.rule for c in compute(dd_doc({"listing_area": 400, "existing_gia": 500})).source_conflicts] == ["occupation"]
    assert compute(dd_doc({"source_record": None})).source_conflicts == []


def test_consent_expiry_against_the_construction_start():
    r = compute(dd_doc())
    assert (r.consent_expiry.expiry_month, r.consent_expiry.construction_start_month, r.consent_expiry.expires_before_start) == (2, 4, True)
    assert compute(dd_doc({"expiry": {"planning_route": "2027-01-01"}})).consent_expiry.expires_before_start is False   # 4 < 4 is false
    assert compute(dd_doc({"acquisition_date": None})).consent_expiry is None
    assert compute(dd_doc({"expiry": {"planning_route": None}})).consent_expiry is None
    assert compute(dd_doc({"programme": None})).consent_expiry.construction_start_month == 0


def test_pre_v13_document_is_read_as_the_seed():
    from app.financial_model.migrate import migrate_inputs_to_v12
    v12 = migrate_inputs_to_v12(raw_y_as_v12(), None)
    r = compute(v12)
    assert r.totals.entered_unknown_count == 23 and r.source_record is None and r.source_conflicts == []


# --- Fix round 1: the three arms the fixed test list above did not reach -----

#: Registered, with construction rated 20% and its treatments row left
#: `unconfirmed` (fixture Y's default) -- the minimal VAT setting that makes a
#: charge line BEAR VAT on an unevidenced basis, so vat_basis_confirmed is
#: False. Fixture Y itself rates every category 0%, so the tax_basis row's VAT
#: half is otherwise indistinguishable from a constant True.
VAT_BEARING_UNCONFIRMED = {
    "registered": True, "treatment_patch": {"construction": {"rate_pct": 20}},
}


def test_tax_basis_goes_unknown_through_the_vat_half_alone():
    def tax_basis(doc):
        return next(x for x in compute(doc).rows if x.code == "tax_basis")

    unconfirmed = tax_basis(dd_doc({"vat": VAT_BEARING_UNCONFIRMED}))
    assert unconfirmed.status == "unknown"
    # The jurisdiction half is untouched on both arms, so confirming the SAME
    # bearing row's evidence -- and nothing else -- restores green. Without
    # this, `registered: True` alone could be what moved the row.
    confirmed = tax_basis(dd_doc({"vat": {
        **VAT_BEARING_UNCONFIRMED,
        "treatment_patch": {"construction": {"rate_pct": 20, "evidence_status": "confirmed"}},
    }}))
    assert confirmed.status == "green"


def test_flag_table_on_fixture_y_is_exactly_five_flags():
    doc = dd_doc()
    run = run_appraisal(doc)
    flags = due_diligence_flags(compute(doc), run.metrics.cost_plan)
    assert [(f.code, f.severity, f.month, f.amount_pence, f.message) for f in flags] == [
        ("due_diligence_unknown", "amber", None, None,
         "due diligence: 3 of 24 entered items unknown - unknown is never treated as green"),
        ("source_conflict", "red", None, None,
         "source conflict: the listing records the property as occupied; vacant possession is "
         "marked green - evidence the surrender or correct the status"),
        ("source_conflict", "red", None, None,
         "source conflict: the listing floor area and the entered existing GIA differ by more "
         "than 25%"),
        ("consent_expires_before_start", "red", 2, None,
         "planning consent lapses at month 2, before construction starts at month 4"),
        ("provisional_sums_present", "amber", None, 8_000_000,
         "provisional sums are present in the cost plan: 8000000p"),
    ]


def test_the_seed_twin_raises_the_unknown_flag_and_nothing_else():
    """No source record, no consent expiry and no price basis, so four of the
    five arms above must fall silent rather than fire on absent data."""
    doc = dd_doc({"seed": True})
    run = run_appraisal(doc)
    flags = due_diligence_flags(compute(doc), run.metrics.cost_plan)
    assert [(f.code, f.severity, f.month, f.amount_pence, f.message) for f in flags] == [
        ("due_diligence_unknown", "amber", None, None,
         "due diligence: 23 of 23 entered items unknown - unknown is never treated as green"),
    ]


def test_construction_start_reads_the_legacy_packages_arm():
    """Fixture H is the R3a explicit-programme document: its `programme` carries
    `packages`, not `phases`, so it is the only route into
    construction_start_month's legacy branch.

    It is parsed NATIVELY, not migrated: migrate_v8_to_v9 converts the legacy
    three-package block into a precedence network, so a migrated H would take
    the network arm and leave this branch as unreachable as it was before this
    test. Parsing natively is exactly how test_golden_fixture_parity runs the
    pre-v9 corpus, and it is the shape the legacy arm exists to serve.

    1 is H's own `packages.construction.start_offset`, written as a literal --
    and its professional (2) and statutory (4) offsets differ, so reading the
    wrong package fails here rather than passing by coincidence."""
    doc = parse_calculator_inputs(
        json.loads((FIXTURE_DIR / "h-programme-scurve.json").read_text(encoding="utf-8"))["inputs"],
    )
    assert not hasattr(doc.programme, "phases")
    assert construction_start_month(doc, build_schedule(doc)) == 1
