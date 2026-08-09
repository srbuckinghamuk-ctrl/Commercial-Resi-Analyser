import { describe, it, expect } from 'vitest';
import { buildCashflow } from './conversion-cashflow';
import { defaultCalculatorInputs } from './conversion-defaults';

describe('buildCashflow', () => {
  it('returns months array matching loan term', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.months).toHaveLength(12);
  });

  it('month 1 has acquisition drawdown', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.months[0].drawdown_pence).toBeGreaterThan(0);
    expect(result.months[0].label).toBe('Month 1');
  });

  it('final month has income from sales', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 30_000_000, comparable_notes: '' },
    ];
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    const lastMonth = result.months[result.months.length - 1];
    expect(lastMonth.income_pence).toBeGreaterThan(0);
  });

  it('tracks cumulative drawdown', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 6;
    const result = buildCashflow(inputs);
    for (let i = 1; i < result.months.length; i++) {
      expect(result.months[i].cumulative_drawdown_pence).toBeGreaterThanOrEqual(
        result.months[i - 1].cumulative_drawdown_pence,
      );
    }
  });

  it('accrues interest each month for rolled-up finance', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.interest_type = 'rolled_up';
    inputs.finance.loan_term_months = 6;
    const result = buildCashflow(inputs);
    expect(result.total_interest_pence).toBeGreaterThan(0);
  });

  it('calculates peak funding', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.peak_funding_pence).toBeGreaterThan(0);
  });
});
