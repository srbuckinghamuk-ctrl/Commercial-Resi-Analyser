"""R15 spec Sec 23. Twin of due-diligence.test.ts."""
import json
from dataclasses import asdict

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

from .fixtures_cost_plan_in_time import doc_z, doc_z_no_allowance, parse
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
    # Task 8 fix round 1 (I1/I2): the counts the report prints, published on the
    # block. entered_total counts the 23 catalogue rows plus the custom row;
    # assessed_count is red + amber; stated_impact_count is the subset of those
    # whose cost the total above actually sums (structural_survey states
    # neither impact, so it is excluded); derived_unknown_count is
    # equity_sources + lender_valuation.
    assert (t.entered_total, t.assessed_count, t.stated_impact_count, t.derived_unknown_count) == (24, 5, 4, 2)
    # Task 9 fix round 1: the numerator addressed_pct is taken over and the
    # count the Due Diligence page's coverage line prints -- 24 entered rows
    # less the three unknown ones (cil_s106, leases_tenancies, fire_strategy).
    assert t.entered_addressed_count == 21


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
    # ... and moves stated_impact_count with it: the count follows the SUM's own
    # membership, not the assessed count (5 assessed, now all 5 stated).
    assert (r2.totals.assessed_count, r2.totals.stated_impact_count) == (5, 5)


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


def test_flag_table_on_fixture_y_is_exactly_six_flags():
    # R15b spec Sec 24.7 adds a sixth: fixture Y's QS record has no inflation
    # key at all (fixtures/financial-model/y-due-diligence.json), so
    # no_inflation_allowance fires alongside R15's original five.
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
        ("no_inflation_allowance", "amber", 7, None,
         "no tender-price inflation allowance recorded: priced at 2026-07-01; package spend "
         "midpoints fall up to 9 whole months later"),
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


# --- Sec 23.8/23.9: the schedule on the result, and the four flags ----------

#: The four R15 flag codes (spec Sec 23.9), so a test that filters `metrics.flags`
#: down to this release's own additions does not have to restate them inline.
R15_FLAG_CODES = {
    "due_diligence_unknown", "source_conflict", "consent_expires_before_start",
    "provisional_sums_present",
}


def test_result_is_published_on_metrics_and_flags_fire():
    """Sec 23.8: derive_metrics computes the schedule ONCE and publishes it, and
    Sec 23.9's four flag codes reach `metrics.flags` -- not merely
    `due_diligence_flags`, which Task 3 already covered in isolation."""
    metrics = run_appraisal(dd_doc()).metrics
    assert metrics.due_diligence.totals.entered_unknown_count == 3
    r15 = [f for f in metrics.flags if f.code in R15_FLAG_CODES]
    assert [f.code for f in r15] == [
        "due_diligence_unknown", "source_conflict", "source_conflict",
        "consent_expires_before_start", "provisional_sums_present",
    ]
    provisional = next(f for f in r15 if f.code == "provisional_sums_present")
    assert provisional.amount_pence == 8_000_000
    consent = next(f for f in r15 if f.code == "consent_expires_before_start")
    assert consent.month == 2


class TestNoInflationAllowanceFlag:
    """R15b spec Sec 24.7. `no_inflation_allowance` -- a QS record with no
    allowance, a known calendar and at least one package spend midpoint
    falling after the base date. Twin of due-diligence.test.ts's
    '§24.7 no_inflation_allowance flag'."""

    @staticmethod
    def _flags(doc):
        run = run_appraisal(doc)
        return due_diligence_flags(compute(doc), run.metrics.cost_plan)

    def test_z_with_the_allowance_cleared_fires(self):
        doc = parse(doc_z_no_allowance())
        flag = next(f for f in self._flags(doc) if f.code == "no_inflation_allowance")
        assert (flag.severity, flag.month, flag.amount_pence) == ("amber", 12, None)
        assert flag.message == (
            "no tender-price inflation allowance recorded: priced at 2026-02-01; package "
            "spend midpoints fall up to 18 whole months later"
        )

    def test_z_with_the_allowance_in_place_fires_nothing(self):
        doc = parse(doc_z())
        assert not any(f.code == "no_inflation_allowance" for f in self._flags(doc))

    def test_fixture_y_no_inflation_key_at_all_fires(self):
        doc = dd_doc()
        flag = next(f for f in self._flags(doc) if f.code == "no_inflation_allowance")
        assert (flag.severity, flag.month, flag.amount_pence) == ("amber", 7, None)
        assert flag.message == (
            "no tender-price inflation allowance recorded: priced at 2026-07-01; package "
            "spend midpoints fall up to 9 whole months later"
        )

    def test_a_y_twin_with_the_base_date_moved_after_every_midpoint_does_not_fire(self):
        doc = dd_doc({"qs": {**QS, "base_date": "2028-01-01"}})
        assert not any(f.code == "no_inflation_allowance" for f in self._flags(doc))

    def test_acquisition_date_none_twin_does_not_fire(self):
        doc = dd_doc({"acquisition_date": None})
        assert not any(f.code == "no_inflation_allowance" for f in self._flags(doc))

    def test_boundary_exactly_0_does_not_fire_just_over_fires_with_0_whole_months(self):
        # Z-no-allowance's latest midpoint is 12.333... months from
        # acquisition. base_date = acquisition + 13 months clamps
        # months_from_base to exactly 0 (compute_cost_plan's own floor) -- no
        # fire. base_date = acquisition + 12 months leaves 0.333... months,
        # whole-floored to 0 -- fires, printing "0 whole months".
        exactly_zero = doc_z_no_allowance()
        exactly_zero["cost_plan"]["qs"]["base_date"] = "2027-09-01"   # acquisition (2026-08-01) + 13 months
        assert not any(f.code == "no_inflation_allowance" for f in self._flags(parse(exactly_zero)))

        just_over = doc_z_no_allowance()
        just_over["cost_plan"]["qs"]["base_date"] = "2027-08-01"   # acquisition + 12 months
        flag = next(f for f in self._flags(parse(just_over)) if f.code == "no_inflation_allowance")
        assert flag.month == 12
        assert flag.message == (
            "no tender-price inflation allowance recorded: priced at 2027-08-01; package "
            "spend midpoints fall up to 0 whole months later"
        )


def test_money_is_inert():
    """Sec 23.8: the evidence layer is DISCLOSURE, not cost. Fixture Y against
    its seed twin -- which strips the source record, every entered status, the
    QS record and every price basis -- must move no figure at all, so the whole
    monthly model is compared and not just the five headline totals."""
    evidenced = run_appraisal(dd_doc())
    seeded = run_appraisal(dd_doc({"seed": True}))
    for name in (
        "gdv_pence", "total_development_cost_pence", "profit_pence",
        "peak_debt_pence", "finance_costs_pence",
    ):
        assert getattr(evidenced.metrics, name) == getattr(seeded.metrics, name), name
    assert asdict(evidenced.model) == asdict(seeded.model)


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


def test_a_blank_expiry_is_absence_not_a_date():
    """R15 fix wave (I1). Validation reads a blank-after-trim date as ABSENCE
    (`_is_unreal_date`, Sec 23.9 rule 5), so a whitespace-only `expiry_date`
    raises no error and must not reach months_between -- which would split
    "  " and raise ValueError on the appraisal's HTTP path. Twin of
    due-diligence.test.ts's "a blank expiry is absence, not a date"."""
    doc = dd_doc({"expiry": {"planning_route": "  "}})
    assert compute(doc).consent_expiry is None
    run = run_appraisal(doc)                       # raises nothing
    assert "consent_expires_before_start" not in {f.code for f in run.metrics.flags}


def test_consent_flag_moves_under_the_phase_slip_lever():
    """R15 fix wave (I2). Sec 23.9: the schedule is Sec 12.2-invariant, but
    `consent_expires_before_start` is NOT invariant across sensitivity cells --
    it compares the lapse month against `construction_start_month`, which the
    `phase_slip` lever moves. Fixture Y's construction phase is `construction`
    and resolves to month 4; an expiry of 2027-02-01 is month 5, so the base
    clears it and a three-month slip does not. Twin of due-diligence.test.ts's
    "the consent flag moves under the phase_slip lever"."""
    from app.financial_model.apply_scenario import apply_scenario
    from app.financial_model.types import ScenarioOverrides

    base = dd_doc({"expiry": {"planning_route": "2027-02-01"}})
    assert compute(base).consent_expiry.expiry_month == 5
    assert compute(base).consent_expiry.construction_start_month == 4
    assert "consent_expires_before_start" not in {f.code for f in run_appraisal(base).metrics.flags}

    slipped = apply_scenario(base, ScenarioOverrides(
        label="", gdv_adjustment_pct=0.0, construction_cost_adjustment_pct=0.0,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0.0,
        phase_slip_phase_id="construction", phase_slip_months=3,
    ))
    slipped_consent = compute(slipped).consent_expiry
    assert (slipped_consent.construction_start_month, slipped_consent.expires_before_start) == (7, True)
    assert "consent_expires_before_start" in {f.code for f in run_appraisal(slipped).metrics.flags}
