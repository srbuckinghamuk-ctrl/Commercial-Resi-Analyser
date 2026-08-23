import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExitAnchorControl from './ExitAnchorControl';
import type { Phase } from '../../lib/model';

// Real `Phase` shape (programme.ts), not the brief's illustrative fixture.
// Kept in brief order (Construction, Practical completion, Marketing) so the
// "offers every phase" assertion below reads the same as the task brief's.
const PHASES: Phase[] = [
  {
    id: 'construction', code: 'construction', label: 'Construction', duration_months: 8,
    slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [],
  },
  {
    id: 'pc', code: 'practical_completion', label: 'Practical completion', duration_months: 0,
    slip_months: 0, start_offset: 8, curve: { kind: 'straight_line' }, predecessors: [],
  },
  {
    id: 'marketing', code: 'marketing', label: 'Marketing', duration_months: 3,
    slip_months: 0, start_offset: 8, curve: { kind: 'straight_line' }, predecessors: [],
  },
];

describe('ExitAnchorControl (§18.6, the control R12 never shipped)', () => {
  it('offers "fixed month" plus every phase in the network', () => {
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={12} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('__fixed__');
    expect(screen.getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Fixed month', 'Construction', 'Practical completion', 'Marketing']);
  });

  it('emits a PhaseAnchor when a phase is chosen, and null when fixed is chosen back', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pc' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'pc', offset_months: 0 });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__fixed__' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('is disabled with an explanation when there is no programme network', () => {
    render(<ExitAnchorControl value={null} phases={[]} monthOffset={12} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText(/needs a programme/i)).toBeInTheDocument();
  });

  it('accepts a SIGNED offset — "practical completion minus one month" is a real ask', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={{ phase_id: 'pc', offset_months: 0 }} phases={PHASES}
      monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/months after/i), { target: { value: '-1' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'pc', offset_months: -1 });
  });

  // The interface-only guards not spelled out in the brief but load-bearing
  // for "presentational, no resolution": offset editing never touches
  // `phase_id`, and picking a DIFFERENT phase while already anchored resets
  // the offset to 0 rather than carrying the old one over silently.
  it('never mutates phase_id when the offset changes', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={{ phase_id: 'pc', offset_months: 3 }} phases={PHASES}
      monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/months after/i), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'pc', offset_months: 5 });
  });

  it('switching to a different phase resets the offset to 0, not the prior offset', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={{ phase_id: 'pc', offset_months: 5 }} phases={PHASES}
      monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'marketing' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'marketing', offset_months: 0 });
  });

  it('shows the raw month_offset as a hint when the anchor is fixed, not anchored', () => {
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={17} onChange={vi.fn()} />);
    expect(screen.getByText(/17/)).toBeInTheDocument();
  });

  it('does not render an offset input at all when fixed (no anchor value to edit)', () => {
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={12} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/months after/i)).not.toBeInTheDocument();
  });
});
