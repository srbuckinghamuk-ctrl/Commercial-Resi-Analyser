"""R11 spec §17. Python mirror of frontend/src/lib/model/vat.test.ts.

Same five resolver cases, same four chargeability cases, same two
default-shape cases -- against resolve_vat_treatment, is_purchase_vat_chargeable,
DEFAULT_VAT, default_vat_treatments and VAT_CHARGE_CATEGORIES imported from
app.financial_model.vat. VatInputs is a pydantic model, so variants are built
with model_copy(update=...) rather than object spread."""
from dataclasses import replace

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
# Task 3 -- compute_vat (spec Sec 17.5). Mirrors vat.test.ts case for case,
# plus the cross-engine parity test the plan asks for. Cross-engine parity is
# checked properly by the fixtures in Task 11; this is the cheap early warning.
# ---------------------------------------------------------------------------


def _vat_block(
    registered: bool,
    recoverable_pct: float,
    all_categories_at_20: bool,
    acquisition_at_20: bool,
    vendor_opted_to_tax: bool,
    togc_treatment: str,
) -> dict:
    def rated(c: str) -> bool:
        return (
            all_categories_at_20
            or c == "construction"
            or (acquisition_at_20 and c == "acquisition")
        )

    treatments = []
    for t in default_vat_treatments():
        if rated(t.category):
            treatments.append(t.model_copy(update={
                "rate_pct": 20,
                "recoverable_pct": 100 if all_categories_at_20 else recoverable_pct,
                "recovery_basis": "zero_rated_sale",
            }).model_dump())
        else:
            treatments.append(t.model_dump())
    block = DEFAULT_VAT.model_dump()
    block["registered"] = registered
    block["treatments"] = treatments
    block["purchase"] = {
        **block["purchase"],
        "vendor_opted_to_tax": vendor_opted_to_tax,
        "togc_treatment": togc_treatment,
    }
    return block


def _build_worked_vat_case(
    term_months: int = 7,
    recoverable_pct: float = 100,
    registered: bool = True,
    all_categories_at_20: bool = False,
    acquisition_at_20: bool = False,
    vendor_opted_to_tax: bool = False,
    togc_treatment: str = "unconfirmed",
    purchase_price_pence: int = 0,
    cash_deal: bool = False,
):
    """The Sec 17.4 worked cycle, built as a REAL document and run through the
    REAL compute_cost_plan and build_schedule -- never a stub, because the
    point of these tests is that VAT reads the cost plan and the spend profile
    the rest of the engine produces. Mirrors buildWorkedVatCase in vat.test.ts.

    Construction is the only thing in the document that bears VAT by default:
    100,000p/sqm x 1,000 sqm = 100,000,000p base build, contingency 0%,
    compliance 0, NO fee lines, no units (so no sale and no selling costs), and
    an acquisition that is not opted to tax (so no purchase VAT).

    The explicit programme is load-bearing: the AUTO window spreads
    construction across months 1..term-2 -- five months for a term of seven --
    not the four the worked cycle specifies.

    The four ancillary fee fields and the committed net facility are set so
    that ruling R13's lender_ancillary base is a real, asserted figure rather
    than a structural zero. They change nothing else: build_schedule reads none
    of them, and the lender_ancillary rate is 0 unless all_categories_at_20."""
    doc = migrate_inputs_to_v7({}).model_dump()
    doc["inputs_version"] = 8
    doc["acquisition"] = {**doc["acquisition"], "purchase_price_pence": purchase_price_pence}
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
    doc["finance"] = {
        **doc["finance"],
        "committed_net_facility_pence": 500_000_000,
        "broker_fee_pence": 250_000,
        "lender_legal_fee_pence": 150_000,
        "valuation_fee_pence": 100_000,
        "monitoring_surveyor_fee_pence": 50_000,
        "term_months": term_months,
    }
    if cash_deal:
        doc["finance"]["funding_source"] = "cash"
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
    doc["vat"] = _vat_block(
        registered, recoverable_pct, all_categories_at_20,
        acquisition_at_20, vendor_opted_to_tax, togc_treatment,
    )
    inputs = CalculatorInputsV8.model_validate(doc)
    cost_plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
    schedule = build_schedule(inputs)
    return inputs, cost_plan, schedule


def _build_detailed_vat_case(mode: str = "detailed"):
    """Two packages, one of them carrying a vat_override, and a CONFIRMED
    construction category row so the override line's evidence status is a
    falsifiable assertion rather than a coincidence. Mirrors
    buildDetailedVatCase in vat.test.ts.

    detailed: base build 60,000,000 + 40,000,000; general contingency 10% ->
    10,000,000; construction total 110,000,000.
    headline: packages are returned by compute_cost_plan but NOT folded into
    base_build_pence, which is 10,000p/sqm x 1,000 sqm = 10,000,000;
    contingency 10% -> 1,000,000; construction total 11,000,000 -- LESS than
    the overridden package, which is what makes the mode gate load-bearing."""
    doc = migrate_inputs_to_v7({}).model_dump()
    doc["inputs_version"] = 8
    doc["conversion_costs"] = {
        **doc["conversion_costs"],
        "construction_cost_per_sqm_pence": 10_000,
        "total_construction_sqm": 1_000,
        "fire_safety_pence": 0,
        "sound_insulation_pence": 0,
        "part_l_compliance_pence": 0,
    }
    doc["cost_plan"] = {
        "mode": mode,
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
    treatments = []
    for t in default_vat_treatments():
        if t.category == "construction":
            treatments.append(t.model_copy(update={
                "rate_pct": 20,
                "recoverable_pct": 100,
                "recovery_basis": "zero_rated_sale",
                "evidence_status": "confirmed",
            }).model_dump())
        else:
            treatments.append(t.model_dump())
    doc["vat"] = {**DEFAULT_VAT.model_dump(), "registered": True, "treatments": treatments}
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
    # This function has no month to prefer. compute_vat owns the fallback
    # (ruling R15) and is tested on it separately.
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
    assert vat.peak_carry_month == 2
    assert vat.total_input_vat_pence == 20_000_000
    assert vat.total_reclaimed_pence == 20_000_000
    assert vat.total_irrecoverable_pence == 0
    assert vat.receivable_at_maturity_pence == 0
    # Ruling R15's invariant: every charged penny is placed in some month, so
    # the ledger funds exactly what the charge lines disclose.
    assert sum(m.incurred_pence for m in vat.months) == vat.total_input_vat_pence


def test_places_a_charge_whose_base_has_no_spend_months_in_month_zero():
    """Ruling R15. R2's Pick is what makes this expressible: a spend profile
    with no construction months at all, against a cost plan that still says
    100,000,000p of construction. Without the month-0 fallback the 20,000,000p
    of VAT is charged, disclosed and (via its irrecoverable part) added to
    cost-before-finance while the ledger funds none of it."""
    inputs, cost_plan, schedule = _build_worked_vat_case()
    no_spend = replace(
        schedule,
        uses=[replace(u, construction_pence=0) for u in schedule.uses],
    )
    vat = compute_vat(inputs, cost_plan, no_spend)
    assert vat.total_input_vat_pence == 20_000_000
    assert vat.months[0].incurred_pence == 20_000_000
    assert sum(m.incurred_pence for m in vat.months) == vat.total_input_vat_pence


def test_reports_a_reclaim_falling_past_the_term_as_receivable_not_as_cash():
    inputs, cost_plan, schedule = _build_worked_vat_case(term_months=5)
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.total_reclaimed_pence < vat.total_input_vat_pence
    assert vat.receivable_at_maturity_pence == (
        vat.total_input_vat_pence - vat.total_reclaimed_pence
    )


def test_splits_a_partly_recoverable_charge_into_recoverable_and_irrecoverable():
    inputs, cost_plan, schedule = _build_worked_vat_case(recoverable_pct=33)
    vat = compute_vat(inputs, cost_plan, schedule)
    # 20,000,000p charged; 33% recoverable = 6,600,000p exactly; irrecoverable
    # is the remainder. Literals, not an identity that holds by construction.
    assert vat.total_input_vat_pence == 20_000_000
    assert vat.total_recoverable_pence == 6_600_000
    assert vat.total_irrecoverable_pence == 13_400_000
    # Only the recoverable part is reclaimed.
    assert vat.total_reclaimed_pence == 6_600_000


def test_gives_the_rounding_residue_to_irrecoverable_rather_than_losing_it():
    # 33.3333325% of 20,000,000p is 6,666,666.5p, which money_round takes
    # half-up to 6,666,667p. Computing irrecoverable as charged - recoverable
    # gives 13,333,333p and keeps the sum exact. Computing it INDEPENDENTLY as
    # money_round(20,000,000 * 66.6666675/100) gives 13,333,334p and invents a
    # penny -- this literal is what distinguishes the two. (Builtin round()
    # would take 6,666,666.5 to 6,666,666 and disagree with JS Math.round.)
    inputs, cost_plan, schedule = _build_worked_vat_case(recoverable_pct=33.3333325)
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.total_input_vat_pence == 20_000_000
    assert vat.total_recoverable_pence == 6_666_667
    assert vat.total_irrecoverable_pence == 13_333_333
    assert vat.total_recoverable_pence + vat.total_irrecoverable_pence == (
        vat.total_input_vat_pence
    )


def test_charges_vat_on_the_four_lender_ancillary_fees_and_nothing_else():
    # Sec 17.3 / ruling R13. The base is the four ancillary fee fields summed.
    # Interest, and the arrangement and exit fees, are exempt financial
    # services: the arrangement fee alone is 2% of the 500,000,000p net
    # facility -- 10,000,000p -- so an implementation that swept it in would
    # miss this figure by a factor of nineteen.
    inputs, cost_plan, schedule = _build_worked_vat_case(all_categories_at_20=True)
    vat = compute_vat(inputs, cost_plan, schedule)
    finance_charges = [c for c in vat.charges if c.category == "lender_ancillary"]
    assert len(finance_charges) == 1
    assert finance_charges[0].net_base_pence == (
        inputs.finance.broker_fee_pence + inputs.finance.lender_legal_fee_pence
        + inputs.finance.valuation_fee_pence + inputs.finance.monitoring_surveyor_fee_pence
    )
    assert finance_charges[0].net_base_pence == 550_000
    assert finance_charges[0].vat_pence == 110_000
    # Where the ledger puts the fees: month 0.
    assert vat.months[0].incurred_pence == 110_000


def test_charges_no_lender_ancillary_vat_on_a_cash_deal():
    inputs, cost_plan, schedule = _build_worked_vat_case(
        all_categories_at_20=True, cash_deal=True,
    )
    vat = compute_vat(inputs, cost_plan, schedule)
    finance_charges = [c for c in vat.charges if c.category == "lender_ancillary"]
    assert len(finance_charges) == 1
    assert finance_charges[0].net_base_pence == 0
    assert finance_charges[0].vat_pence == 0
    assert vat.months[0].incurred_pence == 0


def test_charges_purchase_vat_in_month_zero_where_the_vendor_has_opted_to_tax():
    inputs, cost_plan, schedule = _build_worked_vat_case(
        acquisition_at_20=True,
        vendor_opted_to_tax=True,
        togc_treatment="does_not_apply",
        purchase_price_pence=50_000_000,
    )
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.purchase_vat_pence == 10_000_000
    # Month 0 carries the purchase VAT and nothing else: construction runs
    # months 1-4 and every other category is at 0%.
    assert vat.months[0].incurred_pence == 10_000_000
    assert vat.total_input_vat_pence == 30_000_000


def test_charges_no_purchase_vat_where_togc_applies():
    inputs, cost_plan, schedule = _build_worked_vat_case(
        acquisition_at_20=True,
        vendor_opted_to_tax=True,
        togc_treatment="applies",
        purchase_price_pence=50_000_000,
    )
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.purchase_vat_pence == 0
    assert vat.months[0].incurred_pence == 0
    assert vat.total_input_vat_pence == 20_000_000


def test_is_entirely_inert_when_the_document_is_not_vat_registered():
    inputs, cost_plan, schedule = _build_worked_vat_case(registered=False)
    vat = compute_vat(inputs, cost_plan, schedule)
    assert vat.charges == []
    assert vat.total_input_vat_pence == 0
    assert all(m.incurred_pence == 0 and m.reclaimed_pence == 0 for m in vat.months)


def test_does_not_double_count_an_overridden_package_against_its_category_base():
    inputs, cost_plan, schedule = _build_detailed_vat_case()
    # Assert the constructed document FIRST: both sides of the sum below come
    # from the code under test, so without this a helper that silently dropped
    # its packages would still pass.
    assert cost_plan.mode == "detailed"
    assert len(cost_plan.packages) == 2
    assert cost_plan.base_build_pence == 100_000_000
    assert cost_plan.construction_total_pence == 110_000_000

    vat = compute_vat(inputs, cost_plan, schedule)
    construction_base = sum(
        c.net_base_pence for c in vat.charges if c.category == "construction"
    )
    assert construction_base == cost_plan.construction_total_pence
    # The category line carries the total NET of the overridden package.
    category_line = next(c for c in vat.charges if c.id == "category:construction")
    assert category_line.net_base_pence == 70_000_000


def test_charges_an_overridden_package_at_the_override_rate_keeping_category_evidence():
    # Sec 17.2's central mechanism. Without this, an implementation that
    # ignored vat_override entirely passes every other test in this file.
    inputs, cost_plan, schedule = _build_detailed_vat_case()
    vat = compute_vat(inputs, cost_plan, schedule)
    overridden = next(c for c in vat.charges if c.id == "package:p2")
    assert overridden.source == "override"
    assert overridden.rate_pct == 5
    assert overridden.net_base_pence == 40_000_000
    # 5% of 40,000,000p, NOT the category's 20% (which would be 8,000,000p).
    assert overridden.vat_pence == 2_000_000
    # Evidence stays a CATEGORY fact -- the override model carries no evidence
    # field at all, so an override that could claim its own would blind the
    # Sec 17.10 draft gate. The category row here is deliberately 'confirmed'.
    assert overridden.evidence_status == "confirmed"


def test_ignores_packages_in_headline_mode_where_the_cost_plan_never_counted_them():
    # compute_cost_plan returns `packages` populated in either mode but folds
    # their amounts into construction_total_pence only in detailed mode.
    # Subtracting unconditionally would make the category base
    # 11,000,000 - 40,000,000 = -29,000,000: negative VAT, negative months, and
    # a negative irrecoverable figure landing in cost-before-finance.
    inputs, cost_plan, schedule = _build_detailed_vat_case(mode="headline")
    assert cost_plan.mode == "headline"
    assert len(cost_plan.packages) == 2
    assert cost_plan.base_build_pence == 10_000_000
    assert cost_plan.construction_total_pence == 11_000_000

    vat = compute_vat(inputs, cost_plan, schedule)
    construction = [c for c in vat.charges if c.category == "construction"]
    assert sum(c.net_base_pence for c in construction) == cost_plan.construction_total_pence
    assert not any(c.id == "package:p2" for c in vat.charges)
    assert all(c.net_base_pence >= 0 for c in vat.charges)
    assert all(c.vat_pence >= 0 for c in vat.charges)
    assert all(m.incurred_pence >= 0 for m in vat.months)


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
