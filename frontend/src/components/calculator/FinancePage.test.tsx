import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FinancePage from './FinancePage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV7 } from '../../lib/model';
import { defaultCalculatorInputsV7 } from '../../lib/conversion-defaults';

function setup(inputs: CalculatorInputsV7, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<FinancePage inputs={inputs} onChange={onChange} run={run} />);
  return { onChange, run };
}

describe('FinancePage — lender valuation entry card wiring', () => {
  it('shows the "no lender valuation recorded" empty state when the block is absent', () => {
    const inputs: CalculatorInputsV7 = { ...defaultCalculatorInputsV7(), lender_valuation: null };
    setup(inputs);
    expect(screen.getByText(/no lender valuation recorded/i)).toBeInTheDocument();
  });

  it('adding a lender valuation from the card calls the page onChange with lender_valuation set', () => {
    const inputs: CalculatorInputsV7 = { ...defaultCalculatorInputsV7(), lender_valuation: null };
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /add lender valuation/i }));
    expect(onChange).toHaveBeenCalledWith({
      lender_valuation: {
        basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '',
      },
    });
  });

  it('surfaces lender_valuation validation errors from the live run on the entry card', () => {
    const inputs: CalculatorInputsV7 = {
      ...defaultCalculatorInputsV7(),
      lender_valuation: {
        basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '',
      },
    };
    setup(inputs);
    // Both the reconciliation strip (all validation issues) and the lender valuation card
    // (scoped to lender_valuation.*) surface these — assert at least one instance of each.
    expect(screen.getAllByText('Lender valuation reason is required.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lender valuation author is required.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lender valuation date is required.').length).toBeGreaterThan(0);
  });

  it('renders the enforcement cost assumption field with its current value', () => {
    const inputs: CalculatorInputsV7 = {
      ...defaultCalculatorInputsV7(),
      finance: { ...defaultCalculatorInputsV7().finance, funding_source: 'development_finance', enforcement_cost_assumption_pence: 50_000 },
    };
    setup(inputs);
    expect(screen.getByText('Enforcement cost assumption (£)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });
});
