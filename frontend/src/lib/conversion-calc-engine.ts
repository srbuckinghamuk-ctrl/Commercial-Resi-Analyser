import type {
  AcquisitionInputs,
  AppraisalMetrics,
  CalculatorInputs,
  ConversionCostInputs,
  ExitStrategyInputs,
  FinanceSummary,
  ProposedUnit,
} from './conversion-types';
import { calculateCommercialSdlt } from './commercial-sdlt';

export function calculateGdv(units: ProposedUnit[]): number {
  return units.reduce((sum, u) => sum + u.estimated_value_pence, 0);
}

export function calculateTotalAcquisitionCost(acq: AcquisitionInputs): number {
  const sdlt = calculateCommercialSdlt(acq.purchase_price_pence).total_pence;
  const brokerFee = Math.round((acq.purchase_price_pence * acq.broker_fee_pct) / 100);
  return (
    acq.purchase_price_pence +
    sdlt +
    acq.legal_fees_pence +
    acq.survey_cost_pence +
    brokerFee +
    acq.other_acquisition_costs_pence
  );
}

export function calculateTotalConstructionCost(costs: ConversionCostInputs): number {
  const baseCost = costs.construction_cost_per_sqm_pence * costs.total_construction_sqm;
  const contingency = Math.round((baseCost * costs.contingency_pct) / 100);
  const compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence;
  return baseCost + contingency + compliance;
}

export function calculateTotalProfessionalFees(costs: ConversionCostInputs, unitCount: number = 1): number {
  return (
    costs.prior_approval_fee_per_dwelling_pence * Math.max(1, unitCount) +
    costs.cil_s106_pence +
    costs.architect_pence +
    costs.structural_engineer_pence +
    costs.mande_pence +
    costs.planning_consultant_pence +
    costs.building_control_pence +
    costs.other_professional_fees_pence
  );
}

/**
 * Disposal costs on the units actually sold: agent fee applies to the
 * sold value (GDV less retained units), sales legals apply when anything
 * is sold. A full-retention exit carries no disposal costs.
 */
export function calculateSellingCosts(exit: ExitStrategyInputs, units: ProposedUnit[]): number {
  const gdv = calculateGdv(units);
  const retainedValue = exit.retained_units.reduce((sum, r) => {
    const unit = units.find((u) => u.id === r.unit_id);
    return sum + (unit?.estimated_value_pence ?? 0);
  }, 0);
  const soldValue = exit.route === 'retain_all' ? 0 : Math.max(0, gdv - retainedValue);
  if (soldValue <= 0) return 0;
  const agentFee = Math.round((soldValue * exit.selling_agent_fee_pct) / 100);
  return agentFee + exit.selling_legal_fee_pence;
}

function npvAt(rate: number, cashflows: number[]): number {
  let npv = 0;
  for (let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + rate, t);
  }
  return npv;
}

/**
 * Periodic IRR in percent, or null when no meaningful IRR exists
 * (no sign change, or the solver fails to converge).
 */
export function calculateIrr(cashflows: number[], maxIterations = 1000, tolerance = 1e-7): number | null {
  if (cashflows.length < 2) return null;
  const hasNegative = cashflows.some((c) => c < 0);
  const hasPositive = cashflows.some((c) => c > 0);
  if (!hasNegative || !hasPositive) return null;

  // Newton-Raphson first.
  let guess = 0.01;
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + guess, t);
      npv += cashflows[t] / factor;
      if (t > 0) {
        dnpv -= (t * cashflows[t]) / Math.pow(1 + guess, t + 1);
      }
    }
    if (Math.abs(dnpv) < 1e-15) break;
    const newGuess = guess - npv / dnpv;
    if (!Number.isFinite(newGuess) || newGuess <= -1) break;
    if (Math.abs(newGuess - guess) < tolerance) {
      if (Number.isFinite(newGuess) && Math.abs(npvAt(newGuess, cashflows)) < 1) {
        return newGuess * 100;
      }
      break;
    }
    guess = newGuess;
  }

  // Bisection fallback over a plausible periodic-rate range.
  let lo = -0.99;
  let hi = 10;
  let npvLo = npvAt(lo, cashflows);
  const npvHi = npvAt(hi, cashflows);
  if (npvLo * npvHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAt(mid, cashflows);
    if (Math.abs(npvMid) < 1 || (hi - lo) / 2 < tolerance) return mid * 100;
    if (npvLo * npvMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return null;
}

export function calculateRlv(
  totalCostExLand: number,
  gdv: number,
  targetProfitOnCostPct: number,
): number {
  const targetMultiplier = 1 + targetProfitOnCostPct / 100;
  return Math.round(gdv / targetMultiplier - totalCostExLand);
}

/**
 * Monthly cost drawdown schedule shared by the finance model and the
 * cashflow view, so interest is computed the same way everywhere.
 * Month 0 is acquisition; construction and professional costs are spread
 * over the remaining term.
 */
export function buildDrawdownSchedule(inputs: CalculatorInputs): number[] {
  const totalMonths = Math.max(0, Math.floor(inputs.finance.loan_term_months));
  if (totalMonths <= 0) return [];

  const acquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const construction = calculateTotalConstructionCost(inputs.conversion_costs);
  const professional = calculateTotalProfessionalFees(inputs.conversion_costs, inputs.unit_mix.units.length);

  const constructionMonths = Math.max(1, totalMonths - 2);
  const monthlyConstruction = Math.round(construction / constructionMonths);
  const professionalMonths = Math.max(1, Math.ceil(constructionMonths / 2));
  const monthlyProfessional = Math.round(professional / professionalMonths);

  const drawdowns: number[] = [];
  for (let m = 0; m < totalMonths; m++) {
    let drawdown = 0;
    if (m === 0) drawdown = acquisition;
    if ((totalMonths === 1 || m >= 1) && m <= constructionMonths) drawdown += monthlyConstruction;
    if ((totalMonths === 1 || m >= 1) && m <= professionalMonths) drawdown += monthlyProfessional;
    drawdowns.push(drawdown);
  }
  return drawdowns;
}

/**
 * Single source of truth for debt sizing and finance costs.
 *
 * - Cash purchases carry no loan, no fees and no interest.
 * - The loan is sized as loan-to-cost against costs before finance.
 * - Equity is treated as drawn first; interest accrues only on the
 *   debt-funded portion of the cumulative drawdown.
 * - "Rolled up" interest compounds into the balance; "serviced"
 *   interest is paid monthly and does not compound.
 */
export function calculateFinance(inputs: CalculatorInputs): FinanceSummary {
  const totalCostBeforeFinance =
    calculateTotalAcquisitionCost(inputs.acquisition) +
    calculateTotalConstructionCost(inputs.conversion_costs) +
    calculateTotalProfessionalFees(inputs.conversion_costs, inputs.unit_mix.units.length);

  if (inputs.finance.funding_source === 'cash') {
    return {
      loan_amount_pence: 0,
      arrangement_fee_pence: 0,
      exit_fee_pence: 0,
      total_interest_pence: 0,
      total_finance_cost_pence: 0,
      monthly_interest_pence: buildDrawdownSchedule(inputs).map(() => 0),
    };
  }

  const ltv = Math.min(Math.max(inputs.finance.ltv_pct, 0), 100);
  const loanAmount = Math.round((totalCostBeforeFinance * ltv) / 100);
  const equityBeforeFinance = totalCostBeforeFinance - loanAmount;

  const arrangementFee = Math.round((loanAmount * inputs.finance.arrangement_fee_pct) / 100);
  const exitFee = Math.round((loanAmount * inputs.finance.exit_fee_pct) / 100);
  const monthlyRate = Math.max(0, inputs.finance.interest_rate_annual_pct) / 100 / 12;
  const rolledUp = inputs.finance.interest_type === 'rolled_up';

  const drawdowns = buildDrawdownSchedule(inputs);
  const monthlyInterest: number[] = [];
  let cumulativeDrawdown = 0;
  let rolledBalance = 0;
  let totalInterest = 0;

  for (const drawdown of drawdowns) {
    cumulativeDrawdown += drawdown;
    const debtDrawn = Math.min(loanAmount, Math.max(0, cumulativeDrawdown - equityBeforeFinance));
    const interestBase = debtDrawn + (rolledUp ? rolledBalance : 0);
    const interest = Math.round(interestBase * monthlyRate);
    if (rolledUp) rolledBalance += interest;
    totalInterest += interest;
    monthlyInterest.push(interest);
  }

  return {
    loan_amount_pence: loanAmount,
    arrangement_fee_pence: arrangementFee,
    exit_fee_pence: exitFee,
    total_interest_pence: totalInterest,
    total_finance_cost_pence: arrangementFee + exitFee + totalInterest,
    monthly_interest_pence: monthlyInterest,
  };
}

export function calculateAppraisal(inputs: CalculatorInputs): AppraisalMetrics {
  const gdv = calculateGdv(inputs.unit_mix.units);
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const totalAcquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const totalConstruction = calculateTotalConstructionCost(inputs.conversion_costs);
  const totalProfessional = calculateTotalProfessionalFees(inputs.conversion_costs, inputs.unit_mix.units.length);
  const totalSelling = calculateSellingCosts(inputs.exit_strategy, inputs.unit_mix.units);

  const totalCostBeforeFinance = totalAcquisition + totalConstruction + totalProfessional;
  const finance = calculateFinance(inputs);

  const totalCost = totalCostBeforeFinance + finance.total_finance_cost_pence + totalSelling;
  const profit = gdv - totalCost;

  // Equity covers everything the loan does not.
  const equityRequired = Math.max(0, totalCost - finance.loan_amount_pence);

  const profitOnCost = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const profitOnGdv = gdv > 0 ? (profit / gdv) * 100 : 0;
  const returnOnEquity = equityRequired > 0 ? (profit / equityRequired) * 100 : 0;

  const termMonths = Math.max(0, Math.floor(inputs.finance.loan_term_months));
  const cashflows: number[] = [];
  cashflows.push(-equityRequired);
  for (let m = 1; m < termMonths; m++) {
    cashflows.push(0);
  }
  cashflows.push(profit + equityRequired);

  const irrMonthly = calculateIrr(cashflows);
  const irrAnnual = irrMonthly === null ? null : (Math.pow(1 + irrMonthly / 100, 12) - 1) * 100;

  const totalCostExLand = totalCost - inputs.acquisition.purchase_price_pence - sdlt;
  const rlv = calculateRlv(totalCostExLand, gdv, 20);

  return {
    total_gdv_pence: gdv,
    total_acquisition_cost_pence: totalAcquisition,
    sdlt_pence: sdlt,
    total_construction_cost_pence: totalConstruction,
    total_professional_fees_pence: totalProfessional,
    total_selling_costs_pence: totalSelling,
    total_finance_cost_pence: finance.total_finance_cost_pence,
    arrangement_fee_pence: finance.arrangement_fee_pence,
    exit_fee_pence: finance.exit_fee_pence,
    total_interest_pence: finance.total_interest_pence,
    total_cost_pence: totalCost,
    profit_pence: profit,
    profit_on_cost_pct: Math.round(profitOnCost * 100) / 100,
    profit_on_gdv_pct: Math.round(profitOnGdv * 100) / 100,
    return_on_equity_pct: Math.round(returnOnEquity * 100) / 100,
    irr_monthly: irrMonthly === null ? null : Math.round(irrMonthly * 100) / 100,
    irr_annual: irrAnnual === null ? null : Math.round(irrAnnual * 100) / 100,
    rlv_pence: rlv,
    equity_required_pence: equityRequired,
    loan_amount_pence: finance.loan_amount_pence,
  };
}
