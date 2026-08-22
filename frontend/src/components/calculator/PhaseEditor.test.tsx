import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PhaseEditor from './PhaseEditor';
import type { Phase, DerivedPhase } from '../../lib/model';

// Distinct, non-colliding numbers throughout (mirrors ProgrammePage.test.tsx's
// own EDIT_PROGRAMME fixture comment) so a query can target a single cell.
const PHASES: Phase[] = [
  {
    id: 'design', code: 'design', label: 'Design', duration_months: 2, slip_months: 0,
    start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [],
  },
  {
    id: 'construction', code: 'construction', label: 'Construction', duration_months: 8, slip_months: 1,
    start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'design', type: 'FS', lag_months: 0 }],
  },
];

const DERIVED_BY_ID: Record<string, DerivedPhase> = {
  design: {
    id: 'design', code: 'design', label: 'Design', start_month: 0, finish_month: 2,
    duration_months: 2, slip_months: 0, total_float_months: 5, is_critical: false,
  },
  construction: {
    id: 'construction', code: 'construction', label: 'Construction', start_month: 3, finish_month: 11,
    duration_months: 8, slip_months: 1, total_float_months: 0, is_critical: true,
  },
};

// Column order the component renders, used to index into each row's cells.
const COL = {
  label: 0, code: 1, duration: 2, slip: 3, startOffset: 4, curve: 5,
  start: 6, finish: 7, float: 8, predecessors: 9, actions: 10,
};

function bodyRows() {
  const table = screen.getByRole('table', { name: 'Phases' });
  return within(table).getAllByRole('row').slice(1); // drop the header row
}

describe('PhaseEditor', () => {
  it('renders one row per phase with its derived start, finish and float', () => {
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={vi.fn()} />);
    const rows = bodyRows();
    expect(rows).toHaveLength(2);

    const designCells = within(rows[0]).getAllByRole('cell');
    expect(designCells[COL.start]).toHaveTextContent('0');
    expect(designCells[COL.finish]).toHaveTextContent('2');
    expect(designCells[COL.float]).toHaveTextContent('5');

    const constructionCells = within(rows[1]).getAllByRole('cell');
    expect(constructionCells[COL.start]).toHaveTextContent('3');
    expect(constructionCells[COL.finish]).toHaveTextContent('11');
    expect(constructionCells[COL.float]).toHaveTextContent('0');
  });

  it('marks the critical phase and leaves the non-critical phase unmarked', () => {
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={vi.fn()} />);
    const rows = bodyRows();
    const designFloat = within(rows[0]).getAllByRole('cell')[COL.float];
    const constructionFloat = within(rows[1]).getAllByRole('cell')[COL.float];
    expect(designFloat).not.toHaveTextContent('critical');
    expect(constructionFloat).toHaveTextContent('critical');
  });

  it('falls back to "—" for start/finish/float when there is no derivation (cycle)', () => {
    render(<PhaseEditor phases={PHASES} derivedById={null} onChange={vi.fn()} />);
    const rows = bodyRows();
    const cells = within(rows[0]).getAllByRole('cell');
    expect(cells[COL.start]).toHaveTextContent('—');
    expect(cells[COL.finish]).toHaveTextContent('—');
    expect(cells[COL.float]).toHaveTextContent('—');
  });

  it('adding a phase writes a new Phase with slip_months: 0, start_offset: 0, predecessors: []', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add phase' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0] as Phase[];
    expect(written).toHaveLength(3);
    expect(written[0]).toEqual(PHASES[0]);
    expect(written[1]).toEqual(PHASES[1]);
    expect(written[2]).toEqual(expect.objectContaining({
      slip_months: 0, start_offset: 0, predecessors: [],
    }));
  });

  it('removing a phase drops it and strips any dangling predecessor referencing it', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove phase Design' }));
    expect(onChange).toHaveBeenCalledWith([
      { ...PHASES[1], predecessors: [] },
    ]);
  });

  it('reordering moves a phase and leaves the others untouched', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Construction up' }));
    expect(onChange).toHaveBeenCalledWith([PHASES[1], PHASES[0]]);
  });

  it('editing duration_months calls onChange with the updated phase, other phases untouched', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith([
      { ...PHASES[0], duration_months: 4 },
      PHASES[1],
    ]);
  });

  it('clamps a negative duration_months to 0 (0 = milestone, spec §18.3), not to 1', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '-3' } });
    expect(onChange).toHaveBeenCalledWith([
      { ...PHASES[0], duration_months: 0 },
      PHASES[1],
    ]);
  });

  it('accepts a negative slip_months unchanged -- slip is signed (spec §18.2 acceleration)', () => {
    const onChange = vi.fn();
    render(<PhaseEditor phases={PHASES} derivedById={DERIVED_BY_ID} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '-2' } });
    expect(onChange).toHaveBeenCalledWith([
      PHASES[0],
      { ...PHASES[1], slip_months: -2 },
    ]);
  });
});
