"""Port of frontend/src/lib/model/metrics.ts, plus frontend/src/lib/model/irr.ts
(port rule #6) inlined here since metrics.ts is irr.ts's sole consumer and the
brief's file list does not include a separate irr.py."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .areas import AreaBridgeResult, area_bridge
from .breakeven import (
    DeveloperBreakevenTerms,
    PhasedSeniorBreakevenTerms,
    SeniorBreakevenTerms,
    solve_developer_breakeven,
    solve_senior_breakeven,
    solve_senior_breakeven_phased,
)
from .cost_plan import CostPlanResult, compute_cost_plan
from .cost_to_complete import CostToCompleteSummary, compute_cost_to_complete
from .engine import MonthlyModel, ModelFlag, exit_fee_amount, money_round, pct
from .lender_valuation import compute_lender_gdv
from .schedule import Schedule, calculate_gdv_breakdown
from .vat import chargeable_consideration_pence
from .acquisition_tax import AcquisitionTaxResult, calculate_acquisition_tax, resolve_acquisition_date
from .types import (
    CALC_VERSION,
    AcquisitionInputsV5,
    AnyCalculatorInputs,
    CalculatorInputsV3,
)

# --- irr.ts --------------------------------------------------------------

_LOWER = -0.99
_UPPER = 10  # 1000% per period -- beyond any sane monthly equity return


def npv_at(cashflows: list[float], rate: float) -> float:
    npv = 0.0
    for t, c in enumerate(cashflows):
        npv += c / math.pow(1 + rate, t)
    return npv


def solve_irr(cashflows: list[float]) -> float | None:
    """Periodic IRR of a cash-flow vector (index = period). Returns a decimal
    rate (0.01 = 1% per period) or None when no root exists in (-99%, 1000%].
    Newton-Raphson first; bisection fallback. Spec Sec 3.17."""
    if len(cashflows) < 2:
        return None
    has_negative = any(c < 0 for c in cashflows)
    has_positive = any(c > 0 for c in cashflows)
    if not has_negative or not has_positive:
        return None

    # Newton-Raphson
    guess = 0.01
    for _ in range(1000):
        npv = 0.0
        dnpv = 0.0
        for t, c in enumerate(cashflows):
            factor = math.pow(1 + guess, t)
            npv += c / factor
            if t > 0:
                dnpv -= (t * c) / math.pow(1 + guess, t + 1)
        if abs(dnpv) < 1e-15:
            break
        next_guess = guess - npv / dnpv
        if not math.isfinite(next_guess) or next_guess <= _LOWER or next_guess > _UPPER:
            break
        if abs(next_guess - guess) < 1e-9:
            if abs(npv_at(cashflows, next_guess)) < 1e-3:
                return next_guess
            else:
                break  # Fall through to bisection fallback when Newton converges to bad point
        guess = next_guess

    # Bisection fallback over (LOWER, UPPER].
    # Bisection's guarantee is BRACKET PRECISION on the rate (1e-12 final interval
    # width), not NPV residual: on steep NPV curves, the residual can be large
    # (1e-3+) while the rate is accurate within +/-1e-6. This is acceptable for
    # display (2 decimal places = 1%) and explains the asymmetry with Newton's
    # 1e-3 acceptance threshold.
    lo = _LOWER + 1e-9
    hi = _UPPER
    f_lo = npv_at(cashflows, lo)
    f_hi = npv_at(cashflows, hi)
    if f_lo * f_hi > 0:
        return None  # no sign change -- no root in bracket
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv_at(cashflows, mid)
        if abs(f_mid) < 1e-9 or hi - lo < 1e-12:
            return mid
        if f_lo * f_mid <= 0:
            hi = mid
        else:
            lo = mid
            f_lo = f_mid
    return (lo + hi) / 2


# --- metrics.ts ------------------------------------------------------------


@dataclass
class AppraisalResultV2:
    calc_version: str
    gdv_pence: int
    # float, not int (Task 3's fix made non-integer lender_gdv_pence possible for
    # fixed_amount/per_unit bases -- see LenderGdvResult.lender_gdv_pence in
    # lender_valuation.py; variance inherits the same fractional possibility).
    lender_gdv_pence: float | None
    lender_gdv_variance_pence: float | None
    lender_gdv_variance_pct: float | None
    acquisition_cost_pence: int
    # Spec Sec 14 (R8) -- the tax actually charged on the acquisition under the
    # document's jurisdiction: SDLT, LBTT or LTT. Equal to
    # acquisition_tax.total_pence.
    acquisition_tax_pence: int
    # Spec Sec 14 (R8) -- the full derivation: regime, band breakdown, surcharge,
    # band-set effective date, table version, source and override provenance.
    acquisition_tax: AcquisitionTaxResult
    # R11 spec Sec 17.7 -- the figure the acquisition tax was actually charged
    # on: the price PLUS any chargeable purchase VAT. Equal to
    # acquisition.purchase_price_pence unless the vendor has opted to tax and
    # TOGC does not apply. Disclosed rather than left implicit, so the tax base
    # is visible in the result instead of buried inside a tax figure.
    chargeable_consideration_pence: int
    # DEPRECATED (R8): a jurisdiction-neutral figure under an England/NI-only
    # name. Carries the identical value to acquisition_tax_pence; retained only
    # so pre-R8 report and export readers keep working. Removed in R16.
    sdlt_pence: int
    # R9 spec Sec 15.8 -- the full area reconciliation: every entered line,
    # every derived line, every efficiency. The UI and the report read areas
    # from here and never recompute one.
    area_bridge: AreaBridgeResult
    # R9 spec Sec 15.8 -- the construction cost area actually used, whichever
    # basis produced it. Equal to area_bridge.developed_area_sqm.
    developed_area_sqm: float
    # R10 spec Sec 16 -- the full cost derivation: every package, every
    # contingency class with its base, every fee line with its base. The UI
    # and the report read cost from here and never recompute one.
    cost_plan: CostPlanResult
    # R9 spec Sec 3.1 -- GDV excluding ancillary. This is the pre-R9 figure,
    # kept so a variance against it stays expressible.
    gdv_internal_pence: int
    # R9 spec Sec 3.1 -- parking plus balcony/terrace value. gdv_pence remains
    # the TOTAL of the two, so every existing GDV-denominated ratio is
    # unchanged.
    gdv_ancillary_pence: int
    construction_cost_pence: int
    professional_fees_pence: int
    statutory_costs_pence: int
    selling_costs_pence: int
    cost_before_finance_pence: int
    finance_costs_pence: int
    total_development_cost_pence: int
    profit_pence: int
    profit_is_unrealised: bool
    # Spec Sec 3.16.1 -- a disposal or refinance is booked within the term.
    has_realisation_event: bool
    # Spec Sec 3.16.1 -- return on equity is an accounting return, not a
    # distributed one; reports must label it "unrealised" when true.
    return_on_equity_is_unrealised: bool
    unrealised_value_pence: int
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    equity_contributed_pence: int
    equity_multiple: float | None
    irr_monthly_pct: float | None
    irr_annual_pct: float | None
    rlv_pence: int
    day_one_advance_pence: int
    day_one_ltv_on_price_pct: float | None
    day_one_ltv_on_value_pct: float | None
    development_advances_pence: int
    net_ltc_pct: float | None
    gross_ltc_pct: float | None
    ltgdv_developer_pct: float | None
    ltgdv_lender_pct: float | None
    peak_debt_pence: int
    peak_debt_month: int | None
    facility_headroom_pence: int | None
    interest_reserve_remaining_pence: int | None
    return_on_equity_pct: float | None
    # Wired in Task 4 (spec Sec 5.11).
    senior_breakeven_pence: int | None
    senior_breakeven_pct_of_lender_gdv: float | None
    senior_breakeven_fall_from_lender_gdv_pct: float | None
    # Wired in Task 5 (spec Sec 5.12).
    developer_breakeven_pence: int | None
    # Wired in Task 6 (spec Sec 5.10).
    cost_to_complete: CostToCompleteSummary | None
    # Ledger flags (model.flags, unmutated) followed by metric flags computed by
    # derive_metrics itself (senior/developer breakeven unsolvable, cap-exhausted).
    # Wired in Release 3a Task 6 -- derive_metrics is pure and no longer mutates
    # model.flags; this is now the single read site for the full flag set.
    flags: list[ModelFlag]


def breakeven_flags(
    senior_null: bool, developer_null: bool, agent_fee_pct: float,
    senior_unsolvable_reason: str | None = None,
) -> list[ModelFlag]:
    """Pure flag construction for the two break-even solvers (spec Sec 5.11/Sec 5.12).
    A None solve with fee < 100% means the integer bisection exhausted its
    2^200-pence range -- unreachable with real inputs, flagged defensively.
    `senior_unsolvable_reason` (R3b Task 6): when non-None, the phased solver
    (spec Sec 5.11 phased regime) determined the senior break-even is
    structurally unsolvable for a reason other than the agent-fee case above
    (facility draws continue past the final tranche, or sales_sweep_pct is 0%)
    -- reported as its own red flag with the caller-supplied message, never the
    cap-exhausted flag (that flag means "the search space was exhausted", not
    "no search was possible")."""
    out: list[ModelFlag] = []
    unsolvable = agent_fee_pct >= 100
    if senior_unsolvable_reason is not None:
        out.append(ModelFlag(
            code="senior_breakeven_unsolvable", severity="red", month=None, amount_pence=None,
            message=senior_unsolvable_reason,
        ))
    if senior_null and unsolvable:
        out.append(ModelFlag(
            code="senior_breakeven_unsolvable", severity="red", month=None, amount_pence=None,
            message="agent fee ≥ 100% — break-even unsolvable",
        ))
    if developer_null and unsolvable:
        out.append(ModelFlag(
            code="developer_breakeven_unsolvable", severity="red", month=None, amount_pence=None,
            message="agent fee ≥ 100% — break-even unsolvable",
        ))
    if (senior_null or developer_null) and not unsolvable and senior_unsolvable_reason is None:
        out.append(ModelFlag(
            code="breakeven_cap_exhausted", severity="red", month=None, amount_pence=None,
            message=(
                "break-even solver range exhausted — inputs are implausible; treat all "
                "break-even figures as unavailable"
            ),
        ))
    return out


def derive_metrics(
    inputs: AnyCalculatorInputs, schedule: Schedule, model: MonthlyModel,
) -> AppraisalResultV2:
    flags: list[ModelFlag] = list(model.flags)
    t = schedule.totals
    # R9 spec Sec 15.8. Derived once, here, and read by every consumer from
    # the result -- the UI and the memo never call area_bridge themselves.
    bridge = area_bridge(inputs)
    # R10 spec Sec 16. Derived once, here, and read by every consumer from the result.
    cost_plan = compute_cost_plan(inputs, bridge.developed_area_sqm, len(inputs.unit_mix.units))
    gdv_parts = calculate_gdv_breakdown(inputs.unit_mix.units)
    # Lender-underwritten GDV (spec Sec 3.2, Release 2b Task 3). None for v2
    # inputs (no lender_valuation field at all), v3 inputs with the block
    # absent, or a present-but-invalid block. compute_lender_gdv raises for the
    # last case (missing global_value, missing per_unit id, a non-positive
    # value) -- caught here so an invalid block degrades to "lender metrics
    # unavailable" instead of crashing the whole appraisal (metrics runs before
    # validation in run_appraisal, so nothing has reported the problem yet at
    # this point). validate_inputs independently re-derives the exact same
    # condition as a hard ValidationIssue, so the failure is never silent --
    # just never fatal, and never a substitute number standing in for "unknown"
    # (spec Sec 2).
    lender_gdv = None
    if isinstance(inputs, CalculatorInputsV3):
        try:
            lender_gdv = compute_lender_gdv(inputs)
        except ValueError:
            lender_gdv = None
    lender_gdv_variance = None if lender_gdv is None else lender_gdv.lender_gdv_pence - t.gdv_pence
    # Acquisition tax (spec Sec 14, R8). Mirrors metrics.ts. v2-v4 documents carry
    # no jurisdiction at all, exactly as they carry no lender_valuation, so the
    # new fields are read behind the same isinstance gate the TS engine spells
    # `'jurisdiction' in acq`. england_ni with a null date is precisely what those
    # documents always implicitly were -- the England/NI non-residential band set
    # has been unchanged since 17 March 2016 and is the current set -- so this
    # preserves their figures to the penny.
    #
    # Fix round 2: the gate is on the *acquisition block*, not on the container.
    # schedule.py's calculate_total_acquisition_cost gates on the block too --
    # R11 widened its parameter to the whole document (spec Sec 17.7), but it
    # still reads `inputs.acquisition` and tests THAT, exactly as this site
    # does -- and the two sites must use the identical predicate or
    # they can disagree -- Pydantic's default revalidate_instances='never' lets a
    # CalculatorInputsV4 hold an AcquisitionInputsV5, at which point a
    # container-level gate here reports SDLT while the schedule charges LTT. Not
    # reachable from JSON or the migration chain, but this is precisely the
    # invariant the drift guard exists to make unbreakable. This also mirrors the
    # TS engine, which is structural on the block at both sites.
    acq = inputs.acquisition
    is_v5 = isinstance(acq, AcquisitionInputsV5)
    jurisdiction = acq.jurisdiction if is_v5 else "england_ni"
    raw_date = acq.acquisition_date if is_v5 else None
    # Fix round 1 (R8): derive_metrics runs before validate_inputs in
    # run_appraisal, so an unusable date must degrade rather than raise here --
    # see resolve_acquisition_date's docstring. validate_inputs re-derives this
    # as a hard acquisition.acquisition_date error independently, and
    # calculate_total_acquisition_cost degrades identically so the two tax
    # sites cannot drift.
    date = resolve_acquisition_date(jurisdiction, "non_residential", raw_date)
    acquisition_tax = calculate_acquisition_tax(
        # Sec 17.7: the VAT-INCLUSIVE consideration, never the raw price.
        #
        # Spelled as the CALL rather than through an intermediate variable, and
        # deliberately not mirroring metrics.ts, which holds the figure in a
        # local. TypeScript can: the value is branded, and the brand flows
        # through the variable. Python has no nominal type, so the AST guard in
        # tests/test_accessor_guard.py requires the accessor call AT the
        # keyword -- an intermediate Name is precisely the laundering shape the
        # brand exists to defeat, and one a scan cannot tell from a raw price.
        # The accessor is pure, so the second call below is the same figure.
        consideration_pence=chargeable_consideration_pence(inputs),
        jurisdiction=jurisdiction,
        basis="non_residential",
        date=date,
        override_pence=acq.acquisition_tax_override_pence if is_v5 else None,
        override_reason=acq.acquisition_tax_override_reason if is_v5 else None,
    )
    sdlt = acquisition_tax.total_pence
    cost_before_finance = t.cost_before_finance_ex_selling_pence + t.selling_costs_pence
    finance_costs = model.totals.finance_costs_pence
    tdc = cost_before_finance + finance_costs
    gross_receipts = t.gross_sales_pence
    profit = gross_receipts + t.retained_value_pence - tdc
    profit_is_unrealised = t.retained_value_pence > 0

    equity_contributed = model.totals.equity_contributed_pence + model.totals.additional_equity_pence
    # Spec Sec 3.16.1 (calc 2.6.0) -- mirrors frontend/src/lib/model/metrics.ts.
    # A distributed-return metric needs a realisation event to measure against;
    # without one there is no answer, and "0.00x" reads as a total loss of
    # capital rather than as a retain-all case with no exit modelled.
    has_realisation_event = t.gross_sales_pence > 0 or schedule.refinance is not None
    equity_multiple = (
        money_round((model.totals.distributions_pence / equity_contributed) * 100) / 100
        if has_realisation_event and equity_contributed > 0 else None
    )

    irr = solve_irr(model.equity_cashflows_pence)
    irr_monthly = None if irr is None else money_round(irr * 10000) / 100
    irr_annual = None if irr is None else money_round((math.pow(1 + irr, 12) - 1) * 10000) / 100

    target = inputs.deal_spider.target_profit_on_cost_pct
    cost_ex_land = tdc - inputs.acquisition.purchase_price_pence - sdlt
    rlv = money_round(t.gdv_pence / (1 + target / 100) - cost_ex_land)

    net_advances = model.totals.draws_pence + model.totals.capitalised_fees_pence
    price = inputs.acquisition.purchase_price_pence
    day_one_value = inputs.finance.day_one_market_value_pence

    # Senior repayment break-even (spec Sec 5.11, Release 2b Task 4). The absolute value is
    # computed whenever the ledger recorded a disposal (developer-GDV-independent -- it does
    # not need lender GDV at all); the two percentage forms are None unless a lender GDV is
    # also present. The exit fee is recomputed via exit_fee_amount from the facility's actual
    # basis terms (peak debt / gross facility / redemption balance) rather than read off
    # model.totals.exit_fee_pence -- that total is the fee actually *charged*, which is zero
    # whenever the real disposal under-swept the balance (spec Sec 4.4), but the break-even
    # question is "what fee would be due on full redemption of this balance", independent of
    # whether the real sale proceeds happened to cover it.
    # Phased regime (spec Sec 5.11 phased regime, R3b Task 6): when sales_phasing is
    # non-None, the static single-shot solver above no longer models the disposal
    # (receipts split across tranche months, spec Sec 4.4.1) -- the break-even instead
    # replays the actual run's draw/fee schedule under a scaled total gross via
    # solve_senior_breakeven_phased. Two cases are structurally unsolvable (no bisection
    # attempted, no cap-exhausted flag -- a distinct reasoned flag instead): facility
    # draws continue after the final tranche month (no sale price can ever redeem what
    # keeps growing), or sales_sweep_pct is 0% (proceeds never reach the facility at
    # all). `sales_phasing` only exists on v4 inputs; the `getattr(..., None)` guard
    # keeps this branch inert for v2/v3 callers exactly as before.
    phasing = getattr(inputs, "sales_phasing", None)
    redemption_balance = model.redemption_balance_at_disposal_pence
    senior_breakeven: int | None = None
    senior_breakeven_pct_of_lender_gdv: float | None = None
    senior_breakeven_fall_from_lender_gdv_pct: float | None = None
    senior_attempted_null = False
    senior_unsolvable_reason: str | None = None
    if redemption_balance is not None:
        if phasing is None:
            breakeven_terms = SeniorBreakevenTerms(
                redemption_balance_pence=redemption_balance,
                exit_fee_pence=exit_fee_amount(
                    inputs.finance, model.committed_gross_facility_pence, model.peak_debt_pence,
                    redemption_balance,
                ),
                selling_agent_fee_pct=inputs.exit_strategy.selling_agent_fee_pct,
                selling_legal_fee_pence=inputs.exit_strategy.selling_legal_fee_pence,
                enforcement_cost_assumption_pence=inputs.finance.enforcement_cost_assumption_pence,
            )
            senior_breakeven = solve_senior_breakeven(breakeven_terms)
            senior_attempted_null = senior_breakeven is None
            if senior_breakeven is not None and lender_gdv is not None:
                senior_breakeven_pct_of_lender_gdv = pct(senior_breakeven, lender_gdv.lender_gdv_pence)
                senior_breakeven_fall_from_lender_gdv_pct = pct(
                    lender_gdv.lender_gdv_pence - senior_breakeven, lender_gdv.lender_gdv_pence,
                )
        else:
            last_tranche = max(tr.month_offset for tr in phasing.tranches)
            # Mirrors solve_senior_breakeven_phased's own internal guard exactly
            # (draws_and_fees_pence[m] > 0 for m past the last tranche) --
            # capitalised_fees_pence is 0 for every month past 0 in the current engine
            # (arrangement fee capitalises once, at month 0 only, in run_ledger), so
            # this is currently equivalent to draw_pence alone; summing both here keeps
            # the two checks provably identical rather than coincidentally so.
            if any(
                mm.month > last_tranche and mm.draw_pence + mm.capitalised_fees_pence > 0
                for mm in model.months
            ):
                senior_unsolvable_reason = (
                    "senior break-even unavailable — facility draws continue after the "
                    "final sales tranche, so no sale price redeems the facility"
                )
            elif inputs.finance.sales_sweep_pct <= 0:
                senior_unsolvable_reason = (
                    "senior break-even unavailable — sales sweep is 0%, so sale "
                    "proceeds never repay the facility"
                )
            else:
                phased_terms = PhasedSeniorBreakevenTerms(
                    draws_and_fees_pence=[
                        mm.draw_pence + mm.capitalised_fees_pence for mm in model.months
                    ],
                    monthly_rate=inputs.finance.annual_interest_rate_pct / 100 / 12,
                    rolled_up=inputs.finance.interest_type == "rolled_up",
                    sales_sweep_pct=inputs.finance.sales_sweep_pct,
                    tranches=phasing.tranches,
                    selling_agent_fee_pct=inputs.exit_strategy.selling_agent_fee_pct,
                    selling_legal_fee_pence=inputs.exit_strategy.selling_legal_fee_pence,
                    enforcement_cost_assumption_pence=inputs.finance.enforcement_cost_assumption_pence,
                    finance=inputs.finance,
                    committed_gross_facility_pence=model.committed_gross_facility_pence,
                )
                senior_breakeven = solve_senior_breakeven_phased(phased_terms)
                senior_attempted_null = senior_breakeven is None
                if senior_breakeven is not None and lender_gdv is not None:
                    senior_breakeven_pct_of_lender_gdv = pct(senior_breakeven, lender_gdv.lender_gdv_pence)
                    senior_breakeven_fall_from_lender_gdv_pct = pct(
                        lender_gdv.lender_gdv_pence - senior_breakeven, lender_gdv.lender_gdv_pence,
                    )

    # Developer profit break-even (spec Sec 5.12, Release 2b Task 5). Lender-independent AND
    # debt-independent (unlike senior_breakeven_pence above, which is None for every cash
    # deal since there is no facility to redeem): computed whenever the ledger recorded any
    # disposal at all -- the schedule's gross_sales_pence > 0 -- including cash-funded
    # deals (fixture A) where redemption_balance_at_disposal_pence is None. A retain-only
    # appraisal with zero sales gets None: there is no sale price to solve for. There is no
    # ordering invariant between this figure and senior_breakeven_pence (design Sec B5) --
    # they cover different cost bases and answer different questions.
    developer_breakeven: int | None = None
    developer_attempted_null = False
    if t.gross_sales_pence > 0:
        tdc_ex_selling = tdc - t.selling_costs_pence
        developer_breakeven_terms = DeveloperBreakevenTerms(
            tdc_ex_selling_pence=tdc_ex_selling,
            selling_agent_fee_pct=inputs.exit_strategy.selling_agent_fee_pct,
            selling_legal_fee_pence=inputs.exit_strategy.selling_legal_fee_pence,
        )
        developer_breakeven = solve_developer_breakeven(developer_breakeven_terms)
        developer_attempted_null = developer_breakeven is None
    flags.extend(breakeven_flags(
        senior_attempted_null, developer_attempted_null,
        inputs.exit_strategy.selling_agent_fee_pct, senior_unsolvable_reason,
    ))

    # Cost-to-complete (spec Sec 5.10, Release 2b Task 6). Computed for every appraisal --
    # schedule.term_months is always >= 1 (build_schedule floors it), so the series is never
    # empty and this field is never actually None in practice (the AppraisalResultV2 type stays
    # Optional only because it was declared that way, unwired, in Task 1).
    cost_to_complete = compute_cost_to_complete(schedule, model, inputs)

    return AppraisalResultV2(
        calc_version=CALC_VERSION,
        gdv_pence=t.gdv_pence,
        lender_gdv_pence=None if lender_gdv is None else lender_gdv.lender_gdv_pence,
        lender_gdv_variance_pence=lender_gdv_variance,
        lender_gdv_variance_pct=(
            None if lender_gdv_variance is None else pct(lender_gdv_variance, t.gdv_pence)
        ),
        acquisition_cost_pence=t.acquisition_pence,
        acquisition_tax_pence=sdlt,
        acquisition_tax=acquisition_tax,
        chargeable_consideration_pence=chargeable_consideration_pence(inputs),
        # DEPRECATED (R8) -- use acquisition_tax_pence. Removed in R16.
        sdlt_pence=sdlt,
        area_bridge=bridge,
        developed_area_sqm=bridge.developed_area_sqm,
        cost_plan=cost_plan,
        gdv_internal_pence=gdv_parts.internal_pence,
        gdv_ancillary_pence=gdv_parts.ancillary_pence,
        construction_cost_pence=t.construction_pence,
        professional_fees_pence=t.professional_pence,
        statutory_costs_pence=t.statutory_pence,
        selling_costs_pence=t.selling_costs_pence,
        cost_before_finance_pence=cost_before_finance,
        finance_costs_pence=finance_costs,
        total_development_cost_pence=tdc,
        profit_pence=profit,
        profit_is_unrealised=profit_is_unrealised,
        has_realisation_event=has_realisation_event,
        return_on_equity_is_unrealised=profit_is_unrealised or not has_realisation_event,
        unrealised_value_pence=t.retained_value_pence,
        profit_on_cost_pct=pct(profit, tdc),
        profit_on_gdv_pct=pct(profit, t.gdv_pence),
        equity_contributed_pence=equity_contributed,
        equity_multiple=equity_multiple,
        irr_monthly_pct=irr_monthly,
        irr_annual_pct=irr_annual,
        rlv_pence=rlv,
        day_one_advance_pence=model.day_one_advance_pence,
        day_one_ltv_on_price_pct=None if price == 0 else pct(model.day_one_advance_pence, price),
        day_one_ltv_on_value_pct=(
            None if day_one_value is None else pct(model.day_one_advance_pence, day_one_value)
        ),
        development_advances_pence=model.totals.draws_pence - model.day_one_advance_pence,
        net_ltc_pct=(
            None if t.cost_before_finance_ex_selling_pence == 0
            else pct(net_advances, t.cost_before_finance_ex_selling_pence)
        ),
        gross_ltc_pct=None if tdc == 0 else pct(model.peak_debt_pence, tdc),
        ltgdv_developer_pct=pct(model.peak_debt_pence, t.gdv_pence),
        ltgdv_lender_pct=(
            None if lender_gdv is None else pct(model.peak_debt_pence, lender_gdv.lender_gdv_pence)
        ),
        peak_debt_pence=model.peak_debt_pence,
        peak_debt_month=model.peak_debt_month,
        facility_headroom_pence=(
            model.committed_gross_facility_pence - model.peak_debt_pence
            if model.committed_gross_facility_pence > 0 else None
        ),
        interest_reserve_remaining_pence=(
            model.months[-1].interest_reserve_remaining_pence if len(model.months) > 0 else None
        ),
        return_on_equity_pct=pct(profit, equity_contributed) if equity_contributed > 0 else None,
        senior_breakeven_pence=senior_breakeven,
        senior_breakeven_pct_of_lender_gdv=senior_breakeven_pct_of_lender_gdv,
        senior_breakeven_fall_from_lender_gdv_pct=senior_breakeven_fall_from_lender_gdv_pct,
        developer_breakeven_pence=developer_breakeven,
        cost_to_complete=cost_to_complete,
        flags=flags,
    )
