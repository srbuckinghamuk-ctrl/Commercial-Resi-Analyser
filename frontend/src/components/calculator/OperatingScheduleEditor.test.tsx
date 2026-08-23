import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import OperatingScheduleEditor from './OperatingScheduleEditor';
import type { OperatingLine, InvestmentCaseResult } from '../../lib/model';

const LINES: OperatingLine[] = [
  { id: 'l1', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
  { id: 'l2', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25_000 },
];

// R13 spec §19. Hand-derived against fixtures/financial-model/t-investment-case.json's
// own worked example (task-15-brief.md's "Figures in your brief" note, verified there
// rather than trusted): stabilised EGR 283,200 pence; a 10% management line on that
// EGR is round(283,200 * 10 / 100) = 28,320 pence = £283.20.
const RESULT: InvestmentCaseResult = {
  stabilisation_month: 16,
  months: [],
  stabilised: {
    effective_gross_rent_pence: 283_200,
    operating_cost_pence: 53_320,
    monthly_noi_pence: 229_880,
    annual_noi_pence: 2_758_560,
  },
  operating_lines: [
    { ...LINES[0], stabilised_monthly_pence: 28_320 },
    { ...LINES[1], stabilised_monthly_pence: 25_000 },
  ],
  valuation: {
    cap_yield_pct: 5.5, purchasers_costs_pct: 6.75,
    gross_value_pence: 50_155_636, investment_value_pence: 46_999_659,
  },
  takeout: {
    ltv_cap_pence: 30_549_778, dscr_cap_pence: 27_444_615, icr_cap_pence: 35_366_923,
    quantum_pence: 27_444_615, binding_constraint: 'dscr', annual_debt_service_factor: 0.0773161682,
    achieved_ltv_pct: 58.4, achieved_dscr: 1.3, achieved_icr: 1.008,
    is_booked: true,
  },
  totals: { effective_gross_rent_pence: 0, operating_cost_pence: 0, noi_pence: 0 },
};

describe('OperatingScheduleEditor (§19.1)', () => {
  it('offers the ten opex codes', () => {
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={vi.fn()} />);
    expect(screen.getAllByRole('option', { name: /management|insurance|bad debt/i }).length)
      .toBeGreaterThan(0);
    expect(within(screen.getAllByRole('combobox')[0]).getAllByRole('option')).toHaveLength(10);
  });

  it('shows each line\'s stabilised monthly cost from the result, not from its own maths', () => {
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={vi.fn()} />);
    // Governance: no calculation logic in React. l1 is a 10% management line
    // on `value: 10`, but the assertion below is what `result` says, not
    // 10% of anything this component could compute itself.
    expect(screen.getByTestId('line-l1-stabilised')).toHaveTextContent('£283.20');
  });

  it('adds a line with a unique id, appended to the existing lines unchanged', () => {
    const onChange = vi.fn();
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add operating cost/i }));
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(3);
    expect(new Set(added.map((l: OperatingLine) => l.id)).size).toBe(3);
    expect(added.slice(0, 2)).toEqual(LINES);
  });

  it('removes a line by id, leaving the others untouched', () => {
    const onChange = vi.fn();
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove management fee/i }));
    expect(onChange).toHaveBeenCalledWith([LINES[1]]);
  });
});
