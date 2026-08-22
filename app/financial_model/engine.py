"""Port of frontend/src/lib/model/monthly-engine.ts.

Defines ``money_round`` once (port rule #2) for use across the whole package.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .types import EquitySource, FacilityTerms

if TYPE_CHECKING:  # pragma: no cover - avoids a runtime cycle with schedule.py,
    # which imports money_round from this module.
    from .schedule import Schedule


def money_round(x: float) -> int:
    """Half-up toward +inf, matching JS Math.round. Never use Python round()."""
    return math.floor(x + 0.5)


def pct(numerator: float, denominator: float) -> float | None:
    """Percentage to 2 dp; None when the denominator is zero (spec Sec 1.5).

    Moved here from metrics.py in R9 so areas.py can use it without an import
    cycle (metrics.py imports areas.py for the area-bridge output block).
    metrics.py re-exports it, so every existing importer is unaffected.

    Uses money_round (half-up toward +inf, matching JS Math.round), not the
    Python builtin round() (round-half-to-even) -- this is the same rounding
    the pre-move implementation in metrics.py used, so the move is behaviour-
    neutral, and it mirrors pct.ts's Math.round exactly.
    """
    if denominator == 0:
        return None
    return money_round((numerator / denominator) * 10000) / 100


@dataclass
class ModelFlag:
    code: str
    severity: str
    month: int | None
    amount_pence: int | None
    message: str


@dataclass
class LedgerMonth:
    month: int
    uses_total_pence: int
    opening_balance_pence: int
    draw_pence: int
    capitalised_fees_pence: int
    interest_accrued_pence: int
    interest_capitalised_pence: int
    interest_serviced_pence: int
    exit_fee_pence: int
    repayment_pence: int
    closing_balance_pence: int
    undrawn_net_facility_pence: int | None
    facility_headroom_pence: int | None
    interest_reserve_remaining_pence: int | None
    equity_contribution_pence: int
    additional_equity_pence: int
    funding_gap_pence: int
    gross_receipts_pence: int
    net_receipts_pence: int
    # R11 spec Sec 17.6. The VAT reclaimed this month, applied to senior debt in
    # full (ignoring sales_sweep_pct) and before the sales sweep and the Sec 4.5
    # refinance event. Deliberately absent from gross_receipts_pence and
    # net_receipts_pence: it returns a specific advance rather than realising an
    # asset, so no GDV-, LTGDV- or break-even-denominated metric may read it.
    # Where it exceeds the balance plus the exit fee, or where there is no
    # facility, the excess falls into distribution_pence.
    vat_reclaim_pence: int
    # Spec Sec 4.5 -- 0 for every month unless the refinance event fires in it.
    refinance_proceeds_pence: int
    distribution_pence: int


@dataclass
class MonthlyModelTotals:
    interest_pence: int
    arrangement_fee_pence: int
    exit_fee_pence: int
    ancillary_fees_pence: int
    finance_costs_pence: int
    draws_pence: int
    capitalised_fees_pence: int
    equity_contributed_pence: int
    additional_equity_pence: int
    # Spec Sec 4.5/Sec 7: the slice of additional_equity_pence injected by the
    # refinance event's shortfall or negative-net-proceeds branches. It funds a
    # facility redemption (financing-side), not a project cost, so reconcile()
    # excludes it from Sec 7's sources-and-uses identity while it still counts
    # toward additional_equity_pence, the additional_equity_required flag, equity
    # contributed, and the equity cash-flow vector. Always 0 when refinance is None.
    refinance_shortfall_equity_pence: int
    funding_gap_pence: int
    distributions_pence: int
    repayments_pence: int
    # R11 spec Sec 17.6. The gross VAT cycle as the LEDGER saw it: vat_pence is
    # the VAT funded through the per-month loop (part of uses_total_pence),
    # vat_reclaim_pence the VAT swept back out. Disclosure only -- neither is a
    # finance cost, and vat_reclaim_pence appears on neither side of Sec 7's
    # sources-and-uses identity.
    vat_pence: int
    vat_reclaim_pence: int


@dataclass
class RedemptionEntry:
    month: int
    balance_pence: int


@dataclass
class MonthlyModel:
    months: list[LedgerMonth]
    totals: MonthlyModelTotals
    peak_debt_pence: int
    peak_debt_month: int | None
    day_one_advance_pence: int
    committed_net_facility_pence: int
    committed_gross_facility_pence: int
    senior_outstanding_at_maturity_pence: int
    # Spec Sec 5.11: the disposal month's senior balance immediately before sale
    # receipts are applied. None for cash deals (no senior facility) and for
    # schedules with no disposal (e.g. exit_strategy.route == "retain_all").
    redemption_balance_at_disposal_pence: int | None
    # Spec Sec 4.4.1 declining redemption schedule: one entry per disposal month,
    # balance captured immediately before that month's receipts. Empty for cash
    # deals and no-disposal schedules. The scalar above equals the last entry.
    redemption_schedule: list[RedemptionEntry]
    flags: list[ModelFlag]
    # Developer equity cash-flow vector, one entry per month (- out, + in).
    equity_cashflows_pence: list[int] = field(default_factory=list)


# R11 ruling R20. "Does this deal have a facility?" -- the single derivation of that
# fact, owned by the module that spends it. The ledger gates the arrangement and
# ancillary fees on it; compute_vat (vat.py) gates the lender_ancillary VAT base on
# it, because VAT must not be charged on a fee no one pays. Both call THIS function:
# derived twice, the two would drift the moment the gate gained a condition, and no
# total would move to say so. Pinned by the "derives the facility gate ONCE" test,
# which asserts the VAT base and the ledger's ancillary fees in one assertion.
def has_facility(finance: FacilityTerms) -> bool:
    return (
        finance.funding_source != "cash"
        and (finance.committed_net_facility_pence or 0) > 0
    )


# Exported (no leading underscore) for breakeven.py's caller (metrics.py): the exit fee due
# on redeeming a given balance is a pure function of the facility's basis terms -- it never
# depends on the hypothetical sale price used by the senior break-even solver (spec Sec 5.11).
def exit_fee_amount(
    finance: FacilityTerms, gross_facility: int, peak_debt: int, redemption_balance: int,
) -> int:
    if finance.exit_fee_basis == "peak_debt":
        base = peak_debt
    elif finance.exit_fee_basis == "redemption_balance":
        base = redemption_balance
    else:
        base = gross_facility
    return money_round((base * finance.exit_fee_pct) / 100)


# Spec Sec 4.2(c): draws are also capped by gross facility headroom after projected
# interest, so the closing balance this month cannot exceed the committed gross
# facility. Rolled-up interest compounds on the drawn balance, so the cap is solved
# backwards through the month's own interest accrual; serviced interest leaves the
# balance flat, so no such back-solve is needed.
def _gross_headroom_cap(
    gross_facility: int, monthly_rate: float, rolled_up: bool, opening: int, cap_fees: int,
) -> int:
    if gross_facility <= 0:
        # Number.MAX_SAFE_INTEGER in the TS source.
        return 2**53 - 1
    if rolled_up:
        return max(0, math.floor(gross_facility / (1 + monthly_rate)) - opening - cap_fees)
    return max(0, gross_facility - opening - cap_fees)


def run_ledger(
    schedule: Schedule, finance: FacilityTerms, equity_sources: list[EquitySource],
) -> MonthlyModel:
    term = schedule.term_months
    is_cash = finance.funding_source == "cash"
    net_facility = 0 if is_cash else (finance.committed_net_facility_pence or 0)
    interest_reserve = finance.interest_reserve_pence
    gross_facility = 0 if is_cash else (
        finance.committed_gross_facility_pence
        if finance.committed_gross_facility_pence is not None
        else net_facility + (interest_reserve or 0)
    )
    monthly_rate = finance.annual_interest_rate_pct / 100 / 12
    rolled_up = finance.interest_type == "rolled_up"
    fund_as_required = finance.equity_draw_rule == "fund_as_required"
    # Spec Sec 2: committed equity available to the funding waterfall is cash
    # sources only -- land/uplift/vendor/deferred equity is recorded but not
    # yet modelled as funding (Release 2; see validation.py's non-cash-equity
    # warning).
    committed_equity = sum(
        s.amount_pence for s in equity_sources
        if s.classification == "cash" and s.evidence_status != "rejected"
    )
    facility_exists = has_facility(finance)  # R20: derived once, above.

    # Arrangement fee: charged on commitment, capitalised in month 0 (spec Sec 3.9).
    arrangement_base = (
        gross_facility if finance.arrangement_fee_basis == "committed_gross_facility"
        else net_facility
    )
    arrangement_fee = (
        money_round((arrangement_base * finance.arrangement_fee_pct) / 100) if facility_exists else 0
    )
    ancillary_fees = (
        finance.broker_fee_pence + finance.lender_legal_fee_pence
        + finance.valuation_fee_pence + finance.monitoring_surveyor_fee_pence
        if facility_exists else 0
    )

    flags: list[ModelFlag] = []
    months: list[LedgerMonth] = []
    equity_cashflows: list[int] = []

    opening = 0
    cum_net_used = 0
    equity_used = 0
    cum_capitalised_interest = 0
    peak_debt = 0
    peak_debt_month: int | None = None
    day_one_advance = 0
    total_interest = 0
    total_exit_fee = 0
    total_draws = 0
    total_cap_fees = 0
    total_equity = 0
    total_additional_equity = 0
    # Spec Sec 4.5/Sec 7: additional equity injected specifically by the refinance
    # event's shortfall or negative-net-proceeds branches -- a subset of
    # total_additional_equity that reconcile() (validation.py) must exclude from
    # sources, because it funds a facility redemption (financing-side), not a
    # project cost (see the field's own doc comment on MonthlyModelTotals above).
    total_refinance_shortfall_equity = 0
    total_gap = 0
    total_distributions = 0
    total_repayments = 0
    # R11 spec Sec 17.6: the gross VAT cycle, disclosed on totals. Neither is a
    # finance cost and neither enters Sec 7's identity (see reconcile() in
    # validation.py).
    total_vat = 0
    total_vat_reclaim = 0
    reserve_exhausted_flagged = False
    facility_exceeded_flagged = False
    # Spec Sec 5.11: the disposal month's senior balance immediately before sale receipts
    # are applied -- captured before the repayment block below mutates `balance`. Stays
    # None for cash deals (no senior facility to redeem) and for schedules with no
    # disposal at all (e.g. exit_strategy.route == "retain_all").
    redemption_balance_at_disposal: int | None = None
    # Spec Sec 4.4.1: the exit fee is charged once, at the first full redemption; a later
    # draw that re-opens a balance does not re-trigger it.
    facility_redeemed = False
    facility_redrawn_flagged = False
    # Spec Sec 4.4.1 declining redemption schedule: one entry per disposal month.
    redemption_schedule: list[RedemptionEntry] = []

    for m in range(term):
        u = schedule.uses[m]
        # R11 spec Sec 17.6: VAT is a real cash outflow in the month it is incurred,
        # so it joins the month's cash uses alongside acquisition, construction,
        # professional and statutory -- and is funded by the same waterfall below. It
        # returns later as receipts[m].vat_reclaim_pence, which repays rather than funds.
        cash_uses = (
            u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
            + u.vat_pence + (ancillary_fees if m == 0 else 0)
        )

        draw = 0
        cap_fees = 0
        equity_contribution = 0
        additional_equity = 0
        funding_gap = 0

        def equity_available() -> int:
            # Closure reads the enclosing (mutable) equity_contribution, mirroring
            # the TS arrow function's late-binding capture.
            if fund_as_required:
                return 2**53 - 1
            return max(0, committed_equity - equity_used - equity_contribution)

        if m == 0:
            if facility_exists:
                cap_fees = arrangement_fee
                cum_net_used += cap_fees
                if finance.day_one_advance_pence is not None:
                    headroom_cap = _gross_headroom_cap(
                        gross_facility, monthly_rate, rolled_up, opening, cap_fees
                    )
                    draw = max(0, min(
                        finance.day_one_advance_pence, net_facility - cum_net_used,
                        cash_uses, headroom_cap,
                    ))
                    cum_net_used += draw
            day_one_advance = draw
            needed = cash_uses - draw
            from_equity = min(needed, equity_available())
            equity_contribution += from_equity
            funding_gap += needed - from_equity
        else:
            from_equity = min(cash_uses, equity_available())
            equity_contribution += from_equity
            remainder = cash_uses - from_equity
            if remainder > 0 and facility_exists:
                # R11 spec Sec 17.6: u.vat_pence is DELIBERATELY absent from this base
                # and its absence is load-bearing. Lenders do not advance against
                # reclaimable VAT on the same terms as against build cost, so VAT falls
                # to equity or to gross headroom and, where neither can meet it, to a
                # visible vat_funding_gap. Adding u.vat_pence here raises the cap and
                # silently funds the VAT from the facility -- "funds the build but never
                # advances against the VAT" is the guard, and it has been watched failing.
                eligible = u.construction_pence + u.professional_pence + u.statutory_pence
                advance_cap = money_round((eligible * finance.development_cost_advance_pct) / 100)
                undrawn_net = max(0, net_facility - cum_net_used)
                headroom_cap = _gross_headroom_cap(
                    gross_facility, monthly_rate, rolled_up, opening, cap_fees
                )
                draw = max(0, min(remainder, advance_cap, undrawn_net, headroom_cap))
                cum_net_used += draw
                remainder -= draw
            funding_gap += remainder

        if draw > 0 and facility_redeemed and not facility_redrawn_flagged:
            facility_redrawn_flagged = True
            flags.append(ModelFlag(
                code="facility_redrawn_after_redemption", severity="amber", month=m,
                amount_pence=draw,
                message=(
                    f"Facility drawn again in month {m} after full redemption - the exit "
                    "fee was charged at first redemption and is not re-charged."
                ),
            ))

        interest_accrued = 0 if is_cash else money_round((opening + draw + cap_fees) * monthly_rate)
        total_interest += interest_accrued
        interest_capitalised = 0
        interest_serviced = 0
        if rolled_up:
            interest_capitalised = interest_accrued
            cum_capitalised_interest += interest_capitalised
        elif interest_accrued > 0:
            interest_serviced = interest_accrued
            # Serviced interest: committed equity first, then flagged additional
            # equity (Sec 4.3).
            from_equity = min(interest_serviced, equity_available())
            equity_contribution += from_equity
            additional_equity += interest_serviced - from_equity

        balance = opening + draw + cap_fees + interest_capitalised
        if balance > peak_debt:
            peak_debt = balance
            peak_debt_month = m

        r = schedule.receipts[m]
        # Declared here, ahead of the VAT reclaim, so the reclaim, the sales sweep and
        # the Sec 4.5 refinance all accumulate into the same three figures rather than
        # shadowing or overwriting one another.
        repayment = 0
        exit_fee = 0
        distribution = 0
        refinance_proceeds = 0

        # R11 spec Sec 17.6. A reclaim returns a specific advance, so it is applied
        # whole (ignoring sales_sweep_pct) and it is applied FIRST -- it reduces the
        # balance the sale and the refinance then have to clear, and so the balance
        # recorded as this month's redemption balance below.
        #
        # A reclaim that fully clears the balance REDEEMS, on the same terms as any
        # other full redemption. The intuitive rule -- "a reclaim is not a realisation,
        # so it never redeems" -- silently loses the exit fee: the sale below charges
        # it inside the "balance > 0 and not is_cash" branch, and a balance already
        # zeroed by a reclaim takes neither branch. The accepted consequence is that a
        # later draw re-opening the balance raises facility_redrawn_after_redemption,
        # which is honest.
        vat_reclaim = r.vat_reclaim_pence
        if vat_reclaim > 0:
            if balance > 0 and not is_cash:
                fee = 0 if facility_redeemed else exit_fee_amount(finance, gross_facility, peak_debt, balance)
                if vat_reclaim >= balance + fee:
                    repayment += balance
                    exit_fee += fee
                    total_exit_fee += fee
                    facility_redeemed = True
                    distribution += vat_reclaim - balance - fee
                    balance = 0
                else:
                    # A partial reclaim behaves exactly like a partial sales sweep,
                    # including the Sec 4.4 clamp: a reclaim landing in
                    # [balance, balance + fee) must not zero the balance, or the fee is
                    # never charged and never carried.
                    applied = min(vat_reclaim, balance)
                    if applied == balance:
                        applied = max(0, vat_reclaim - fee)
                    repayment += applied
                    balance -= applied
                    distribution += vat_reclaim - applied
            else:
                # No facility left to repay (redeemed, or a cash deal): the reclaim
                # flows to the developer, exactly as sale receipts already do.
                distribution += vat_reclaim

        if not is_cash and r.gross_sale_pence > 0:
            redemption_balance_at_disposal = balance
            redemption_schedule.append(RedemptionEntry(month=m, balance_pence=balance))
        net_receipts = r.gross_sale_pence - r.agent_fee_pence - r.selling_legal_pence
        if net_receipts > 0:
            sweep_available = money_round((net_receipts * finance.sales_sweep_pct) / 100)
            # Sale-attributable only: repayment/exit_fee may already carry a VAT
            # reclaim, and the clamp below compares against the balance this sweep
            # alone can clear.
            sale_repayment = 0
            sale_exit_fee = 0
            if balance > 0 and not is_cash:
                fee = 0 if facility_redeemed else exit_fee_amount(finance, gross_facility, peak_debt, balance)
                if sweep_available >= balance + fee:
                    sale_repayment = balance
                    sale_exit_fee = fee
                    total_exit_fee += fee
                    facility_redeemed = True
                    balance = 0
                else:
                    # Spec Sec 4.4: receipts insufficient to cover principal plus exit
                    # fee do not discharge the facility; the balance carries. Without
                    # this clamp, a sweep in [balance, balance + fee) would zero the
                    # balance via min() below while the fee silently vanishes (never
                    # charged, never carried) -- the exit fee must not be payable from
                    # a repayment that fully clears principal.
                    sale_repayment = min(sweep_available, balance)
                    if sale_repayment == balance:
                        sale_repayment = max(0, sweep_available - fee)
                    balance -= sale_repayment
            repayment += sale_repayment
            exit_fee += sale_exit_fee
            distribution += net_receipts - sale_repayment - sale_exit_fee

        # Spec Sec 4.5 refinance event -- fixed order: the sales sweep above ran first.
        refi = schedule.refinance
        if refi is not None and refi.month == m:
            refi_net = refi.net_proceeds_pence
            if refi_net < 0:
                additional_equity += -refi_net  # fees exceed the advance -- equity funds the difference
                total_refinance_shortfall_equity += -refi_net
                refi_net = 0
            refinance_proceeds = refi_net
            if not is_cash and balance > 0:
                fee = 0 if facility_redeemed else exit_fee_amount(finance, gross_facility, peak_debt, balance)
                required = balance + fee
                repayment += balance
                exit_fee += fee
                total_exit_fee += fee
                facility_redeemed = True
                if refi_net >= required:
                    distribution += refi_net - required
                else:
                    additional_equity += required - refi_net  # Sec 4.3 mechanics; flag fires below
                    total_refinance_shortfall_equity += required - refi_net
                balance = 0
            else:
                distribution += refi_net  # already redeemed, or a cash deal: proceeds distribute whole

        equity_used += equity_contribution
        total_draws += draw
        total_cap_fees += cap_fees
        total_equity += equity_contribution
        total_additional_equity += additional_equity
        total_gap += funding_gap
        total_distributions += distribution
        total_repayments += repayment + exit_fee
        total_vat += u.vat_pence
        total_vat_reclaim += vat_reclaim

        if funding_gap > 0 and not any(f.code == "funding_gap" for f in flags):
            flags.append(ModelFlag(
                code="funding_gap", severity="red", month=m, amount_pence=funding_gap,
                message=(
                    f"Funding gap from month {m}: committed equity and facility cannot "
                    "fund all costs. Overruns do not create facility."
                ),
            ))
        # R11 spec Sec 17.6: VAT is ineligible for the development-cost advance, so a
        # gap can open in a month whose build is fully advanced. Named separately from
        # the generic flag above (both fire) because the cause and the remedy are
        # different: this is working capital for the VAT carry, not an overrun. The
        # VAT-attributable slice is the smaller of the residual gap and the month's VAT.
        if (
            funding_gap > 0 and u.vat_pence > 0
            and not any(f.code == "vat_funding_gap" for f in flags)
        ):
            vat_gap = min(funding_gap, u.vat_pence)
            flags.append(ModelFlag(
                code="vat_funding_gap", severity="red", month=m, amount_pence=vat_gap,
                message=(
                    f"VAT funding gap from month {m}: {vat_gap} pence of VAT is "
                    "unfunded. VAT is not eligible for the development-cost advance, "
                    "so it must come from equity or gross facility headroom."
                ),
            ))
        if (
            interest_reserve is not None and not reserve_exhausted_flagged
            and cum_capitalised_interest > interest_reserve
        ):
            reserve_exhausted_flagged = True
            flags.append(ModelFlag(
                code="interest_reserve_exhausted", severity="amber", month=m,
                amount_pence=cum_capitalised_interest - interest_reserve,
                message=f"Interest reserve exhausted in month {m}.",
            ))
        if gross_facility > 0 and balance > gross_facility and not facility_exceeded_flagged:
            facility_exceeded_flagged = True
            flags.append(ModelFlag(
                code="facility_exceeded", severity="red", month=m,
                amount_pence=balance - gross_facility,
                message=f"Closing balance exceeds committed gross facility in month {m}.",
            ))

        months.append(LedgerMonth(
            month=m,
            uses_total_pence=cash_uses,
            opening_balance_pence=opening,
            draw_pence=draw,
            capitalised_fees_pence=cap_fees,
            interest_accrued_pence=interest_accrued,
            interest_capitalised_pence=interest_capitalised,
            interest_serviced_pence=interest_serviced,
            exit_fee_pence=exit_fee,
            repayment_pence=repayment,
            closing_balance_pence=balance,
            undrawn_net_facility_pence=(net_facility - cum_net_used) if facility_exists else None,
            facility_headroom_pence=(gross_facility - balance) if gross_facility > 0 else None,
            interest_reserve_remaining_pence=(
                interest_reserve - cum_capitalised_interest if interest_reserve is not None else None
            ),
            equity_contribution_pence=equity_contribution,
            additional_equity_pence=additional_equity,
            funding_gap_pence=funding_gap,
            gross_receipts_pence=r.gross_sale_pence,
            net_receipts_pence=net_receipts,
            vat_reclaim_pence=vat_reclaim,
            refinance_proceeds_pence=refinance_proceeds,
            distribution_pence=distribution,
        ))
        equity_cashflows.append(-(equity_contribution + additional_equity) + distribution)
        opening = balance

    if total_additional_equity > 0:
        flags.append(ModelFlag(
            code="additional_equity_required", severity="red", month=None,
            amount_pence=total_additional_equity,
            message=(
                f"Additional uncommitted equity of {total_additional_equity} pence "
                "required (e.g. to service interest)."
            ),
        ))
    if opening > 0:
        flags.append(ModelFlag(
            code="senior_outstanding_at_maturity", severity="red", month=term - 1,
            amount_pence=opening,
            message=(
                "Senior debt outstanding at maturity - repayment source "
                "(sale/refinance) not modelled."
            ),
        ))
        flags.append(ModelFlag(
            code="exit_fee_not_charged", severity="info", month=term - 1, amount_pence=None,
            message="Exit fee excluded: the facility is not redeemed within the modelled term.",
        ))
    if finance.requires_confirmation:
        flags.append(ModelFlag(
            code="requires_confirmation", severity="amber", month=None, amount_pence=None,
            message="Facility terms migrated from a legacy appraisal - confirm before lender use.",
        ))

    return MonthlyModel(
        months=months,
        totals=MonthlyModelTotals(
            interest_pence=total_interest,
            arrangement_fee_pence=arrangement_fee,
            exit_fee_pence=total_exit_fee,
            ancillary_fees_pence=ancillary_fees,
            finance_costs_pence=total_interest + arrangement_fee + total_exit_fee + ancillary_fees,
            draws_pence=total_draws,
            capitalised_fees_pence=total_cap_fees,
            equity_contributed_pence=total_equity,
            additional_equity_pence=total_additional_equity,
            refinance_shortfall_equity_pence=total_refinance_shortfall_equity,
            funding_gap_pence=total_gap,
            distributions_pence=total_distributions,
            repayments_pence=total_repayments,
            vat_pence=total_vat,
            vat_reclaim_pence=total_vat_reclaim,
        ),
        peak_debt_pence=peak_debt,
        peak_debt_month=peak_debt_month if peak_debt > 0 else None,
        day_one_advance_pence=day_one_advance,
        committed_net_facility_pence=net_facility,
        committed_gross_facility_pence=gross_facility,
        senior_outstanding_at_maturity_pence=opening,
        redemption_balance_at_disposal_pence=redemption_balance_at_disposal,
        redemption_schedule=redemption_schedule,
        flags=flags,
        equity_cashflows_pence=equity_cashflows,
    )
