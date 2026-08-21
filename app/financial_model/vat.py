"""Mirror of frontend/src/lib/model/vat.ts (R11, spec Sec 17).

VAT: treatment by charge category, an optional per-line override, the HMRC
return cycle, and the engine that turns them into cash. The pydantic INPUT
models live in types.py (VatTreatment, VatOverride, PurchaseVatInputs,
VatInputs -- same split as areas.py / cost_plan.py). This module re-exports
DEFAULT_VAT, default_vat_treatments and VAT_CHARGE_CATEGORIES so callers have
one import site, and holds `resolve_vat_treatment` -- the ONLY function
anywhere that may read `vat.treatments` or a `vat_override`, mirroring
resolveVatTreatment in vat.ts. See Sec 17.2 and the single-accessor guard in
eslint.config.js / tests/test_accessor_guard.py.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

# has_facility: ruling R20 -- the ONE derivation of "does this deal have a
# facility?", owned by the ledger, which is what spends the fees this gate
# governs. engine.py is safe to import at runtime (see the note below).
from .engine import has_facility, money_round
from .types import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    EvidenceStatus,
    PurchaseVatInputs,
    RecoveryBasis,
    VatChargeCategory,
    VatInputs,
    VatOverride,
    default_vat_treatments,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    # Type-only, exactly as vat.ts's `import type` of CostPlanResult and
    # Schedule is erased at compile time. A RUNTIME import of schedule.py here
    # would become a cycle the moment the schedule task makes schedule.py call
    # compute_vat. engine.py is safe to import at runtime: it imports only
    # types.py itself.
    from .cost_plan import CostPlanResult

__all__ = [
    "DEFAULT_VAT",
    "VAT_CHARGE_CATEGORIES",
    "default_vat_treatments",
    "resolve_vat_treatment",
    "is_purchase_vat_chargeable",
    "chargeable_consideration_pence",
    "ResolvedVatTreatment",
    "VatReturnPeriod",
    "vat_return_periods",
    "VatChargeLine",
    "VatMonthLine",
    "VatResult",
    "spread_pro_rata",
    "compute_vat",
]


@dataclass
class ResolvedVatTreatment:
    rate_pct: float
    recoverable_pct: float
    recovery_basis: RecoveryBasis
    evidence_status: EvidenceStatus
    source: str  # 'category' | 'override'


_INERT = ResolvedVatTreatment(
    rate_pct=0, recoverable_pct=0, recovery_basis="unconfirmed",
    evidence_status="unconfirmed", source="category",
)


def resolve_vat_treatment(
    vat: VatInputs,
    category: VatChargeCategory,
    override: VatOverride | None,
) -> ResolvedVatTreatment:
    """THE single read site for `vat.treatments` and for any `vat_override`.
    Adding a second one is a lint failure, not a review comment."""
    if not vat.registered:
        return _INERT
    row = next((t for t in vat.treatments if t.category == category), None)
    if row is None:
        return _INERT
    if override is None:
        return ResolvedVatTreatment(
            rate_pct=row.rate_pct,
            recoverable_pct=row.recoverable_pct,
            recovery_basis=row.recovery_basis,
            evidence_status=row.evidence_status,
            source="category",
        )
    return ResolvedVatTreatment(
        rate_pct=override.rate_pct,
        recoverable_pct=override.recoverable_pct,
        recovery_basis=override.recovery_basis,
        # Evidence stays a category fact. An override that could silently
        # claim 'confirmed' would blind the Sec 17.10 draft gate.
        evidence_status=row.evidence_status,
        source="override",
    )


@dataclass(frozen=True)
class VatReturnPeriod:
    index: int
    first_month: int
    last_month: int
    # None where the reclaim falls outside the modelled term. Never clamped
    # into the final month -- that would manufacture a receipt (Sec 17.4).
    reclaim_month: int | None


def vat_return_periods(vat: VatInputs, term_months: int) -> list[VatReturnPeriod]:
    """Sec 17.4. The first return period covers months 0..first_period_end_month
    inclusive; subsequent periods are one month (monthly) or three months
    (quarterly). VAT incurred anywhere in a period is reclaimed in a single
    amount at period_end + repayment_lag_months. A reclaim falling after the
    final modelled month is reported as None, never clamped into the final
    month -- that would manufacture a receipt the borrower has not had."""
    if not vat.registered:
        return []
    term = max(1, int(term_months))
    length = 3 if vat.return_frequency == "quarterly" else 1
    lag = max(0, int(vat.repayment_lag_months))
    periods: list[VatReturnPeriod] = []
    first = 0
    end = max(0, int(vat.first_period_end_month))
    index = 0
    while first <= term - 1:
        last = min(end, term - 1)
        reclaim = last + lag
        periods.append(VatReturnPeriod(
            index=index,
            first_month=first,
            last_month=last,
            reclaim_month=reclaim if reclaim <= term - 1 else None,
        ))
        first = last + 1
        end = last + length
        index += 1
    return periods


def is_purchase_vat_chargeable(purchase: PurchaseVatInputs) -> bool:
    """Sec 17.7, stated as one biconditional rather than three branches so
    that 'unconfirmed' needs no separate clause: an unconfirmed TOGC is
    charged, which is the prudent case. Where TOGC applies, VAT is nil
    regardless of the option to tax -- that is the whole effect of a TOGC
    (Sec 17.3)."""
    return purchase.vendor_opted_to_tax and purchase.togc_treatment != "applies"


class ConsiderationInputs(Protocol):
    """The minimum a chargeable consideration needs: the acquisition block, and
    the document's VAT block.

    Structural rather than nominal, mirroring vat.ts's ConsiderationInputs:
    migrate.py's v1 bootstrap computes an acquisition cost from a half-built
    document -- there is no CalculatorInputs object in existence at that point,
    because the finance block this very figure feeds has not been translated
    yet.

    Ruling R28: ``vat`` is declared REQUIRED-but-nullable, not optional. A
    caller that has no VAT block must pass ``vat=None`` explicitly, so "this
    document has no VAT block" is a declaration a reader and a grep can both
    see, rather than an absence that could equally be an oversight -- the TS
    twin makes the same shape a `tsc` error. The lookup below is still a
    getattr, because a pre-v8 PYDANTIC model genuinely does not carry the
    attribute; the declaration governs the hand-built callers, which are the
    ones that could launder an exclusive price through an intermediate object.
    """

    acquisition: Any
    vat: VatInputs | None


def chargeable_consideration_pence(inputs: ConsiderationInputs) -> int:
    """THE single site that decides what the acquisition tax is charged on.

    SDLT, LBTT and LTT are all charged on the VAT-INCLUSIVE consideration
    (Sec 17.7), and every pre-R11 call site passed the exclusive price. Mirrors
    chargeableConsiderationPence in vat.ts; the TS twin returns a branded
    ChargeableConsideration, which Python has no equivalent for -- the Python
    half of the guard is the AST scan in tests/test_accessor_guard.py.
    """
    price = inputs.acquisition.purchase_price_pence
    # Read structurally, exactly as compute_vat does: a pre-v8 document has no
    # vat block at all and its consideration is simply its price.
    vat = getattr(inputs, "vat", None)
    if vat is None or not is_purchase_vat_chargeable(vat.purchase):
        return price
    treatment = resolve_vat_treatment(vat, "acquisition", None)
    return price + money_round((price * treatment.rate_pct) / 100)


# ---------------------------------------------------------------------------
# Sec 17.5 -- the engine, and it runs in ONE direction only.
#
# compute_vat reads the cost plan and the spend profile. NOTHING in the cost
# plan reads VAT: no fee basis, no contingency base and no construction total
# includes a VAT figure. That is what makes a cycle impossible by construction
# rather than detected -- there is no ordering to get wrong, no iteration and
# no cycle detection.
#
# The direct consequence, and it reads wrong until you have held the argument:
# irrecoverable VAT is NOT folded back into construction_cost_pence. It becomes
# its own line, which the metrics task adds to cost-before-finance. If anything
# here ever wants to adjust a cost total, that is the defect this design exists
# to prevent.
# ---------------------------------------------------------------------------


@dataclass
class VatChargeLine:
    """Mirrors VatChargeLine in vat.ts, field for field and in order.

    One resolved charge. Rounding happens ONCE here, per line, and the months
    are spread from the rounded figure -- three charges at 20% are not one
    charge at 60%, the same rule the cost plan already follows for contingency
    classes ("Sum of ROUNDED figures", Sec 16)."""

    # Stable within a run: 'category:<name>', 'package:<id>' or 'fee:<id>'.
    id: str
    category: VatChargeCategory
    label: str
    # Whichever precedence resolve_vat_treatment applied.
    source: str  # 'category' | 'override'
    # VAT-exclusive base. Never includes a VAT figure, and never double counts:
    # where a package or fee line is overridden, its amount is subtracted from
    # its category's base and carried on the override's own line instead.
    net_base_pence: int
    rate_pct: float
    recoverable_pct: float
    recovery_basis: RecoveryBasis
    evidence_status: EvidenceStatus
    vat_pence: int
    recoverable_pence: int
    # charged - recoverable, so the rounding residue lands in irrecoverable
    # rather than being lost. This is the figure that becomes a real cost.
    irrecoverable_pence: int


@dataclass
class VatMonthLine:
    """Mirrors VatMonthLine in vat.ts, field for field and in order."""

    month: int
    incurred_pence: int
    reclaimed_pence: int
    # Cumulative incurred - cumulative reclaimed. The saw-tooth a lender sizes
    # a VAT facility against (Sec 17.4).
    carry_pence: int


@dataclass
class VatResult:
    """Mirrors VatResult in vat.ts, field for field and in order."""

    registered: bool
    charges: list[VatChargeLine]
    periods: list[VatReturnPeriod]
    months: list[VatMonthLine]
    total_input_vat_pence: int
    total_recoverable_pence: int
    total_irrecoverable_pence: int
    total_reclaimed_pence: int
    # Reclaims falling after the final modelled month. Reported, never credited
    # to the ledger -- clamping them into the final month would manufacture a
    # receipt the borrower has not had (Sec 17.4).
    receivable_at_maturity_pence: int
    peak_carry_pence: int
    peak_carry_month: int | None
    # Disclosure of the acquisition line's VAT, so Sec 17.7's chargeable
    # consideration is visible rather than buried in a tax figure.
    purchase_vat_pence: int
    # Task 12 fix round 1 (spec Sec 17.10, ruling R42). is_purchase_vat_chargeable's
    # own answer, disclosed so a consumer of the RESULT reads whether purchase
    # VAT is actually due off the engine rather than re-deriving it from
    # vat.purchase itself. Always False when the engine is inert.
    purchase_vat_chargeable: bool
    # The purchase leg's OWN evidence status -- whether vendor_opted_to_tax /
    # togc_treatment are themselves evidenced. Deliberately distinct from any
    # treatments row's evidence_status, which is a separate fact about a
    # category's rate/recoverable_pct: compute_vat derives the acquisition
    # charge line's evidence_status solely from resolve_vat_treatment's read of
    # treatments, and nothing ties the two together (spec Sec 17.10, ruling R42).
    purchase_evidence_status: EvidenceStatus


def spread_pro_rata(total: int, weights: Sequence[float]) -> list[int]:
    """Integer-pence pro-rata allocation summing EXACTLY to ``total``.

    Every month but the last non-zero weight takes ``money_round(total*w_i/sum
    w)``; the last non-zero weight absorbs the residue, mirroring
    spread_straight_line and spread_by_curve (spec Sec 6.1's invariant). The
    rounding is ``money_round`` (half-up toward +inf) and NEVER builtin
    ``round``, which is banker's rounding and silently disagrees with JS
    Math.round.

    When ``sum(weights) == 0`` it returns all zeros -- this function has no
    month to prefer, so it makes no choice. The CALLER decides what an
    unplaceable charge means: compute_vat falls back to month 0 (ruling R15),
    because a charged penny the months never carry is never funded by the
    ledger while Task 8 still puts its irrecoverable part into
    cost-before-finance -- a cost in the profit line no source ever paid for."""
    out = [0] * len(weights)
    total_weight = sum(weights)
    if total_weight == 0:
        return out
    last = -1
    for i, w in enumerate(weights):
        if w != 0:
            last = i
    allocated = 0
    for i, w in enumerate(weights):
        if i == last:
            continue
        out[i] = money_round((total * w) / total_weight)
        allocated += out[i]
    out[last] = total - allocated
    return out


_CATEGORY_LABEL: dict[str, str] = {
    "acquisition": "Purchase price",
    "construction": "Construction",
    "professional": "Professional fees",
    "statutory": "Statutory costs",
    "selling": "Selling costs",
    # Sec 17.3: a FINANCE-side charge. It must never be swept into the
    # professional total -- that moves money between two separately-reported,
    # separately-spread lines while every grand total stays correct, exactly
    # the trap FEE_CODE_CATEGORY's building_control comment records.
    "lender_ancillary": "Lender ancillary fees",
}


def _charge_line(
    line_id: str,
    category: str,
    label: str,
    resolved: ResolvedVatTreatment,
    net_base: int,
) -> VatChargeLine:
    vat_pence = money_round((net_base * resolved.rate_pct) / 100)
    recoverable = money_round((vat_pence * resolved.recoverable_pct) / 100)
    return VatChargeLine(
        id=line_id,
        category=category,  # type: ignore[arg-type]
        label=label,
        source=resolved.source,
        net_base_pence=net_base,
        rate_pct=resolved.rate_pct,
        recoverable_pct=resolved.recoverable_pct,
        recovery_basis=resolved.recovery_basis,
        evidence_status=resolved.evidence_status,
        vat_pence=vat_pence,
        recoverable_pence=recoverable,
        irrecoverable_pence=vat_pence - recoverable,
    )


def _inert_vat(term_months: int) -> VatResult:
    return VatResult(
        registered=False,
        charges=[],
        periods=[],
        months=[
            VatMonthLine(month=m, incurred_pence=0, reclaimed_pence=0, carry_pence=0)
            for m in range(term_months)
        ],
        total_input_vat_pence=0,
        total_recoverable_pence=0,
        total_irrecoverable_pence=0,
        total_reclaimed_pence=0,
        receivable_at_maturity_pence=0,
        peak_carry_pence=0,
        peak_carry_month=None,
        purchase_vat_pence=0,
        # An inert engine charges nothing, so False here is structural -- this
        # function doesn't even receive `vat` -- and it is what makes
        # "registered: false can never gate" true by construction.
        purchase_vat_chargeable=False,
        purchase_evidence_status="unconfirmed",
    )


def compute_vat(inputs, cost_plan: CostPlanResult, schedule) -> VatResult:
    """Sec 17.5. Charges, timing and recovery -- strictly downstream of the
    cost plan. Mirrors computeVat in vat.ts operation for operation.

    ``schedule`` is only ever read for ``term_months``, ``uses`` and
    ``receipts`` -- the TS signature states that as a
    ``Pick<Schedule, 'term_months' | 'uses' | 'receipts'>`` (ruling R2), so the
    schedule task can call this with a part-built object and there is no way to
    reach ``schedule.vat`` from inside the function that produces it. Python
    takes it structurally for the same reason.

    Timing follows each base's own spend months, read from the schedule rather
    than assumed: acquisition and lender-ancillary VAT land where the schedule
    puts those uses (month 0), construction/professional/statutory follow their
    own ``uses`` curve, and selling VAT follows ``receipts``, weighted by each
    month's ``agent_fee_pence + selling_legal_pence``. An overridden line
    follows its own CATEGORY's curve -- R11 does not model per-package
    programme timing; R12's dated programme does."""
    term = max(1, math.floor(schedule.term_months))
    # Read structurally, exactly as _cost_plan_of reads the cost plan: a pre-v8
    # document has no `vat` block at all and must be inert, not raise.
    vat = getattr(inputs, "vat", None)
    if vat is None or not vat.registered:
        return _inert_vat(term)

    def weights_from(pick) -> list[int]:
        return [
            pick(schedule.uses[m]) if m < len(schedule.uses) else 0
            for m in range(term)
        ]

    selling_weights: list[int] = [
        (schedule.receipts[m].agent_fee_pence + schedule.receipts[m].selling_legal_pence)
        if m < len(schedule.receipts) else 0
        for m in range(term)
    ]
    # Month 0 -- where the ledger capitalises the ancillary fees, and the
    # fallback for any charge whose own base has no spend months (ruling R15).
    month_zero_weights: list[int] = [1 if m == 0 else 0 for m in range(term)]
    weights: dict[str, list[int]] = {
        "acquisition": weights_from(lambda u: u.acquisition_pence),
        "construction": weights_from(lambda u: u.construction_pence),
        "professional": weights_from(lambda u: u.professional_pence),
        "statutory": weights_from(lambda u: u.statutory_pence),
        "selling": selling_weights,
        "lender_ancillary": month_zero_weights,
    }

    # Sec 17.3 and ruling R13. Interest and the arrangement, exit,
    # non-utilisation and extension fees are exempt financial services and never
    # bear VAT; lender_ancillary -- broker, lender legal, valuation, monitoring
    # surveyor -- is the ONLY finance-side base, and there is no code path from
    # here to an interest or arrangement-fee figure.
    #
    # The base comes from inputs.finance, NOT from
    # MonthUses.lender_ancillary_fees_pence: that schedule field is initialised
    # to 0 in _empty_uses() and never assigned by build_schedule, because the
    # ledger computes and capitalises these fees itself. Reading it would leave
    # this charge structurally zero forever -- R10's "recorded but not live"
    # shape. finance is an INPUT, so the one-direction rule is intact.
    #
    # Ruling R20: gated by the ledger's OWN gate, has_facility from engine.py,
    # rather than by a second derivation of the same condition. A deal with no
    # facility pays no lender fees, so it must bear no VAT on them, and that
    # must stay true if the gate ever gains a condition.
    finance = inputs.finance
    lender_ancillary_base = (
        finance.broker_fee_pence + finance.lender_legal_fee_pence
        + finance.valuation_fee_pence + finance.monitoring_surveyor_fee_pence
    ) if has_facility(finance) else 0

    # The per-line overrides live on the INPUT cost plan; the computed amounts
    # live on the result. Matched by id so a pct-based fee is charged on the
    # amount the cost plan actually resolved, not on its stale amount_pence.
    plan = getattr(inputs, "cost_plan", None)
    package_overrides: dict[str, VatOverride] = {}
    fee_overrides: dict[str, VatOverride] = {}
    if plan is not None:
        for p in plan.packages:
            if p.vat_override is not None:
                package_overrides[p.id] = p.vat_override
        for f in plan.fee_lines:
            if f.vat_override is not None:
                fee_overrides[f.id] = f.vat_override

    def category_line(cat: str, base: int) -> VatChargeLine:
        return _charge_line(
            f"category:{cat}", cat, _CATEGORY_LABEL[cat],
            resolve_vat_treatment(vat, cat, None), base,  # type: ignore[arg-type]
        )

    # --- acquisition: purchase VAT, and only purchase VAT (Sec 17.7) ---
    # Computed ONCE and disclosed on the result (purchase_vat_chargeable)
    # rather than re-derived by a consumer -- ruling R42.
    purchase_vat_chargeable = is_purchase_vat_chargeable(vat.purchase)
    purchase_base = (
        inputs.acquisition.purchase_price_pence if purchase_vat_chargeable else 0
    )

    # --- construction: the category base is net of every overridden package ---
    # Gated on detailed mode, mirroring cost_plan.py's own base_build branch:
    # compute_cost_plan returns `packages` populated in EITHER mode but folds
    # their amounts into construction_total_pence only in detailed mode.
    # Subtracting unconditionally would drive a headline document's category
    # base negative -- negative VAT, negative months, and a negative
    # contribution to total_irrecoverable_pence that Task 8 adds to
    # cost-before-finance. validation.py hard-errors on headline-with-packages,
    # so this is latent, not live; the unvalidated path still has to degrade to
    # something defined rather than to silently negative money, exactly as
    # schedule.py records for its own clamp.
    detailed = cost_plan.mode == "detailed"
    package_lines: list[VatChargeLine] = []
    overridden_packages = 0
    for p in (cost_plan.packages if detailed else []):
        override = package_overrides.get(p.id)
        if override is None:
            continue
        overridden_packages += p.amount_pence
        package_lines.append(_charge_line(
            f"package:{p.id}", "construction", p.label if p.label != "" else p.code,
            resolve_vat_treatment(vat, "construction", override), p.amount_pence,
        ))

    # --- fees: same subtraction, per fee CATEGORY ---
    professional_lines: list[VatChargeLine] = []
    statutory_lines: list[VatChargeLine] = []
    overridden_professional = 0
    overridden_statutory = 0
    for f in cost_plan.fees:
        override = fee_overrides.get(f.id)
        if override is None:
            continue
        cat = "statutory" if f.category == "statutory" else "professional"
        line = _charge_line(
            f"fee:{f.id}", cat, f.label if f.label != "" else f.code,
            resolve_vat_treatment(vat, cat, override), f.amount_pence,  # type: ignore[arg-type]
        )
        if cat == "statutory":
            overridden_statutory += f.amount_pence
            statutory_lines.append(line)
        else:
            overridden_professional += f.amount_pence
            professional_lines.append(line)

    acquisition_line = category_line("acquisition", purchase_base)
    charges: list[VatChargeLine] = [
        acquisition_line,
        category_line("construction", cost_plan.construction_total_pence - overridden_packages),
        *package_lines,
        category_line(
            "professional", cost_plan.professional_total_pence - overridden_professional,
        ),
        *professional_lines,
        category_line("statutory", cost_plan.statutory_total_pence - overridden_statutory),
        *statutory_lines,
        category_line("selling", sum(selling_weights)),
        category_line("lender_ancillary", lender_ancillary_base),
    ]

    # Spread each ROUNDED charge line across its base's months. The charged and
    # the recoverable amounts are spread separately over the same weights, so a
    # partly-recoverable line reclaims exactly its recoverable figure.
    incurred = [0] * term
    recoverable_by_month = [0] * term
    for c in charges:
        if c.vat_pence == 0 and c.recoverable_pence == 0:
            continue
        # Ruling R15: a base with no spend months places its VAT in month 0
        # rather than nowhere, so sum(m.incurred_pence) == total_input_vat_pence
        # holds for every document and the ledger funds every penny charged.
        own = weights[c.category]
        w = month_zero_weights if sum(own) == 0 else own
        inc = spread_pro_rata(c.vat_pence, w)
        rec = spread_pro_rata(c.recoverable_pence, w)
        for m in range(term):
            incurred[m] += inc[m]
            recoverable_by_month[m] += rec[m]

    # Sec 17.4: input VAT incurred anywhere in a period is reclaimed in ONE
    # amount at period_end + repayment_lag_months. A reclaim landing past the
    # final month is receivable, never clamped into it.
    periods = vat_return_periods(vat, term)
    reclaimed = [0] * term
    receivable = 0
    for p in periods:
        amount = sum(
            recoverable_by_month[m]
            for m in range(p.first_month, min(p.last_month + 1, term))
        )
        if amount == 0:
            continue
        if p.reclaim_month is None:
            receivable += amount
        else:
            reclaimed[p.reclaim_month] += amount

    months: list[VatMonthLine] = []
    cumulative_incurred = 0
    cumulative_reclaimed = 0
    peak_carry = 0
    peak_carry_month: int | None = None
    for m in range(term):
        cumulative_incurred += incurred[m]
        cumulative_reclaimed += reclaimed[m]
        carry = cumulative_incurred - cumulative_reclaimed
        months.append(VatMonthLine(
            month=m,
            incurred_pence=incurred[m],
            reclaimed_pence=reclaimed[m],
            carry_pence=carry,
        ))
        if carry > peak_carry:
            peak_carry = carry
            peak_carry_month = m

    return VatResult(
        registered=True,
        charges=charges,
        periods=periods,
        months=months,
        total_input_vat_pence=sum(c.vat_pence for c in charges),
        total_recoverable_pence=sum(c.recoverable_pence for c in charges),
        total_irrecoverable_pence=sum(c.irrecoverable_pence for c in charges),
        total_reclaimed_pence=sum(reclaimed),
        receivable_at_maturity_pence=receivable,
        peak_carry_pence=peak_carry,
        peak_carry_month=peak_carry_month,
        purchase_vat_pence=acquisition_line.vat_pence,
        purchase_vat_chargeable=purchase_vat_chargeable,
        purchase_evidence_status=vat.purchase.evidence_status,
    )
