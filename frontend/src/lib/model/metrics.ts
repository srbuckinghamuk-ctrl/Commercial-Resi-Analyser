import type {
  AppraisalResultV2, CalculatorInputsV2, CalculatorInputsV3, MonthlyModel, Schedule,
} from './finance-types';
import { CALC_VERSION } from './finance-types';
import { solveIrr } from './irr';
import { calculateCommercialSdlt } from '../commercial-sdlt';
import { computeLenderGdv } from './lender-valuation';
import { exitFeeAmount } from './monthly-engine';
import { solveDeveloperBreakeven, solveSeniorBreakeven } from './breakeven';
import type { DeveloperBreakevenTerms, SeniorBreakevenTerms } from './breakeven';
import { computeCostToComplete } from './cost-to-complete';

/** Percentage to 2 dp; null when the denominator is zero (spec §1.5). */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function deriveMetrics(
  inputs: CalculatorInputsV2 | CalculatorInputsV3, schedule: Schedule, model: MonthlyModel,
): AppraisalResultV2 {
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
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const costBeforeFinance = t.cost_before_finance_ex_selling_pence + t.selling_costs_pence;
  const financeCosts = model.totals.finance_costs_pence;
  const tdc = costBeforeFinance + financeCosts;
  const grossReceipts = t.gross_sales_pence;
  const profit = grossReceipts + t.retained_value_pence - tdc;
  const profitIsUnrealised = t.retained_value_pence > 0;

  const equityContributed = model.totals.equity_contributed_pence + model.totals.additional_equity_pence;
  const equityMultiple = equityContributed > 0
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
  const redemptionBalance = model.redemption_balance_at_disposal_pence;
  let seniorBreakeven: number | null = null;
  let seniorBreakevenPctOfLenderGdv: number | null = null;
  let seniorBreakevenFallFromLenderGdvPct: number | null = null;
  if (redemptionBalance != null) {
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
    if (seniorBreakeven == null && breakevenTerms.selling_agent_fee_pct >= 100) {
      model.flags.push({
        code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
        message: 'agent fee ≥ 100% — break-even unsolvable',
      });
    }
    if (seniorBreakeven != null && lenderGdv != null) {
      seniorBreakevenPctOfLenderGdv = pct(seniorBreakeven, lenderGdv.lender_gdv_pence);
      seniorBreakevenFallFromLenderGdvPct =
        pct(lenderGdv.lender_gdv_pence - seniorBreakeven, lenderGdv.lender_gdv_pence);
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
  if (t.gross_sales_pence > 0) {
    const tdcExSelling = tdc - t.selling_costs_pence;
    const developerBreakevenTerms: DeveloperBreakevenTerms = {
      tdc_ex_selling_pence: tdcExSelling,
      selling_agent_fee_pct: inputs.exit_strategy.selling_agent_fee_pct,
      selling_legal_fee_pence: inputs.exit_strategy.selling_legal_fee_pence,
    };
    developerBreakeven = solveDeveloperBreakeven(developerBreakevenTerms);
    if (developerBreakeven == null && developerBreakevenTerms.selling_agent_fee_pct >= 100) {
      model.flags.push({
        code: 'developer_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
        message: 'agent fee ≥ 100% — break-even unsolvable',
      });
    }
  }

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
  };
}
