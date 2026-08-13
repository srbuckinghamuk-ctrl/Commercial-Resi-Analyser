import type {
  AppraisalResultV2, CalculatorInputsV2, CalculatorInputsV3, MonthlyModel, Schedule,
} from './finance-types';
import { CALC_VERSION } from './finance-types';
import { solveIrr } from './irr';
import { calculateCommercialSdlt } from '../commercial-sdlt';
import { computeLenderGdv } from './lender-valuation';

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
  // (no lender_valuation field at all) or v3 inputs with the block absent —
  // never silently defaulted to developer GDV (spec §2).
  const lenderGdv = 'lender_valuation' in inputs ? computeLenderGdv(inputs) : null;
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
    senior_breakeven_pence: null, // Task 4
    senior_breakeven_pct_of_lender_gdv: null, // Task 4
    senior_breakeven_fall_from_lender_gdv_pct: null, // Task 4
    developer_breakeven_pence: null, // Task 5
    cost_to_complete: null, // Task 6
  };
}
