import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LenderValuationCard from './LenderValuationCard';
import type { LenderValuation, ValidationIssue } from '../../lib/model';
import type { ProposedUnit } from '../../lib/conversion-types';

const UNITS: ProposedUnit[] = [
  { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
  { id: 'u2', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 35_000_000, comparable_notes: '' },
];

// Fixture-G-shaped lender valuation (fixtures/financial-model/g-lender-valuation.json):
// global_pct haircut of -10%, with full provenance.
const FIXTURE_G_LENDER_VALUATION: LenderValuation = {
  basis: 'global_pct',
  global_value: -10,
  per_key_values: null,
  reason: 'Fixture: lender haircut for valuation-basis testing',
  author: 'governance',
  date: '2026-08-13',
};

describe('LenderValuationCard — null state', () => {
  it('renders the explicit "no lender valuation recorded" empty state', () => {
    render(<LenderValuationCard lenderValuation={null} units={UNITS} validationIssues={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no lender valuation recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Basis$/)).not.toBeInTheDocument();
  });

  it('adding a lender valuation calls onChange with a fresh, empty block', () => {
    const onChange = vi.fn();
    render(<LenderValuationCard lenderValuation={null} units={UNITS} validationIssues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add lender valuation/i }));
    expect(onChange).toHaveBeenCalledWith({
      basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '',
    });
  });
});

describe('LenderValuationCard — populated (fixture-G-shaped)', () => {
  it('renders the basis, value and provenance fields with the recorded values', () => {
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Global % adjustment')).toBeInTheDocument();
    expect(screen.getByDisplayValue('-10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fixture: lender haircut for valuation-basis testing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('governance')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-08-13')).toBeInTheDocument();
  });

  it('removing the lender valuation calls onChange(null)', () => {
    const onChange = vi.fn();
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('switching basis resets global_value and per_key_values (never carries stale values across bases)', () => {
    const onChange = vi.fn();
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Global % adjustment'), { target: { value: 'fixed_amount' } });
    expect(onChange).toHaveBeenCalledWith({
      ...FIXTURE_G_LENDER_VALUATION,
      basis: 'fixed_amount',
      global_value: null,
      per_key_values: null,
    });
  });

  it('editing the reason field calls onChange with the updated reason, other fields untouched', () => {
    const onChange = vi.fn();
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Fixture: lender haircut for valuation-basis testing'), {
      target: { value: 'Updated reason' },
    });
    expect(onChange).toHaveBeenCalledWith({ ...FIXTURE_G_LENDER_VALUATION, reason: 'Updated reason' });
  });

  it('shows a per-unit £ input row for each unit under the per_unit basis', () => {
    const perUnit: LenderValuation = {
      ...FIXTURE_G_LENDER_VALUATION, basis: 'per_unit', global_value: null,
      per_key_values: { u1: 28_000_000, u2: 32_000_000 },
    };
    render(<LenderValuationCard lenderValuation={perUnit} units={UNITS} validationIssues={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Unit 1/)).toBeInTheDocument();
    expect(screen.getByText(/Unit 2/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('280000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('320000')).toBeInTheDocument();
  });
});

describe('LenderValuationCard — validation errors', () => {
  it('renders lender_valuation-scoped validation messages, ignoring unrelated ones', () => {
    const issues: ValidationIssue[] = [
      { severity: 'error', field: 'lender_valuation.reason', message: 'Lender valuation reason is required.' },
      { severity: 'error', field: 'finance.term_months', message: 'Term must be a whole number of months, at least 1.' },
    ];
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={issues}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Lender valuation reason is required.')).toBeInTheDocument();
    expect(screen.queryByText('Term must be a whole number of months, at least 1.')).not.toBeInTheDocument();
  });

  it('renders no error panel when there are no lender_valuation issues', () => {
    render(
      <LenderValuationCard
        lenderValuation={FIXTURE_G_LENDER_VALUATION}
        units={UNITS}
        validationIssues={[{ severity: 'warning', field: 'finance', message: 'unrelated' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument();
  });
});
