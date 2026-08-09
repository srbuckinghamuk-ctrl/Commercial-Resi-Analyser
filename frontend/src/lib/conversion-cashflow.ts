import type { CalculatorInputs, CashflowMonth, CashflowResult } from './conversion-types';
import {
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
  calculateGdv,
} from './conversion-calc-engine';

export function buildCashflow(inputs: CalculatorInputs): CashflowResult {
  const totalMonths = inputs.finance.loan_term_months;
  if (totalMonths <= 0) {
    return { months: [], peak_funding_pence: 0, total_interest_pence: 0 };
  }

  const acquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const construction = calculateTotalConstructionCost(inputs.conversion_costs);
  const professional = calculateTotalProfessionalFees(inputs.conversion_costs);
  const gdv = calculateGdv(inputs.unit_mix.units);

  const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
  const constructionMonths = Math.max(1, totalMonths - 2);
  const monthlyConstruction = Math.round(construction / constructionMonths);
  const professionalMonths = Math.max(1, Math.ceil(constructionMonths / 2));
  const monthlyProfessional = Math.round(professional / professionalMonths);

  const months: CashflowMonth[] = [];
  let cumulativeDrawdown = 0;
  let cumulativeInterest = 0;
  let cumulativeCashflow = 0;
  let peakFunding = 0;

  for (let m = 0; m < totalMonths; m++) {
    let drawdown = 0;
    let income = 0;

    if (m === 0) {
      drawdown = acquisition;
    }

    if (m >= 1 && m <= constructionMonths) {
      drawdown += monthlyConstruction;
    }

    if (m >= 1 && m <= professionalMonths) {
      drawdown += monthlyProfessional;
    }

    if (m === totalMonths - 1) {
      income = gdv;
    }

    cumulativeDrawdown += drawdown;
    const interest = Math.round(cumulativeDrawdown * monthlyRate);
    cumulativeInterest += interest;

    const netCashflow = income - drawdown - interest;
    cumulativeCashflow += netCashflow;

    const fundingPosition = cumulativeDrawdown + cumulativeInterest - income;
    if (fundingPosition > peakFunding) {
      peakFunding = fundingPosition;
    }

    months.push({
      month: m + 1,
      label: `Month ${m + 1}`,
      drawdown_pence: drawdown,
      cumulative_drawdown_pence: cumulativeDrawdown,
      interest_pence: interest,
      cumulative_interest_pence: cumulativeInterest,
      income_pence: income,
      net_cashflow_pence: netCashflow,
      cumulative_cashflow_pence: cumulativeCashflow,
    });
  }

  return {
    months,
    peak_funding_pence: peakFunding,
    total_interest_pence: cumulativeInterest,
  };
}
