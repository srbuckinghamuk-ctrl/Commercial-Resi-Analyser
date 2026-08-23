import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InvestmentCaseCard from './InvestmentCaseCard';
import type { InvestmentCaseInputs, InvestmentCaseResult } from '../../lib/model';

const IC: InvestmentCaseInputs = {
  stabilisation: { anchor: null, month_offset: 16, ramp_months: 3, stabilised_occupancy_pct: 96 },
  operating_lines: [
    { id: 'l1', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
    { id: 'l2', code: 'letting_and_re_letting', label: 'Letting and re-letting', basis: 'pct_of_gross_rent', value: 2 },
    { id: 'l3', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25_000 },
    { id: 'l4', code: 'compliance_and_safety', label: 'Compliance and safety', basis: 'fixed_pence_per_month', value: 8_000 },
  ],
  valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
  takeout: {
    ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3, annual_rate_pct: 6,
    amortisation_years: 25, term_years: 5,
  },
};

// A hand-picked, internally-consistent result -- NOT the engine's real
// t-investment-case.json output. This card must print whatever `result` it
// is given (that is the whole point of the third test below), so round
// numbers here just keep the assertions legible. DSCR is deliberately the
// lowest of the three AND deliberately unequal to ICR (unlike the
// interest-only case spec §19.4 calls out, where the two caps coincide) --
// so a card that echoed one cap for both would fail this.
const DSCR_BINDS: InvestmentCaseResult = {
  stabilisation_month: 16,
  months: [],
  stabilised: {
    effective_gross_rent_pence: 283_200, operating_cost_pence: 66_984,
    monthly_noi_pence: 216_216, annual_noi_pence: 2_594_592,
  },
  operating_lines: IC.operating_lines.map((l) => ({ ...l, stabilised_monthly_pence: 0 })),
  valuation: {
    cap_yield_pct: 5.5, purchasers_costs_pct: 6.75,
    gross_value_pence: 2_000_000_000, investment_value_pence: 2_000_000_000,
  },
  takeout: {
    ltv_cap_pence: 1_300_000_000, dscr_cap_pence: 641_025_600, icr_cap_pence: 700_000_000,
    quantum_pence: 641_025_600, binding_constraint: 'dscr', annual_debt_service_factor: 0.078,
    achieved_ltv_pct: 49.3, achieved_dscr: 1.3, achieved_icr: 1.19,
    is_booked: true,
  },
  totals: { effective_gross_rent_pence: 0, operating_cost_pence: 0, noi_pence: 0 },
};

describe('InvestmentCaseCard (§19.6)', () => {
  it('shows all three caps and marks which one binds', () => {
    render(<InvestmentCaseCard inputs={IC} result={DSCR_BINDS} onChange={vi.fn()} />);
    expect(screen.getByText(/LTV cap/i).closest('tr')).toHaveTextContent('£13,000,000');
    expect(screen.getByText(/DSCR cap/i).closest('tr')).toHaveTextContent('£6,410,256');
    expect(screen.getByText(/ICR cap/i).closest('tr')).toHaveTextContent('£7,000,000');
    expect(screen.getByText(/DSCR cap/i).closest('tr')).toHaveAttribute('data-binding', 'true');
    expect(screen.getByText(/LTV cap/i).closest('tr')).toHaveAttribute('data-binding', 'false');
    expect(screen.getByText(/ICR cap/i).closest('tr')).toHaveAttribute('data-binding', 'false');
  });

  it('labels the case indicative when nothing is booked', () => {
    render(
      <InvestmentCaseCard
        inputs={IC}
        result={{ ...DSCR_BINDS, takeout: { ...DSCR_BINDS.takeout, is_booked: false } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/indicative/i)).toBeInTheDocument();
  });

  it('reads every figure from the result block and computes none of them', () => {
    // Governance: no calculation logic in React. Feed the card a result whose
    // numbers are deliberately inconsistent with its inputs; the card must
    // print the RESULT's numbers, proving it is not recomputing.
    render(
      <InvestmentCaseCard
        inputs={IC}
        result={{ ...DSCR_BINDS, valuation: { ...DSCR_BINDS.valuation, investment_value_pence: 1_23 } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('£1.23')).toBeInTheDocument();
  });

  it('calls onChange with the whole updated case when a policy field is edited', () => {
    const onChange = vi.fn();
    render(<InvestmentCaseCard inputs={IC} result={DSCR_BINDS} onChange={onChange} />);
    // Cap yield is the only 5.5-valued number input on the page.
    fireEvent.change(screen.getByDisplayValue('5.5'), { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({
      ...IC,
      valuation: { ...IC.valuation, cap_yield_pct: 6 },
    });
  });
});
