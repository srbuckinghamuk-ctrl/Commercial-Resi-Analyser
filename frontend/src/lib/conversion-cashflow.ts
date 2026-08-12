import type { CalculatorInputs, CashflowMonth, CashflowResult } from './conversion-types';
import { buildDrawdownSchedule, calculateFinance, calculateGdv } from './conversion-calc-engine';

export function buildCashflow(inputs: CalculatorInputs): CashflowResult {
  const drawdowns = buildDrawdownSchedule(inputs);
  if (drawdowns.length === 0) {
    return { months: [], peak_funding_pence: 0, total_interest_pence: 0 };
  }

  const gdv = calculateGdv(inputs.unit_mix.units);
  const finance = calculateFinance(inputs);
  const totalMonths = drawdowns.length;

  const months: CashflowMonth[] = [];
  let cumulativeDrawdown = 0;
  let cumulativeInterest = 0;
  let cumulativeCashflow = 0;
  let peakFunding = 0;

  for (let m = 0; m < totalMonths; m++) {
    const drawdown = drawdowns[m];
    const income = m === totalMonths - 1 ? gdv : 0;

    cumulativeDrawdown += drawdown;
    const interest = finance.monthly_interest_pence[m] ?? 0;
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
