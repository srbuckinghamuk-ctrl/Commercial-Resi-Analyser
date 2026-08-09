import type {
  AcquisitionInputs,
  AppraisalMetrics,
  CalculatorInputs,
  ConversionCostInputs,
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
  const baseCost = costs.construction_cost_per_sqft_pence * costs.total_construction_sqft;
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

export function calculateIrr(cashflows: number[], maxIterations = 1000, tolerance = 1e-7): number {
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
    if (Math.abs(newGuess - guess) < tolerance) return newGuess * 100;
    guess = newGuess;
  }
  return guess * 100;
}

export function calculateRlv(
  totalCostExLand: number,
  gdv: number,
  targetProfitOnCostPct: number,
): number {
  const targetMultiplier = 1 + targetProfitOnCostPct / 100;
  return Math.round(gdv / targetMultiplier - totalCostExLand);
}

export function calculateAppraisal(inputs: CalculatorInputs): AppraisalMetrics {
  const gdv = calculateGdv(inputs.unit_mix.units);
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const totalAcquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const totalConstruction = calculateTotalConstructionCost(inputs.conversion_costs);
  const totalProfessional = calculateTotalProfessionalFees(inputs.conversion_costs, inputs.unit_mix.units.length);

  const totalCostBeforeFinance = totalAcquisition + totalConstruction + totalProfessional;
  const loanAmount = Math.round((totalCostBeforeFinance * inputs.finance.ltv_pct) / 100);
  const equityRequired = totalCostBeforeFinance - loanAmount;

  const arrangementFee = Math.round((loanAmount * inputs.finance.arrangement_fee_pct) / 100);
  const exitFee = Math.round((loanAmount * inputs.finance.exit_fee_pct) / 100);
  const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
  const totalInterest = Math.round(loanAmount * monthlyRate * inputs.finance.loan_term_months);
  const totalFinanceCost = arrangementFee + exitFee + totalInterest;

  const totalCost = totalCostBeforeFinance + totalFinanceCost;
  const profit = gdv - totalCost;

  const profitOnCost = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const profitOnGdv = gdv > 0 ? (profit / gdv) * 100 : 0;
  const returnOnEquity = equityRequired > 0 ? (profit / equityRequired) * 100 : 0;

  const cashflows: number[] = [];
  cashflows.push(-equityRequired);
  for (let m = 1; m < inputs.finance.loan_term_months; m++) {
    cashflows.push(0);
  }
  cashflows.push(profit + equityRequired);

  const irrMonthly = cashflows.length > 1 ? calculateIrr(cashflows) : 0;
  const irrAnnual = (Math.pow(1 + irrMonthly / 100, 12) - 1) * 100;

  const totalCostExLand = totalCost - inputs.acquisition.purchase_price_pence - sdlt;
  const rlv = calculateRlv(totalCostExLand, gdv, 20);

  return {
    total_gdv_pence: gdv,
    total_acquisition_cost_pence: totalAcquisition,
    sdlt_pence: sdlt,
    total_construction_cost_pence: totalConstruction,
    total_professional_fees_pence: totalProfessional,
    total_finance_cost_pence: totalFinanceCost,
    total_cost_pence: totalCost,
    profit_pence: profit,
    profit_on_cost_pct: Math.round(profitOnCost * 100) / 100,
    profit_on_gdv_pct: Math.round(profitOnGdv * 100) / 100,
    return_on_equity_pct: Math.round(returnOnEquity * 100) / 100,
    irr_monthly: Math.round(irrMonthly * 100) / 100,
    irr_annual: Math.round(irrAnnual * 100) / 100,
    rlv_pence: rlv,
    equity_required_pence: equityRequired,
    loan_amount_pence: loanAmount,
  };
}
