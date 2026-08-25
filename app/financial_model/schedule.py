"""Port of frontend/src/lib/model/schedule.ts, plus the cost-helper functions it
imports from frontend/src/lib/conversion-calc-engine.ts (calculate_gdv,
calculate_total_acquisition_cost).

R10 (spec Sec 16): build_schedule no longer sums conversion_costs fields
itself for construction/professional/statutory -- it calls compute_cost_plan
once and reads the three totals from the result, the same engine
compute_cost_plan.ts serves to the UI and the memo.

R10 Task 9 fix round 1 (I3): calculate_total_construction_cost and
calculate_total_professional_fees -- unused by build_schedule, kept only for
migrate.py's v1 facility-sizing path, which runs before a document has a
cost_plan block at all -- moved to legacy_costs.py. That isolates their one
legitimate raw contingency_pct read in its own module, so
tests/test_accessor_guard.py can allowlist it without also un-guarding this
module (mirrors frontend/src/lib/conversion-calc-engine.ts, which isolates
the same calculator away from schedule.ts)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .areas import developed_area_sqm
from .cost_plan import compute_cost_plan
from .curves import spread_by_curve
from .engine import money_round
from .acquisition_tax import calculate_acquisition_tax, resolve_acquisition_date
from .investment_case import InvestmentCaseResult, compute_investment_case
from .programme import DerivedPhase, derive_phases, is_legacy_programme, is_programme_network
from .unit_sales import UnitSalesResult, compute_unit_sales
from .types import (
    AcquisitionInputs,
    AcquisitionInputsV5,
    AnyCalculatorInputs,
    FeeCategory,
    PhaseAnchor,
    ProgrammeNetwork,
    ProgrammePackage,
    ProposedUnit,
    SimpleSpendCurve,
)
from .vat import (
    ConsiderationInputs,
    VatResult,
    chargeable_consideration_pence,
    compute_vat,
)


def unit_ancillary_value_pence(u: ProposedUnit) -> int:
    """R9 spec Sec 15.5 -- a unit's ancillary value. A pre-v6 unit carries no
    ``ancillary`` attribute at all, read structurally with getattr (matching
    areas.py's version-dispatch idiom) and resolving to zero."""
    anc = getattr(u, "ancillary", None)
    if anc is None:
        return 0
    return anc.parking_value_pence + anc.balcony_terrace_value_pence


@dataclass(frozen=True)
class GdvBreakdown:
    # Internal saleable unit values -- the pre-R9 figure, unchanged.
    internal_pence: int
    # Parking plus balcony/terrace. Reported separately, never folded into
    # internal saleable value (spec Sec 3.1, which this release rewrites).
    ancillary_pence: int
    total_pence: int


def calculate_gdv_breakdown(units: list[ProposedUnit]) -> GdvBreakdown:
    internal = sum(u.estimated_value_pence for u in units)
    ancillary = sum(unit_ancillary_value_pence(u) for u in units)
    return GdvBreakdown(internal_pence=internal, ancillary_pence=ancillary, total_pence=internal + ancillary)


def calculate_gdv(units: list[ProposedUnit]) -> int:
    """Total developer GDV. Retained as the total so every existing caller is
    unaffected by the R9 split; use calculate_gdv_breakdown where the parts
    matter."""
    return calculate_gdv_breakdown(units).total_pence


def calculate_total_acquisition_cost(inputs: ConsiderationInputs) -> int:
    """Spec Sec 3.3 -- the acquisition line of the cost stack, acquisition tax
    included.

    R8 (spec Sec 14): the tax is the document's own regime, not England/NI's.
    This is the *second* site that computes acquisition tax -- derive_metrics is
    the other, and the two must always agree, because acquisition_cost_pence
    (this figure) flows into TDC while acquisition_tax_pence (that one) is what
    the report names. Both fixture suites and test_financial_model_metrics.py
    pin their equality.

    ``inputs.acquisition`` is the base class, which AcquisitionInputsV5
    subclasses; the isinstance gate is Python's stand-in for the TS engine's
    ``'jurisdiction' in acq`` guard (the same pairing derive_metrics uses). A
    v2-v4 acquisition block carries none of the new fields, so it resolves to
    england_ni with a null date and no override -- byte-for-byte what
    calculate_commercial_sdlt returned before R8 deleted it.

    R11 (spec Sec 17.7): it takes the DOCUMENT, not the acquisition block
    alone, because the tax base is the VAT-inclusive consideration and that is
    a fact about the document's VAT block. Mirrors calculateTotalAcquisitionCost
    in conversion-calc-engine.ts, which changed the same way and for the same
    reason -- there, because a branded ChargeableConsideration cannot be
    obtained from the block alone.
    """
    acq = inputs.acquisition
    is_v5 = isinstance(acq, AcquisitionInputsV5)
    jurisdiction = acq.jurisdiction if is_v5 else "england_ni"
    raw_date = acq.acquisition_date if is_v5 else None
    # Fix round 1 (R8): build_schedule runs before validate_inputs in
    # run_appraisal, so an unusable date must degrade rather than raise here --
    # see resolve_acquisition_date's docstring. validate_inputs re-derives this
    # as a hard acquisition.acquisition_date error independently, and
    # derive_metrics degrades identically so the two tax sites cannot drift.
    date = resolve_acquisition_date(jurisdiction, "non_residential", raw_date)
    sdlt = calculate_acquisition_tax(
        # Sec 17.7: the VAT-INCLUSIVE consideration, never the raw price.
        consideration_pence=chargeable_consideration_pence(inputs),
        jurisdiction=jurisdiction,
        basis="non_residential",
        date=date,
        override_pence=acq.acquisition_tax_override_pence if is_v5 else None,
        override_reason=acq.acquisition_tax_override_reason if is_v5 else None,
    ).total_pence
    broker_fee = money_round((acq.purchase_price_pence * acq.broker_fee_pct) / 100)
    return (
        acq.purchase_price_pence + sdlt + acq.legal_fees_pence + acq.survey_cost_pence
        + broker_fee + acq.other_acquisition_costs_pence
    )


@dataclass
class MonthUses:
    acquisition_pence: int
    construction_pence: int
    professional_pence: int
    statutory_pence: int
    lender_ancillary_fees_pence: int
    # R11 spec Sec 17.6. Written back from compute_vat's months[].incurred_pence
    # after the uses/receipts lists are fully built -- never a source figure
    # itself (Sec 17.5's one-direction rule).
    vat_pence: int


@dataclass
class MonthReceipts:
    gross_sale_pence: int
    agent_fee_pence: int
    selling_legal_pence: int
    # R11 spec Sec 17.6. Written back from compute_vat's months[].reclaimed_pence.
    # Deliberately NOT part of gross_sale_pence: it is not a sale receipt. Narrowed
    # per Sec 19.5 -- it never enters gross_sale_pence or gdv_pence, but
    # debt-denominated metrics (LTGDV, senior break-even) legitimately move,
    # because the debt they are computed from legitimately moves.
    vat_reclaim_pence: int
    # R13 spec Sec 19.5. Written back from compute_investment_case's
    # months[].noi_pence, its own class of receipt -- not a sale receipt. It
    # never enters gross_sale_pence or gdv_pence, but debt-denominated
    # metrics legitimately move, because the debt they are computed from
    # legitimately moves. Zero on every month of a document whose
    # investment_case is None.
    net_operating_income_pence: int = 0


@dataclass
class ScheduleTotals:
    acquisition_pence: int
    construction_pence: int
    professional_pence: int
    statutory_pence: int
    selling_costs_pence: int
    gross_sales_pence: int
    gdv_pence: int
    retained_value_pence: int
    cost_before_finance_ex_selling_pence: int
    # R11 spec Sec 17.6/Sec 17.5. vat_pence/vat_reclaim_pence disclose the gross
    # VAT cycle; irrecoverable_vat_pence is the cost-plan-adjacent figure Task 8
    # adds to cost-before-finance on its own line. None of these three feed
    # cost_before_finance_ex_selling_pence above -- that would double count the
    # very figure Task 8 adds downstream.
    vat_pence: int
    vat_reclaim_pence: int
    irrecoverable_vat_pence: int
    # R13 spec Sec 19.5. The schedule-wide total of receipts[].net_operating_
    # income_pence -- identical to investment_case.totals.noi_pence where
    # non-None (republished, never re-derived; Sec 19's result block is
    # computed once) and 0 on the None path.
    net_operating_income_pence: int


@dataclass
class ScheduleRefinance:
    month: int
    net_proceeds_pence: int


@dataclass
class ScheduleProgramme:
    """R12 spec Sec 18.10/Sec 18.5. Mirrors Schedule['programme'] in
    finance-types.ts. Populated only for a v9 precedence network with no
    cycle; None on the auto-window path and the legacy explicit-programme
    path, exactly as their input is -- a derived block is never synthesised
    for a document that never asked for one."""

    finish_month: int
    critical_path: list[str]
    phases: list[DerivedPhase]


@dataclass
class ScheduleResolvedExitMonths:
    """R13 spec Sec 19.6, closing Sec 18.10 limitation 9. Mirrors
    Schedule['resolved_exit_months'] in finance-types.ts. The memo and
    CashflowPage print a tranche's or the refinance's month; before this
    field existed they printed the RAW month_offset while the ledger used
    the resolved one, so an anchored tranche/refinance on a slipped
    programme was reported at a month the ledger never used. They read this
    instead. Empty tranches list when there is no sales_phasing input; None
    refinance when there is no refinance input."""

    tranches: list[int]
    refinance: int | None


@dataclass
class Schedule:
    term_months: int
    uses: list[MonthUses]
    receipts: list[MonthReceipts]
    totals: ScheduleTotals
    # R11 spec Sec 17.5/Sec 17.6. The full VAT result, computed strictly
    # downstream of the finished uses/receipts lists and written back into them
    # -- never the other way round.
    vat: VatResult
    # Spec Sec 4.5 net refinance proceeds -- wired into the ledger in engine.py.
    # None when `refinance` inputs are None (the migration default; byte-identical
    # to calc 2.2.0). Defaulted so pre-existing direct-construction call sites
    # (tests) do not need to change.
    refinance: ScheduleRefinance | None = None
    # R12 spec Sec 18.10/Sec 18.5. None on the auto-window and legacy-explicit-
    # programme paths, exactly as their input is; the derived
    # {finish_month, critical_path, phases} block for a v9 network, computed
    # in build_schedule, and None-only if that network contains a cycle
    # (unreachable post-validation).
    programme: ScheduleProgramme | None = None
    # R13 spec Sec 19.6. compute_investment_case's full result, computed once
    # in build_schedule and republished -- never recomputed -- onto
    # AppraisalResultV2 by Task 11 (Sec 17.12's `vat` treatment). None exactly
    # when the INPUT investment_case is None: no block is synthesised for a
    # document that never asked for one.
    investment_case: InvestmentCaseResult | None = None
    # R13b spec Sec 22.6. compute_unit_sales's full result, computed once here
    # and republished (never recomputed) onto AppraisalResultV2. None exactly
    # when the INPUT unit_sales is None.
    unit_sales: UnitSalesResult | None = None
    resolved_exit_months: ScheduleResolvedExitMonths = field(
        default_factory=lambda: ScheduleResolvedExitMonths(tranches=[], refinance=None),
    )
    # R14 spec Sec 4.2(b). Computed once on the cost plan, republished here so
    # the ledger reads one figure and never re-derives it. Defaulted (like
    # `refinance` above) so pre-existing direct-construction call sites (tests)
    # do not need to change; 1.0 is the all-eligible/headline value, so a
    # schedule built without it behaves exactly as calc <= 2.12.0 did.
    lender_eligible_ratio: float = 1.0


@dataclass
class _PartialSchedule:
    """Structural stand-in for ``Pick<Schedule, 'term_months' | 'uses' |
    'receipts'>`` -- compute_vat needs no more than this, and the real
    Schedule does not exist yet at the point build_schedule calls it (Sec
    17.6)."""

    term_months: int
    uses: list[MonthUses]
    receipts: list[MonthReceipts]


def spread_straight_line(total: int, months: int) -> list[int]:
    """Straight-line spread in integer pence; the final month absorbs the
    rounding residue."""
    if months <= 0:
        return []
    per = money_round(total / months)
    out = [per] * months
    out[months - 1] = total - per * (months - 1)
    return out


def resolved_phase_id(
    phase_id: str | None, category: FeeCategory | str, network: ProgrammeNetwork,
) -> str:
    """Spec Sec 18.5. The ONE resolution rule, both cost modes. A line's
    override and the category default can never both apply. Mirrors
    resolvedPhaseId in schedule.ts."""
    if phase_id is not None:
        return phase_id
    return getattr(network.category_phase_ids, category)


def _empty_uses() -> MonthUses:
    return MonthUses(
        acquisition_pence=0, construction_pence=0, professional_pence=0,
        statutory_pence=0, lender_ancillary_fees_pence=0, vat_pence=0,
    )


def _empty_receipts() -> MonthReceipts:
    return MonthReceipts(
        gross_sale_pence=0, agent_fee_pence=0, selling_legal_pence=0, vat_reclaim_pence=0,
    )


def build_schedule(inputs: AnyCalculatorInputs) -> Schedule:
    term = max(1, math.floor(inputs.finance.term_months))
    units = inputs.unit_mix.units

    acquisition_total = calculate_total_acquisition_cost(inputs)
    # R10 spec Sec 16. The cost stack is computed once, by the one engine that
    # serves both modes, and this is the only place the schedule learns the
    # three totals.
    cost_plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(units))
    construction_total = cost_plan.construction_total_pence
    professional_total = cost_plan.professional_total_pence
    # Sec 3.4: prior approval lands in month 0; every other statutory line
    # spreads with the professional curve. Keyed on the fee CODE, preserving
    # the pre-R10 split that was keyed on a hard-coded field name. R12
    # generalises fee timing.
    prior_approval = sum(f.amount_pence for f in cost_plan.fees if f.code == "prior_approval")
    statutory_spread_total = cost_plan.statutory_total_pence - prior_approval
    statutory_total = cost_plan.statutory_total_pence

    uses = [_empty_uses() for _ in range(term)]
    receipts = [_empty_receipts() for _ in range(term)]

    uses[0].acquisition_pence = acquisition_total

    # R12 (spec Sec 18.1): `programme` is a two-state field across the version
    # union -- the legacy `{ packages: {...} }` shape (v4-v8) or a v9
    # precedence network (`{ phases: [...] }`). Mirrors schedule.ts's
    # isProgrammeNetwork/isLegacyProgramme discriminators.
    raw_programme = getattr(inputs, "programme", None)
    network: ProgrammeNetwork | None = (
        raw_programme if raw_programme is not None and is_programme_network(raw_programme) else None
    )
    legacy_programme = (
        raw_programme if raw_programme is not None and is_legacy_programme(raw_programme) else None
    )

    programme_result: ScheduleProgramme | None = None

    if network is not None:
        # Spec Sec 18.5 (amended, fix round 1 Finding 1). The ONE resolution
        # rule places every resolved amount into a BUCKET keyed by (resolved
        # phase, category); each bucket's TOTAL spreads once over that
        # phase's window with that phase's curve. Two lines resolving to the
        # same phase in the same category are one spread of their combined
        # total, not two spreads summed -- summed spreads round independently
        # and can disagree with a single spread of the sum by a few pence,
        # which breaks the v8->v9 migration identity gate on any document
        # whose amounts don't happen to divide evenly. When every line
        # resolves to its category default -- exactly what migration
        # produces, since it writes no per-line phase_id -- the bucket total
        # IS the category total and this is bit-identical to the legacy arm's
        # single spread_by_curve(category_total, ...) call.
        #
        # The auto/legacy arms' month-0 lump (`uses[0].statutory_pence +=
        # prior_approval`, in the else branch below) is deliberately NOT
        # applied here -- Sec 18.5's second surviving anchor is a placement
        # decision, not a rounding one, and stays keyed per LINE: an untagged
        # prior_approval fee is pinned to month 0 and never enters a bucket;
        # a tagged one joins its phase's bucket like any other line. A
        # category-level lump can't tell those two cases apart.
        derivation = derive_phases(network)
        phase_by_id = {p.id: p for p in network.phases}

        # Defensive, mirroring the legacy arm's belt-and-braces clamp below:
        # unreachable for any document that passes validation -- a cycle, or
        # a phase_id / category_phase_ids entry naming an absent phase, are
        # hard validation errors owned by validation.py, not this module.
        # Degrades to a defined month-0, ONE-month placement instead of
        # crashing an unvalidated caller -- `max(1, ...)`, not a bare
        # fallback of 1, because a resolvable milestone (duration_months ==
        # 0, itself only reachable pre-validation) is not None and would
        # otherwise pass 0 through, and spread_by_curve returns [] for a
        # non-positive duration, silently dropping the money instead of
        # degrading to a defined placement.
        def place_in_phase(total: int, phase_id: str, add) -> None:
            phase = phase_by_id.get(phase_id)
            derived = derivation.by_id.get(phase_id) if derivation.cycle is None else None
            start = derived.start_month if derived is not None else 0
            duration = max(1, derived.duration_months if derived is not None else 1)
            curve = phase.curve if phase is not None else SimpleSpendCurve(kind="straight_line")
            for i, v in enumerate(spread_by_curve(total, duration, curve)):
                add(min(max(math.floor(start + i), 0), term - 1), v)

        def add_to_bucket(bucket: dict[str, int], phase_id: str, amount: int) -> None:
            bucket[phase_id] = bucket.get(phase_id, 0) + amount

        # Construction: each package's own amount joins its resolved phase's
        # bucket. The remainder -- contingency and compliance, or a headline
        # document's WHOLE total, since headline mode carries no package
        # rows at all -- is not itself a "line" and always resolves through
        # the category default, joining whichever bucket that is.
        construction_buckets: dict[str, int] = {}
        construction_remainder = construction_total
        for pkg in cost_plan.packages:
            pid = resolved_phase_id(pkg.phase_id, "construction", network)
            add_to_bucket(construction_buckets, pid, pkg.amount_pence)
            construction_remainder -= pkg.amount_pence
        add_to_bucket(
            construction_buckets, resolved_phase_id(None, "construction", network), construction_remainder,
        )

        # Professional and statutory: every fee line (other than an untagged
        # prior_approval, carved out per line above) joins its resolved
        # phase's bucket in its own category. The buckets across both
        # categories sum to compute_cost_plan's own professional/statutory
        # totals exactly, since every fee line is accounted for exactly once
        # -- either the month-0 carve-out or a bucket.
        professional_buckets: dict[str, int] = {}
        statutory_buckets: dict[str, int] = {}
        for fee in cost_plan.fees:
            if fee.code == "prior_approval" and fee.phase_id is None:
                uses[0].statutory_pence += fee.amount_pence
                continue
            bucket = professional_buckets if fee.category == "professional" else statutory_buckets
            add_to_bucket(bucket, resolved_phase_id(fee.phase_id, fee.category, network), fee.amount_pence)

        for pid, total in construction_buckets.items():
            place_in_phase(total, pid, lambda m, v: setattr(
                uses[m], "construction_pence", uses[m].construction_pence + v,
            ))
        for pid, total in professional_buckets.items():
            place_in_phase(total, pid, lambda m, v: setattr(
                uses[m], "professional_pence", uses[m].professional_pence + v,
            ))
        for pid, total in statutory_buckets.items():
            place_in_phase(total, pid, lambda m, v: setattr(
                uses[m], "statutory_pence", uses[m].statutory_pence + v,
            ))

        # Sec 18.10: a derived block is only ever produced for a document
        # that asked for one. A cycle has no dates to report -- validation.py
        # hard-errors it, so `programme` stays None rather than publishing a
        # half-formed derivation to an unvalidated caller.
        if derivation.cycle is None:
            programme_result = ScheduleProgramme(
                finish_month=derivation.finish_month,
                critical_path=derivation.critical_path,
                phases=derivation.phases,
            )
    else:
        uses[0].statutory_pence += prior_approval

        if legacy_programme is None:
            # auto windows -- calc 2.1.0 behaviour, byte-identical (spec Sec 6)
            if term == 1:
                uses[0].construction_pence = construction_total
                uses[0].professional_pence = professional_total
                uses[0].statutory_pence += statutory_spread_total
            else:
                construction_window = max(1, term - 2)  # months 1..construction_window
                professional_window = max(1, math.ceil(construction_window / 2))
                construction_spread = spread_straight_line(construction_total, construction_window)
                professional_spread = spread_straight_line(professional_total, professional_window)
                statutory_spread = spread_straight_line(statutory_spread_total, professional_window)
                for i, v in enumerate(construction_spread):
                    uses[min(i + 1, term - 1)].construction_pence += v
                for i, v in enumerate(professional_spread):
                    uses[min(i + 1, term - 1)].professional_pence += v
                for i, v in enumerate(statutory_spread):
                    uses[min(i + 1, term - 1)].statutory_pence += v
        else:
            # explicit programme (spec Sec 6.1); windows validated in
            # validation.py -- the upper clamp is belt-and-braces, mirroring
            # the auto path.
            #
            # The lower `max(..., 0)` has no counterpart in schedule.ts, and
            # is a deliberate language difference rather than a rule
            # difference: JS `uses[-1]` is `undefined` and throws loudly on
            # the very next property access, whereas Python's negative
            # indexing would silently wrap to the END of the list and book
            # the spend in the wrong month. validation.py hard-rejects
            # `start_offset < 0`, so this is unreachable for any document
            # that passes validation; it exists so the unvalidated path
            # degrades to a defined, in-range placement (totals still
            # reconcile) instead of a silently wrong one.
            def place(pkg: ProgrammePackage, total: int, field_name: str) -> None:
                for i, v in enumerate(spread_by_curve(total, pkg.duration_months, pkg.curve)):
                    target = uses[min(max(pkg.start_offset + i, 0), term - 1)]
                    setattr(target, field_name, getattr(target, field_name) + v)

            place(legacy_programme.packages.construction, construction_total, "construction_pence")
            place(legacy_programme.packages.professional, professional_total, "professional_pence")
            place(legacy_programme.packages.statutory, statutory_spread_total, "statutory_pence")

    # R12 spec Sec 18.6. `resolve_anchor_month` is the single resolution rule
    # for sales_phasing tranches and refinance: an anchor resolves against the
    # phase's derived start; `anchor=None` (the migration default) keeps
    # `month_offset` exactly as before, so every stored document's receipts
    # land where they land today. Recomputed here -- rather than threaded out
    # of the network branch above -- because derive_phases is pure and cheap
    # over a handful of phases, and this keeps that branch untouched.
    exit_timing_derivation = derive_phases(network) if network is not None else None

    def resolve_anchor_month(anchor: PhaseAnchor | None, month_offset: int) -> int:
        if anchor is None:
            return month_offset
        # Defensive, mirroring the placement clamps above: unreachable for any
        # document that passes validation -- an anchor naming an absent
        # phase, or a cyclic network, are hard validation errors owned by
        # validation.py. Degrades to the entered `month_offset` rather than
        # crashing an unvalidated caller.
        if exit_timing_derivation is None or exit_timing_derivation.cycle is not None:
            return month_offset
        dp = exit_timing_derivation.by_id.get(anchor.phase_id)
        return dp.start_month + anchor.offset_months if dp is not None else month_offset

    # Exit: which units sell?
    route = inputs.exit_strategy.route
    retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
    if route == "retain_all":
        sold_units: list[ProposedUnit] = []
    elif route == "sell_all":
        sold_units = list(units)
    else:
        sold_units = [u for u in units if u.id not in retained_ids]
    # R9 spec Sec 15.5: ancillary sells with its unit. Summing internal value
    # alone here would make GDV and gross receipts disagree by the ancillary
    # total.
    gross_sales = sum(u.estimated_value_pence + unit_ancillary_value_pence(u) for u in sold_units)
    gdv = calculate_gdv(units)
    retained_value = gdv - gross_sales

    agent_fee = money_round((gross_sales * inputs.exit_strategy.selling_agent_fee_pct) / 100)
    selling_legal = inputs.exit_strategy.selling_legal_fee_pence if len(sold_units) > 0 else 0
    sales_phasing = getattr(inputs, "sales_phasing", None)
    # R13b spec Sec 22.2/22.3. The sold set's (id, gross) pairs -- value plus
    # ancillary, the same figure gross_sales summed above -- handed to the pure
    # module so gdv and receipts stay equal by construction.
    unit_sales = compute_unit_sales(
        inputs, term, resolve_anchor_month,
        [(u.id, u.estimated_value_pence + unit_ancillary_value_pence(u)) for u in sold_units],
    )
    if gross_sales > 0:
        if unit_sales is not None:
            # Sec 22.3: accumulate (+=), never the single-disposal arm's full
            # replace. A released deposit is gross_sale_pence in the exchange
            # month; the balance and both costs land at completion.
            for row in unit_sales["units"]:
                if row["deposit_released_pence"] > 0 and row["exchange_month"] is not None:
                    receipts[row["exchange_month"]].gross_sale_pence += row["deposit_released_pence"]
                c = row["completion_month"]
                receipts[c].gross_sale_pence += row["gross_pence"] - row["deposit_released_pence"]
                receipts[c].agent_fee_pence += row["agent_fee_pence"]
                receipts[c].selling_legal_pence += row["legal_fee_pence"]
        elif sales_phasing is None:
            # calc 2.2.0 behaviour, byte-identical: single disposal in the final
            # month (spec Sec 4.4).
            receipts[term - 1] = MonthReceipts(
                gross_sale_pence=gross_sales, agent_fee_pence=agent_fee,
                selling_legal_pence=selling_legal, vat_reclaim_pence=0,
            )
        else:
            # Spec Sec 4.4.1: tranche split with final-tranche residue absorption;
            # selling costs apportioned pro-rata by tranche gross, final tranche
            # absorbs. Month clamps are belt-and-braces -- validation.py owns the
            # real rules.
            trs = sales_phasing.tranches
            gross_allocated = 0
            agent_allocated = 0
            legal_allocated = 0
            for i, tr in enumerate(trs):
                last = i == len(trs) - 1
                gross = (
                    gross_sales - gross_allocated if last
                    else money_round((gross_sales * tr.pct_of_gross_receipts) / 100)
                )
                agent = (
                    agent_fee - agent_allocated if last
                    else money_round((agent_fee * gross) / gross_sales)
                )
                legal = (
                    selling_legal - legal_allocated if last
                    else money_round((selling_legal * gross) / gross_sales)
                )
                gross_allocated += gross
                agent_allocated += agent
                legal_allocated += legal
                anchor = getattr(tr, "anchor", None)
                m = min(max(0, math.floor(resolve_anchor_month(anchor, tr.month_offset))), term - 1)
                receipts[m].gross_sale_pence += gross
                receipts[m].agent_fee_pence += agent
                receipts[m].selling_legal_pence += legal

    # R13 spec Sec 19.6. Computed here -- after resolve_anchor_month exists and
    # after receipts are fully built by the exit/sales section above -- because
    # Sec 19's whole point is that it runs in ONE direction: it must not see a
    # ledger balance, and nothing downstream may feed a figure back into it.
    # Placed AFTER the exit/sales section deliberately: that section's
    # single-disposal arm does a full `receipts[term - 1] = MonthReceipts(...)`
    # replace, which would silently wipe an NOI figure written before it.
    investment_case = compute_investment_case(inputs, term, resolve_anchor_month)
    if investment_case is not None:
        for m, mo in enumerate(investment_case["months"]):
            receipts[m].net_operating_income_pence = mo["noi_pence"]

    # Spec Sec 4.5 net refinance proceeds -- wired into the ledger by engine.py.
    refinance_input = getattr(inputs, "refinance", None)
    refinance = None
    if refinance_input is not None:
        legal = refinance_input.legal_costs_pence
        # R13 spec Sec 19.4/Sec 19.5. A non-None investment case SUPERSEDES the
        # explicit pair: the advance is the sized quantum, and the arrangement
        # fee may be a percentage of it. investment_value_pence/ltv_pct are
        # None on that path (Sec 19.7 rule 5), which is why this branches
        # rather than multiplying.
        if investment_case is not None:
            quantum = investment_case["takeout"]["quantum_pence"]
            basis = getattr(refinance_input, "arrangement_fee_basis", "fixed_pence")
            fee = (
                money_round((quantum * getattr(refinance_input, "arrangement_fee_pct", 0)) / 100)
                if basis == "pct_of_quantum"
                else refinance_input.arrangement_fee_pence
            )
            net_proceeds_pence = quantum - fee - legal
        else:
            net_proceeds_pence = (
                money_round(
                    ((refinance_input.investment_value_pence or 0)
                     * (refinance_input.ltv_pct or 0)) / 100,
                )
                - refinance_input.arrangement_fee_pence - legal
            )
        refinance = ScheduleRefinance(
            month=min(max(0, math.floor(resolve_anchor_month(
                getattr(refinance_input, "anchor", None), refinance_input.month_offset,
            ))), term - 1),
            net_proceeds_pence=net_proceeds_pence,
        )

    # Sec 22.2: totals are sum-of-units on the per-unit path.
    selling_costs = (
        unit_sales["totals"]["agent_fees_pence"] + unit_sales["totals"]["legal_fees_pence"]
        if unit_sales is not None
        else (agent_fee + selling_legal if gross_sales > 0 else 0)
    )

    # R11 spec Sec 17.6. VAT is computed from the finished spend profile and
    # written back onto it. One pass, and strictly one-directional: nothing
    # above this line reads VAT, so a VAT figure can never feed a base that
    # feeds VAT (Sec 17.5). cost_before_finance_ex_selling_pence below must NOT
    # gain VAT -- irrecoverable VAT enters cost-before-finance in Task 8, at the
    # metrics layer, on its own line.
    vat = compute_vat(inputs, cost_plan, _PartialSchedule(term_months=term, uses=uses, receipts=receipts))
    for m, mo in enumerate(vat.months):
        uses[m].vat_pence = mo.incurred_pence
        receipts[m].vat_reclaim_pence = mo.reclaimed_pence

    # R13 spec Sec 19.6, closing Sec 18.10 limitation 9. See
    # ScheduleResolvedExitMonths's own docstring for the full rationale.
    resolved_exit_months = ScheduleResolvedExitMonths(
        tranches=(
            []
            if sales_phasing is None
            else [
                min(max(0, math.floor(resolve_anchor_month(
                    getattr(tr, "anchor", None), tr.month_offset,
                ))), term - 1)
                for tr in sales_phasing.tranches
            ]
        ),
        refinance=None if refinance is None else refinance.month,
    )

    return Schedule(
        term_months=term,
        uses=uses,
        receipts=receipts,
        vat=vat,
        refinance=refinance,
        programme=programme_result,
        # R13 spec Sec 19.6. None exactly when the INPUT investment_case is
        # None -- no block is synthesised for a document that never asked for
        # one. Computed once, above, and republished (never recomputed) onto
        # AppraisalResultV2 by Task 11.
        investment_case=investment_case,
        # R13b spec Sec 22.6. Computed once, above, and republished (never
        # recomputed) onto AppraisalResultV2. None exactly when the INPUT
        # unit_sales is None.
        unit_sales=unit_sales,
        resolved_exit_months=resolved_exit_months,
        # R14 spec Sec 4.2(b). Computed once on the cost plan, republished here
        # so the ledger reads one figure and never re-derives it.
        lender_eligible_ratio=cost_plan.lender_eligible_ratio,
        totals=ScheduleTotals(
            acquisition_pence=acquisition_total,
            construction_pence=construction_total,
            professional_pence=professional_total,
            statutory_pence=statutory_total,
            selling_costs_pence=selling_costs,
            gross_sales_pence=gross_sales,
            gdv_pence=gdv,
            retained_value_pence=retained_value,
            cost_before_finance_ex_selling_pence=(
                acquisition_total + construction_total + professional_total + statutory_total
            ),
            vat_pence=vat.total_input_vat_pence,
            vat_reclaim_pence=vat.total_reclaimed_pence,
            irrecoverable_vat_pence=vat.total_irrecoverable_pence,
            # R13 spec Sec 19.5/Sec 19.6. Republished from
            # investment_case["totals"]["noi_pence"] -- the schedule-wide sum
            # already computed once inside compute_investment_case -- never
            # re-summed here. 0 on the None path.
            net_operating_income_pence=(
                0 if investment_case is None else investment_case["totals"]["noi_pence"]
            ),
        ),
    )
