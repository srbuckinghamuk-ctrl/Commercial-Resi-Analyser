import type {
  AnyCalculatorInputs, AppraisalResultV2, ModelFlag, MonthlyModel, Schedule,
} from './finance-types';
import { CALC_VERSION } from './finance-types';
import { solveIrr } from './irr';
import { calculateAcquisitionTax } from '../tax/acquisition-tax';
import { computeLenderGdv } from './lender-valuation';
import { exitFeeAmount } from './monthly-engine';
import { solveDeveloperBreakeven, solveSeniorBreakeven, solveSeniorBreakevenPhased } from './breakeven';
import type { DeveloperBreakevenTerms, SeniorBreakevenTerms, PhasedSeniorBreakevenTerms } from './breakeven';
import { computeCostToComplete } from './cost-to-complete';

/** Percentage to 2 dp; null when the denominator is zero (spec §1.5). */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

/** Pure flag construction for the two break-even solvers (spec §5.11/§5.12).
 * A null solve with fee < 100% means the integer bisection exhausted its
 * 2^200-pence range — unreachable with real inputs, flagged defensively.
 * `seniorUnsolvableReason` (R3b Task 6): when non-null, the phased solver
 * (spec §5.11 phased regime) determined the senior break-even is
 * structurally unsolvable for a reason other than the agent-fee case above
 * (facility draws continue past the final tranche, or sales_sweep_pct is
 * 0%) — reported as its own red flag with the caller-supplied message, never
 * the cap-exhausted flag (that flag means "the search space was exhausted",
 * not "no search was possible"). */
export function breakevenFlags(
  seniorNull: boolean, developerNull: boolean, agentFeePct: number,
  seniorUnsolvableReason: string | null = null,
): ModelFlag[] {
  const out: ModelFlag[] = [];
  const unsolvable = agentFeePct >= 100;
  if (seniorUnsolvableReason != null) out.push({
    code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: seniorUnsolvableReason,
  });
  if (seniorNull && unsolvable) out.push({
    code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: 'agent fee ≥ 100% — break-even unsolvable',
  });
  if (developerNull && unsolvable) out.push({
    code: 'developer_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: 'agent fee ≥ 100% — break-even unsolvable',
  });
  if ((seniorNull || developerNull) && !unsolvable && seniorUnsolvableReason == null) out.push({
    code: 'breakeven_cap_exhausted', severity: 'red', month: null, amount_pence: null,
    message: 'break-even solver range exhausted — inputs are implausible; treat all break-even figures as unavailable',
  });
  return out;
}

export function deriveMetrics(
  inputs: AnyCalculatorInputs, schedule: Schedule, model: MonthlyModel,
): AppraisalResultV2 {
  const flags: ModelFlag[] = [...model.flags];
  const t = schedule.totals;
  // Lender-underwritten GDV (spec §3.2, Release 2b Task 3). null for v2 inputs
  // (no lender_valuation field at all), v3 inputs with the block absent, or a
  // present-but-invalid block. computeLenderGdv throws for the last case
  // (missing global_value, missing per_unit id, a non-positive value) — caught
  // here so an invalid block degrades to "lender metrics unavailable" instead
  // of crashing the whole appraisal (metrics runs before validation in
  // runAppraisal, so nothing has reported the problem yet at this point).
  // validateInputs independently re-derives the exact same condition as a hard
  // ValidationIssue, so the failure is never silent — just never fatal, and
  // never a substitute number standing in for "unknown" (spec §2).
  let lenderGdv: ReturnType<typeof computeLenderGdv> = null;
  if ('lender_valuation' in inputs) {
    try {
      lenderGdv = computeLenderGdv(inputs);
    } catch {
      lenderGdv = null;
    }
  }
  const lenderGdvVariance = lenderGdv == null ? null : lenderGdv.lender_gdv_pence - t.gdv_pence;
  // Acquisition tax (spec §14, R8). v2–v4 documents carry no jurisdiction at all,
  // exactly as they carry no `lender_valuation`, so every new field is read through
  // the same structural `in` guard rather than by assuming a shape. `england_ni`
  // with a null date is precisely what those documents always implicitly were —
  // the England/NI non-residential band set has been unchanged since 17 March 2016
  // and is the current set — so this preserves their figures to the penny.
  const acq = inputs.acquisition;
  const acquisitionTax = calculateAcquisitionTax({
    consideration_pence: acq.purchase_price_pence,
    // Fix round 2: `in` guard *and* `??`. A stored document can carry an explicit
    // `"jurisdiction": null` — migrateInputsToV5's already-v5 branch spreads
    // `saved.acquisition` over the defaults, so the null survives — and a bare `in`
    // guard would then reach selectBandSet and throw "No band sets for
    // null/non_residential", where the Python engine rejects the same document at
    // validation. Both engines must degrade the same way. Only `jurisdiction` is
    // fatal; a null date, override or reason are all absorbed downstream.
    jurisdiction: 'jurisdiction' in acq ? acq.jurisdiction ?? 'england_ni' : 'england_ni',
    basis: 'non_residential',
    date: 'acquisition_date' in acq ? acq.acquisition_date : null,
    override_pence:
      'acquisition_tax_override_pence' in acq ? acq.acquisition_tax_override_pence : null,
    override_reason:
      'acquisition_tax_override_reason' in acq ? acq.acquisition_tax_override_reason : null,
  });
  const sdlt = acquisitionTax.total_pence;
  const costBeforeFinance = t.cost_before_finance_ex_selling_pence + t.selling_costs_pence;
  const financeCosts = model.totals.finance_costs_pence;
  const tdc = costBeforeFinance + financeCosts;
  const grossReceipts = t.gross_sales_pence;
  const profit = grossReceipts + t.retained_value_pence - tdc;
  const profitIsUnrealised = t.retained_value_pence > 0;

  const equityContributed = model.totals.equity_contributed_pence + model.totals.additional_equity_pence;
  // Spec §3.16.1 (calc 2.6.0). A distributed-return metric needs a realisation
  // event to measure against: a disposal that books receipts, or a refinance
  // that books proceeds. Without one, "0.00x" is not the answer — there is no
  // answer, and printing a zero beside a positive return on equity read to the
  // second audit's reviewer as a total loss of capital rather than as a
  // retain-all case with no exit modelled (spec §1.5: unknown is not zero).
  const hasRealisationEvent = schedule.totals.gross_sales_pence > 0 || schedule.refinance !== null;
  const equityMultiple = hasRealisationEvent && equityContributed > 0
    ? Math.round((model.totals.distributions_pence / equityContributed) * 100) / 100
    : null;

  const irr = solveIrr(model.equity_cashflows_pence);
  const irrMonthly = irr === null ? null : Math.round(irr * 10000) / 100;
  const irrAnnual = irr === null ? null : Math.round((Math.pow(1 + irr, 12) - 1) * 10000) / 100;

  const target = inputs.deal_spider.target_profit_on_cost_pct;
  const costExLand = tdc - inputs.acquisition.purchase_price_pence - sdlt;
  const rlv = Math.round(t.gdv_pence / (1 + target / 100) - costExLand);

  const netAdvances = model.totals.draws_pence + model.totals.capitalised_fees_pence;
  const price = inputs.acquisition.purchase_price_pence;
  const dayOneValue = inputs.finance.day_one_market_value_pence;

  // Senior repayment break-even (spec §5.11, Release 2b Task 4). The absolute value is
  // computed whenever the ledger recorded a disposal (developer-GDV-independent — it does
  // not need lender GDV at all); the two percentage forms are null unless a lender GDV is
  // also present. The exit fee is recomputed via exitFeeAmount from the facility's actual
  // basis terms (peak debt / gross facility / redemption balance) rather than read off
  // model.totals.exit_fee_pence — that total is the fee actually *charged*, which is zero
  // whenever the real disposal under-swept the balance (spec §4.4), but the break-even
  // question is "what fee would be due on full redemption of this balance", independent of
  // whether the real sale proceeds happened to cover it.
  // Phased regime (spec §5.11 phased regime, R3b Task 6): when sales_phasing is non-null,
  // the static single-shot solver above no longer models the disposal (receipts split
  // across tranche months, spec §4.4.1) — the break-even instead replays the actual run's
  // draw/fee schedule under a scaled total gross via solveSeniorBreakevenPhased. Two cases
  // are structurally unsolvable (no bisection attempted, no cap-exhausted flag — a distinct
  // reasoned flag instead): facility draws continue after the final tranche month (no sale
  // price can ever redeem what keeps growing), or sales_sweep_pct is 0% (proceeds never
  // reach the facility at all). `sales_phasing` only exists on v4 inputs; the `'sales_phasing'
  // in inputs` guard keeps this branch inert for v2/v3 callers exactly as before.
  const phasing = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  const redemptionBalance = model.redemption_balance_at_disposal_pence;
  let seniorBreakeven: number | null = null;
  let seniorBreakevenPctOfLenderGdv: number | null = null;
  let seniorBreakevenFallFromLenderGdvPct: number | null = null;
  let seniorAttemptedNull = false;
  let seniorUnsolvableReason: string | null = null;
  if (redemptionBalance != null) {
    if (phasing == null) {
      const breakevenTerms: SeniorBreakevenTerms = {
        redemption_balance_pence: redemptionBalance,
        exit_fee_pence: exitFeeAmount(
          inputs.finance, model.committed_gross_facility_pence, model.peak_debt_pence, redemptionBalance,
        ),
        selling_agent_fee_pct: inputs.exit_strategy.selling_agent_fee_pct,
        selling_legal_fee_pence: inputs.exit_strategy.selling_legal_fee_pence,
        enforcement_cost_assumption_pence: inputs.finance.enforcement_cost_assumption_pence,
      };
      seniorBreakeven = solveSeniorBreakeven(breakevenTerms);
      seniorAttemptedNull = seniorBreakeven == null;
      if (seniorBreakeven != null && lenderGdv != null) {
        seniorBreakevenPctOfLenderGdv = pct(seniorBreakeven, lenderGdv.lender_gdv_pence);
        seniorBreakevenFallFromLenderGdvPct =
          pct(lenderGdv.lender_gdv_pence - seniorBreakeven, lenderGdv.lender_gdv_pence);
      }
    } else {
      const lastTranche = Math.max(...phasing.tranches.map((x) => x.month_offset));
      // Mirrors solveSeniorBreakevenPhased's own internal guard exactly (draws_and_fees_
      // pence[m] > 0 for m past the last tranche) — capitalised_fees_pence is 0 for every
      // month past 0 in the current engine (arrangement fee capitalises once, at month 0
      // only, in runLedger), so this is currently equivalent to draw_pence alone; summing
      // both here keeps the two checks provably identical rather than coincidentally so.
      if (model.months.some((mm) => mm.month > lastTranche && mm.draw_pence + mm.capitalised_fees_pence > 0)) {
        seniorUnsolvableReason =
          'senior break-even unavailable — facility draws continue after the final sales tranche, so no sale price redeems the facility';
      } else if (inputs.finance.sales_sweep_pct <= 0) {
        seniorUnsolvableReason =
          'senior break-even unavailable — sales sweep is 0%, so sale proceeds never repay the facility';
      } else {
        const phasedTerms: PhasedSeniorBreakevenTerms = {
          draws_and_fees_pence: model.months.map((mm) => mm.draw_pence + mm.capitalised_fees_pence),
          monthly_rate: inputs.finance.annual_interest_rate_pct / 100 / 12,
          rolled_up: inputs.finance.interest_type === 'rolled_up',
          sales_sweep_pct: inputs.finance.sales_sweep_pct,
          tranches: phasing.tranches,
          selling_agent_fee_pct: inputs.exit_strategy.selling_agent_fee_pct,
          selling_legal_fee_pence: inputs.exit_strategy.selling_legal_fee_pence,
          enforcement_cost_assumption_pence: inputs.finance.enforcement_cost_assumption_pence,
          finance: inputs.finance,
          committed_gross_facility_pence: model.committed_gross_facility_pence,
        };
        seniorBreakeven = solveSeniorBreakevenPhased(phasedTerms);
        seniorAttemptedNull = seniorBreakeven == null;
        if (seniorBreakeven != null && lenderGdv != null) {
          seniorBreakevenPctOfLenderGdv = pct(seniorBreakeven, lenderGdv.lender_gdv_pence);
          seniorBreakevenFallFromLenderGdvPct =
            pct(lenderGdv.lender_gdv_pence - seniorBreakeven, lenderGdv.lender_gdv_pence);
        }
      }
    }
  }

  // Developer profit break-even (spec §5.12, Release 2b Task 5). Lender-independent AND
  // debt-independent (unlike senior_breakeven_pence above, which is null for every cash
  // deal since there is no facility to redeem): computed whenever the ledger recorded any
  // disposal at all — the schedule's gross_sales_pence > 0 — including cash-funded deals
  // (fixture A) where redemption_balance_at_disposal_pence is null. A retain-only
  // appraisal with zero sales gets null: there is no sale price to solve for. There is no
  // ordering invariant between this figure and senior_breakeven_pence (design §B5) — they
  // cover different cost bases and answer different questions.
  let developerBreakeven: number | null = null;
  let developerAttemptedNull = false;
  if (t.gross_sales_pence > 0) {
    const tdcExSelling = tdc - t.selling_costs_pence;
    const developerBreakevenTerms: DeveloperBreakevenTerms = {
      tdc_ex_selling_pence: tdcExSelling,
      selling_agent_fee_pct: inputs.exit_strategy.selling_agent_fee_pct,
      selling_legal_fee_pence: inputs.exit_strategy.selling_legal_fee_pence,
    };
    developerBreakeven = solveDeveloperBreakeven(developerBreakevenTerms);
    developerAttemptedNull = developerBreakeven == null;
  }
  flags.push(...breakevenFlags(
    seniorAttemptedNull, developerAttemptedNull, inputs.exit_strategy.selling_agent_fee_pct,
    seniorUnsolvableReason,
  ));

  // Cost-to-complete (spec §5.10, Release 2b Task 6). Computed for every appraisal —
  // schedule.term_months is always >= 1 (buildSchedule floors it), so the series is never
  // empty and this field is never actually null in practice (the type stays nullable only
  // because it was declared that way, unwired, in Task 1).
  const costToComplete = computeCostToComplete(schedule, model, inputs);

  return {
    calc_version: CALC_VERSION,
    gdv_pence: t.gdv_pence,
    lender_gdv_pence: lenderGdv == null ? null : lenderGdv.lender_gdv_pence,
    lender_gdv_variance_pence: lenderGdvVariance,
    lender_gdv_variance_pct: lenderGdvVariance == null ? null : pct(lenderGdvVariance, t.gdv_pence),
    acquisition_cost_pence: t.acquisition_pence,
    acquisition_tax_pence: sdlt,
    acquisition_tax: acquisitionTax,
    /** @deprecated R8 — use acquisition_tax_pence. Removed in R16. */
    sdlt_pence: sdlt,
    construction_cost_pence: t.construction_pence,
    professional_fees_pence: t.professional_pence,
    statutory_costs_pence: t.statutory_pence,
    selling_costs_pence: t.selling_costs_pence,
    cost_before_finance_pence: costBeforeFinance,
    finance_costs_pence: financeCosts,
    total_development_cost_pence: tdc,
    profit_pence: profit,
    profit_is_unrealised: profitIsUnrealised,
    has_realisation_event: hasRealisationEvent,
    return_on_equity_is_unrealised: profitIsUnrealised || !hasRealisationEvent,
    unrealised_value_pence: t.retained_value_pence,
    profit_on_cost_pct: pct(profit, tdc),
    profit_on_gdv_pct: pct(profit, t.gdv_pence),
    equity_contributed_pence: equityContributed,
    equity_multiple: equityMultiple,
    irr_monthly_pct: irrMonthly,
    irr_annual_pct: irrAnnual,
    rlv_pence: rlv,
    day_one_advance_pence: model.day_one_advance_pence,
    day_one_ltv_on_price_pct: price === 0 ? null : pct(model.day_one_advance_pence, price),
    day_one_ltv_on_value_pct: dayOneValue == null ? null : pct(model.day_one_advance_pence, dayOneValue),
    development_advances_pence: model.totals.draws_pence - model.day_one_advance_pence,
    net_ltc_pct: t.cost_before_finance_ex_selling_pence === 0
      ? null : pct(netAdvances, t.cost_before_finance_ex_selling_pence),
    gross_ltc_pct: tdc === 0 ? null : pct(model.peak_debt_pence, tdc),
    ltgdv_developer_pct: pct(model.peak_debt_pence, t.gdv_pence),
    ltgdv_lender_pct: lenderGdv == null ? null : pct(model.peak_debt_pence, lenderGdv.lender_gdv_pence),
    peak_debt_pence: model.peak_debt_pence,
    peak_debt_month: model.peak_debt_month,
    facility_headroom_pence: model.committed_gross_facility_pence > 0
      ? model.committed_gross_facility_pence - model.peak_debt_pence : null,
    interest_reserve_remaining_pence:
      model.months.length > 0
        ? model.months[model.months.length - 1].interest_reserve_remaining_pence
        : null,
    return_on_equity_pct: equityContributed > 0 ? pct(profit, equityContributed) : null,
    senior_breakeven_pence: seniorBreakeven,
    senior_breakeven_pct_of_lender_gdv: seniorBreakevenPctOfLenderGdv,
    senior_breakeven_fall_from_lender_gdv_pct: seniorBreakevenFallFromLenderGdvPct,
    developer_breakeven_pence: developerBreakeven,
    cost_to_complete: costToComplete,
    flags,
  };
}
