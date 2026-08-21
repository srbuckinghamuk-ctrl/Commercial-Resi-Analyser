"""R11 spec §17. Python mirror of frontend/src/lib/model/vat.test.ts.

Same five resolver cases, same four chargeability cases, same two
default-shape cases -- against resolve_vat_treatment, is_purchase_vat_chargeable,
DEFAULT_VAT, default_vat_treatments and VAT_CHARGE_CATEGORIES imported from
app.financial_model.vat. VatInputs is a pydantic model, so variants are built
with model_copy(update=...) rather than object spread."""
from app.financial_model.areas import developed_area_sqm
from app.financial_model.cost_plan import compute_cost_plan
from app.financial_model.migrate import migrate_inputs_to_v7
from app.financial_model.schedule import build_schedule
from app.financial_model.types import (
    CalculatorInputsV8,
    PurchaseVatInputs,
    VatOverride,
    default_contingency_classes,
)
from app.financial_model.vat import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    compute_vat,
    default_vat_treatments,
    is_purchase_vat_chargeable,
    resolve_vat_treatment,
    spread_pro_rata,
    vat_return_periods,
)


def _registered_vat():
    treatments = default_vat_treatments()
    updated = []
    for t in treatments:
        if t.category == "construction":
            updated.append(t.model_copy(update={
                "rate_pct": 5, "recoverable_pct": 100, "recovery_basis": "zero_rated_sale",
            }))
        else:
            updated.append(t)
    return DEFAULT_VAT.model_copy(update={"registered": True, "treatments": updated})


def test_falls_back_to_the_category_row_when_the_charge_has_no_override():
    vat = _registered_vat()
    r = resolve_vat_treatment(vat, "construction", None)
    assert r.rate_pct == 5
    assert r.recoverable_pct == 100
    assert r.source == "category"


def test_prefers_a_line_override_over_the_category_row():
    vat = _registered_vat()
    override = VatOverride(rate_pct=20, recoverable_pct=60, recovery_basis="partial_exemption")
    r = resolve_vat_treatment(vat, "construction", override)
    assert r.rate_pct == 20
    assert r.recoverable_pct == 60
    assert r.recovery_basis == "partial_exemption"
    assert r.source == "override"


def test_carries_the_category_row_evidence_status_onto_an_overridden_charge():
    # An override states rate and recovery. It does not state evidence -- the
    # adviser confirmation still belongs to the category. If this ever returns
    # 'confirmed' for an unconfirmed category, the Sec 17.10 draft gate goes blind.
    vat = _registered_vat()
    override = VatOverride(rate_pct=20, recoverable_pct=60, recovery_basis="partial_exemption")
    r = resolve_vat_treatment(vat, "construction", override)
    assert r.evidence_status == "unconfirmed"


def test_yields_a_zero_rate_resolution_for_every_category_when_not_registered():
    off = _registered_vat().model_copy(update={"registered": False})
    for category in VAT_CHARGE_CATEGORIES:
        assert resolve_vat_treatment(off, category, None).rate_pct == 0


def test_ignores_an_override_when_not_registered():
    off = _registered_vat().model_copy(update={"registered": False})
    override = VatOverride(rate_pct=20, recoverable_pct=100, recovery_basis="zero_rated_sale")
    r = resolve_vat_treatment(off, "construction", override)
    assert r.rate_pct == 0


def _purchase(opted: bool, togc: str) -> PurchaseVatInputs:
    return PurchaseVatInputs(
        vendor_opted_to_tax=opted, togc_treatment=togc,  # type: ignore[arg-type]
        evidence_status="unconfirmed", notes="",
    )


def test_charges_where_the_vendor_has_opted_and_togc_does_not_apply():
    assert is_purchase_vat_chargeable(_purchase(True, "does_not_apply")) is True


def test_charges_where_the_vendor_has_opted_and_togc_is_unconfirmed_the_prudent_case():
    assert is_purchase_vat_chargeable(_purchase(True, "unconfirmed")) is True


def test_does_not_charge_where_togc_applies_whatever_the_option_to_tax():
    assert is_purchase_vat_chargeable(_purchase(True, "applies")) is False
    assert is_purchase_vat_chargeable(_purchase(False, "applies")) is False


def test_does_not_charge_where_the_vendor_has_not_opted_to_tax():
    assert is_purchase_vat_chargeable(_purchase(False, "does_not_apply")) is False
    assert is_purchase_vat_chargeable(_purchase(False, "unconfirmed")) is False


def test_default_vat_holds_exactly_the_six_categories_in_declared_order():
    assert [t.category for t in DEFAULT_VAT.treatments] == list(VAT_CHARGE_CATEGORIES)


def test_ships_inert_not_registered_every_rate_and_recovery_zero_every_status_unconfirmed():
    assert DEFAULT_VAT.registered is False
    for t in DEFAULT_VAT.treatments:
        assert t.rate_pct == 0
        assert t.recoverable_pct == 0
        assert t.recovery_basis == "unconfirmed"
        assert t.evidence_status == "unconfirmed"
    assert DEFAULT_VAT.purchase.vendor_opted_to_tax is False
    assert DEFAULT_VAT.purchase.togc_treatment == "unconfirmed"


def _quarterly():
    return DEFAULT_VAT.model_copy(update={
        "registered": True,
        "return_frequency": "quarterly",
        "first_period_end_month": 2,
        "repayment_lag_months": 1,
    })


def test_covers_the_term_with_contiguous_periods_starting_at_month_0():
    ps = vat_return_periods(_quarterly(), 12)
    assert ps[0].first_month == 0
    for i in range(1, len(ps)):
        assert ps[i].first_month == ps[i - 1].last_month + 1
    assert ps[-1].last_month >= 11


def test_ends_the_first_period_at_first_period_end_month_and_quarters_thereafter():
    ps = vat_return_periods(_quarterly(), 12)
    assert (ps[0].index, ps[0].first_month, ps[0].last_month, ps[0].reclaim_month) == (0, 0, 2, 3)
    assert (ps[1].index, ps[1].first_month, ps[1].last_month, ps[1].reclaim_month) == (1, 3, 5, 6)
    assert (ps[2].index, ps[2].first_month, ps[2].last_month, ps[2].reclaim_month) == (2, 6, 8, 9)


def test_reports_a_reclaim_falling_beyond_the_final_month_as_null_never_clamped():
    # Term 12 => final month index 11. The period ending month 11 reclaims in
    # month 12, which does not exist. Clamping it into month 11 would
    # manufacture a receipt the borrower has not had (Sec 17.4).
    ps = vat_return_periods(_quarterly(), 12)
    last = ps[-1]
    assert last.last_month == 11
    assert last.reclaim_month is None


def test_gives_monthly_registration_one_period_per_month():
    monthly = _quarterly().model_copy(update={
        "return_frequency": "monthly", "first_period_end_month": 0,
    })
    ps = vat_return_periods(monthly, 4)
    assert [(p.first_month, p.last_month, p.reclaim_month) for p in ps] == [
        (0, 0, 1), (1, 1, 2), (2, 2, 3), (3, 3, None),
    ]


def test_honours_a_longer_repayment_lag():
    ps = vat_return_periods(_quarterly().model_copy(update={"repayment_lag_months": 3}), 12)
    assert ps[0].reclaim_month == 5
    assert ps[1].reclaim_month == 8


def test_returns_no_periods_when_the_document_is_not_vat_registered():
    assert vat_return_periods(_quarterly().model_copy(update={"registered": False}), 12) == []


def test_handles_a_first_period_end_at_or_beyond_the_final_month():
    ps = vat_return_periods(_quarterly().model_copy(update={"first_period_end_month": 20}), 6)
    assert len(ps) == 1
    assert (ps[0].first_month, ps[0].last_month, ps[0].reclaim_month) == (0, 5, None)


def test_clamps_a_degenerate_term_to_one_month_matching_build_schedule():
    # schedule.py clamps `max(1, math.floor(inputs.finance.term_months))` before
    # any of this runs, and from Task 3 onward vat_return_periods receives its
    # term from that already-built schedule. If this returned no periods for a
    # term of 0 (or negative), a built month of uses would have no VAT period
    # covering it -- so matching the clamp here is deliberate consistency with
    # an existing engine-wide convention, not an oversight.
    for term in (0, -1):
        ps = vat_return_periods(_quarterly(), term)
        assert len(ps) == 1
        assert (ps[0].first_month, ps[0].last_month) == (0, 0)


def test_clamps_a_negative_first_period_end_month_to_0():
    ps = vat_return_periods(_quarterly().model_copy(update={"first_period_end_month": -5}), 6)
    assert (ps[0].first_month, ps[0].last_month, ps[0].reclaim_month) == (0, 0, 1)


# ---------------------------------------------------------------------------
# Task 3 -- compute_vat (spec Sec 17.5). Mirrors the six computeVat cases and
# the two spread_pro_rata cases in vat.test.ts, plus the cross-engine parity
# test the plan asks for. Cross-engine parity is checked properly by the
# fixtures in Task 11; this is the cheap early warning.
# ---------------------------------------------------------------------------


def _vat_block(registered: bool, recoverable_pct: float, all_categories_at_20: bool) -> dict:
    treatments = []
    for t in default_vat_treatments():
        if all_categories_at_20 or t.category == "construction":
            treatments.append(t.model_copy(update={
                "rate_pct": 20,
                "recoverable_pct": 100 if all_categories_at_20 else recoverable_pct,
                "recovery_basis": "zero_rated_sale",
            }).model_dump())
        else:
            treatments.append(t.model_dump())
    return {**DEFAULT_VAT.model_dump(), "registered": registered, "treatments": treatments}


def _build_worked_vat_case(
    term_months: int = 7,
    recoverable_pct: float = 100,
    registered: bool = True,
    all_categories_at_20: bool = False,
):
    """The Sec 17.4 worked cycle, built as a REAL document and run through the
    REAL compute_cost_plan and build_schedule -- never a stub, because the
    point of these tests is that VAT reads the cost plan and the spend profile
    the rest of the engine produces. Mirrors buildWorkedVatCase in vat.test.ts.

    Construction is the only thing in the document that bears VAT:
    100,000p/sqm x 1,000 sqm = 100,000,000p base build, contingency 0%,
    compliance 0, NO fee lines, no units (so no sale and no selling costs), and
    a default acquisition that is not opted to tax (so no purchase VAT).

    The explicit programme is load-bearing: the AUTO window spreads
    construction across months 1..term-2 -- five months for a term of seven --
    not the four the worked cycle specifies."""
    doc = migrate_inputs_to_v7({}).model_dump()
    doc["inputs_version"] = 8
    doc["conversion_costs"] = {
        **doc["conversion_costs"],
        "construction_cost_per_sqm_pence": 100_000,
        "total_construction_sqm": 1_000,
        "contingency_pct": 0,
        "fire_safety_pence": 0,
        "sound_insulation_pence": 0,
        "part_l_compliance_pence": 0,
    }
    doc["cost_plan"] = {
        "mode": "headline",
        "packages": [],
        "contingency": [c.model_dump() for c in default_contingency_classes(0)],
        "fee_lines": [],
    }
    doc["finance"] = {**doc["finance"], "term_months": term_months}
    doc["programme"] = {
        "anchor_month": None,
        "packages": {
            "construction": {
                "start_offset": 1, "duration_months": 4,
                "curve": {"kind": "straight_line"},
            },
            "professional": {
                "start_offset": 1, "duration_months": 1,
                "curve": {"kind": "straight_line"},
            },
            "statutory": {
                "start_offset": 1, "duration_months": 1,
                "curve": {"kind": "straight_line"},
            },
        },
    }
    doc["vat"] = _vat_block(registered, recoverable_pct, all_categories_at_20)
    inputs = CalculatorInputsV8.model_validate(doc)
    cost_plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
    schedule = build_schedule(inputs)
    return inputs, cost_plan, schedule


def _build_detailed_vat_case():
    """Detailed mode, two packages, one of them carrying a vat_override.
    Base build 60,000,000 + 40,000,000; general contingency 10% ->
    10,000,000; construction total 110,000,000. Mirrors
    buildDetailedVatCase in vat.test.ts."""
    doc = migrate_inputs_to_v7({}).model_dump()
    doc["inputs_version"] = 8
    doc["conversion_costs"] = {
        **doc["conversion_costs"],
        "total_construction_sqm": 1_000,
        "fire_safety_pence": 0,
        "sound_insulation_pence": 0,
        "part_l_compliance_pence": 0,
    }
    doc["cost_plan"] = {
        "mode": "detailed",
        "packages": [
            {
                "id": "p1", "code": "structure", "label": "Structure",
                "amount_pence": 60_000_000, "contingency_class": "general",
                "lender_eligible": True, "notes": "", "vat_override": None,
            },
            {
                "id": "p2", "code": "envelope", "label": "Envelope",
                "amount_pence": 40_000_000, "contingency_class": "general",
                "lender_eligible": True, "notes": "",
                "vat_override": {
                    "rate_pct": 5, "recoverable_pct": 100,
                    "recovery_basis": "zero_rated_sale",
                },
            },
        ],
        "contingency": [c.model_dump() for c in default_contingency_classes(10)],
        "fee_lines": [],
    }
    doc["finance"] = {**doc["finance"], "term_months": 7}
    doc["programme"] = None
    doc["vat"] = _vat_block(registered=True, recoverable_pct=100, all_categories_at_20=False)
    inputs = CalculatorInputsV8.model_validate(doc)
    cost_plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
    schedule = build_schedule(inputs)
    return inputs, cost_plan, schedule


def test_spread_pro_rata_sums_to_the_total_with_residue_on_the_last_non_zero_weight():
    out = spread_pro_rata(1_000, [1, 1, 1, 0])
    assert sum(out) == 1_000
    assert out[3] == 0
    assert out[2] == 1_000 - out[0] - out[1]


def test_spread_pro_rata_returns_zeros_when_the_weights_sum_to_zero():
    # A charge with no monthly spend cannot be placed. Silently moving it to
    # month 0 would invent a cash outflow the schedule does not show.
    assert spread_pro_rata(500, [0, 0, 0]) == [0, 0, 0]


def test_the_worked_cycle_lands_its_reclaims_on_the_cycle_not_per_month():
    inputs, cost_plan, schedule = _build_worked_vat_case()
    assert [u.construction_pence for u in schedule.uses] == [
        0, 25_000_000, 25_000_000, 25_000_000, 25_000_000, 0, 0,
    ]
    assert cost_plan.construction_total_pence == 100_000_000

    vat = compute_vat(inputs, cost_plan, schedule)
    assert [m.incurred_pence for m in vat.months] == [
        0, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 0, 0,
    ]
    # Term 7 gives two periods: months 0-2 (reclaim m3) and months 3-5 (reclaim
    # m6). Each carries 10,000,000p -- the reclaims must sum to
    # total_input_vat_pence below (ruling R6).
    assert [m.reclaimed_pence for m in vat.months] == [
        0, 0, 0, 10_000_000, 0, 0, 10_000_000,
    ]
    assert [m.carry_pence for m in vat.months] == [
        0, 5_000_000, 10_000_000, 5_000_000, 10_000_000, 10_000_000, 0,
    ]
    assert vat.peak_carry_pence == 10_000_000
    assert vat.total_input_vat_pence == 20_000_000
    assert vat.total_reclaimed_pence == 20_000_000
    assert vat.total_irrecoverable_pence == 0
    assert vat.receivable_at_maturity_pence == 0


def test_reports_a_reclaim_falling_past_the_term_as_receivable_not_as_cash():
    inputs, cost_plan, schedule = _build_worked_vat_case(term_months=5)
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.total_reclaimed_pence < vat.total_input_vat_pence
    assert vat.receivable_at_maturity_pence == (
        vat.total_input_vat_pence - vat.total_reclaimed_pence
    )


def test_splits_a_partly_recoverable_charge_with_the_residue_to_irrecoverable():
    inputs, cost_plan, schedule = _build_worked_vat_case(recoverable_pct=33)
    vat = compute_vat(inputs, cost_plan, schedule)
    # 20,000,000p charged; 33% recoverable = 6,600,000p; irrecoverable is the
    # remainder, so charged == recoverable + irrecoverable exactly.
    assert vat.total_recoverable_pence + vat.total_irrecoverable_pence == (
        vat.total_input_vat_pence
    )
    assert vat.total_irrecoverable_pence > 0


def test_never_charges_vat_on_interest_or_on_the_arrangement_or_exit_fee():
    # The only finance-side charge that may appear is lender_ancillary.
    inputs, cost_plan, schedule = _build_worked_vat_case(all_categories_at_20=True)
    vat = compute_vat(inputs, cost_plan, schedule)
    finance_charges = [c for c in vat.charges if c.category == "lender_ancillary"]
    assert all(c.category in VAT_CHARGE_CATEGORIES for c in vat.charges)
    assert all("ancillary" in c.label.lower() for c in finance_charges)


def test_is_entirely_inert_when_the_document_is_not_vat_registered():
    inputs, cost_plan, schedule = _build_worked_vat_case(registered=False)
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.charges == []
    assert vat.total_input_vat_pence == 0
    assert all(m.incurred_pence == 0 and m.reclaimed_pence == 0 for m in vat.months)


def test_does_not_double_count_an_overridden_package_against_its_category_base():
    inputs, cost_plan, schedule = _build_detailed_vat_case()
    vat = compute_vat(inputs, cost_plan, schedule)
    construction_base = sum(
        c.net_base_pence for c in vat.charges if c.category == "construction"
    )
    assert construction_base == cost_plan.construction_total_pence


def test_the_two_engines_agree_on_the_worked_cycle():
    """Cross-engine parity, cheap early warning (plan Step 6). These three
    seven-element vectors are the SAME literals vat.test.ts asserts for the
    same worked case; Task 11's fixtures check parity properly."""
    inputs, cost_plan, schedule = _build_worked_vat_case()
    vat = compute_vat(inputs, cost_plan, schedule)
    assert [m.incurred_pence for m in vat.months] == [
        0, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 0, 0,
    ]
    assert [m.reclaimed_pence for m in vat.months] == [
        0, 0, 0, 10_000_000, 0, 0, 10_000_000,
    ]
    assert [m.carry_pence for m in vat.months] == [
        0, 5_000_000, 10_000_000, 5_000_000, 10_000_000, 10_000_000, 0,
    ]
