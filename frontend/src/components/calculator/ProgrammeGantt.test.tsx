import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgrammeGantt from './ProgrammeGantt';
import type { ProgrammeDerivation } from '../../lib/model';

// Hand-built derivation -- no engine call. `design` is off the critical path
// with three months' float; `construction` is critical with none; `pc` is a
// zero-duration milestone that is also critical. Distinct numbers throughout
// so a wrong-field read (e.g. reading finish_month where start_month belongs)
// produces a distinct, catchable failure rather than an accidental pass.
function buildDerivation(): ProgrammeDerivation {
  const phases = [
    {
      id: 'design', code: 'design' as const, label: 'Design', start_month: 0, finish_month: 2,
      duration_months: 2, slip_months: 0, total_float_months: 3, is_critical: false,
    },
    {
      id: 'construction', code: 'construction' as const, label: 'Construction', start_month: 2, finish_month: 10,
      duration_months: 8, slip_months: 0, total_float_months: 0, is_critical: true,
    },
    {
      id: 'pc', code: 'practical_completion' as const, label: 'Practical completion', start_month: 10, finish_month: 10,
      duration_months: 0, slip_months: 0, total_float_months: 0, is_critical: true,
    },
  ];
  const byId = Object.fromEntries(phases.map((p) => [p.id, p]));
  return {
    finish_month: 10,
    critical_path: ['construction', 'pc'],
    order: ['design', 'construction', 'pc'],
    byId,
    phases,
  };
}

describe('ProgrammeGantt', () => {
  it('renders one row per phase', () => {
    render(<ProgrammeGantt derivation={buildDerivation()} />);
    // Row wrappers use `display: contents`, but each still exposes role="row".
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Construction')).toBeInTheDocument();
    expect(screen.getByText('Practical completion')).toBeInTheDocument();
  });

  it('marks the critical path with a distinct token, and leaves non-critical phases unmarked', () => {
    render(<ProgrammeGantt derivation={buildDerivation()} />);
    expect(screen.getByLabelText('Construction bar: months 2 to 10, critical')).toBeInTheDocument();
    // Exact-string match: a non-critical bar must NOT carry the ", critical" suffix.
    expect(screen.getByLabelText('Design bar: months 0 to 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Design bar: months 0 to 2, critical')).not.toBeInTheDocument();
  });

  it('renders a duration_months: 0 milestone as a marker, not a zero-width bar', () => {
    render(<ProgrammeGantt derivation={buildDerivation()} />);
    expect(screen.getByLabelText('Practical completion milestone at month 10, critical')).toBeInTheDocument();
    // The single-line-change this catches: dropping the `isMilestone` branch
    // and always rendering the bar element would print a "bar: months 10 to 10"
    // label instead -- a real element, invisible on screen, that this query
    // would not find because the text differs.
    expect(screen.queryByLabelText(/Practical completion bar:/)).not.toBeInTheDocument();
  });

  it('shows float as a lighter trailing segment only when float is greater than zero', () => {
    render(<ProgrammeGantt derivation={buildDerivation()} />);
    expect(screen.getByLabelText('Design float: 3 months')).toBeInTheDocument();
    // Construction and pc both have zero float -- no float segment for either.
    expect(screen.queryByLabelText(/Construction float:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Practical completion float:/)).not.toBeInTheDocument();
  });
});
