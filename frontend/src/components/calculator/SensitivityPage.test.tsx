import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import SensitivityPage from './SensitivityPage';
import { runAppraisal, migrateInputsToV8, migrateV8toV9 } from '../../lib/model';
import type { CalculatorInputsV8, CalculatorInputsV9, ProgrammeNetwork } from '../../lib/model';
import { unitSalesDoc } from '../../lib/model/__fixtures__/unit-sales-docs';
import { ddDoc } from '../../lib/model/__fixtures__/due-diligence-docs';
import { STRESS_PACK } from '../../lib/model/stress-pack';
import { formatStressSetting, STRESS_SIGN_CONVENTION } from '../../lib/sensitivity-format';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function buildInputs(): CalculatorInputsV8 {
  return migrateInputsToV8(fixtureF.inputs);
}

const NETWORK: ProgrammeNetwork = {
  anchor_month: null,
  phases: [
    {
      id: 'design', code: 'design', label: 'Design', duration_months: 2, slip_months: 0,
      start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [],
    },
    {
      id: 'construction', code: 'construction', label: 'Construction', duration_months: 8, slip_months: 0,
      start_offset: 0, curve: { kind: 'straight_line' },
      predecessors: [{ phase_id: 'design', type: 'FS', lag_months: 0 }],
    },
  ],
  category_phase_ids: { construction: 'construction', professional: 'design', statutory: 'design' },
};

function buildNetworkInputs(): CalculatorInputsV9 {
  const v9 = migrateV8toV9(buildInputs());
  return { ...v9, programme: NETWORK };
}

describe('SensitivityPage — two-way matrix', () => {
  it('renders the spec §12.3 default grid: 5 cost rows x 5 GDV columns', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    // 1 header row + 5 body rows.
    expect(within(matrix).getAllByRole('row')).toHaveLength(6);
    for (const caption of ['GDV -15%', 'GDV -10%', 'GDV -5%', 'GDV +0%', 'GDV +5%']) {
      expect(within(matrix).getByText(caption)).toBeInTheDocument();
    }
    for (const caption of ['Cost -5%', 'Cost +0%', 'Cost +5%', 'Cost +10%', 'Cost +15%']) {
      expect(within(matrix).getByText(caption)).toBeInTheDocument();
    }
  });

  // Spec §12.5: the all-levers-zero cell is the unadjusted appraisal, exactly.
  // Computed from the engine here rather than pinned, so this asserts the
  // identity and not a transcription.
  //
  // Row and column are selected positionally, not by accessible name: the row
  // caption is a <th scope="row">, so getAllByRole('cell') returns only the five
  // <td>s. Default axes are rows [-5,0,5,10,15] and cols [-15,-10,-5,0,5], so the
  // base cell is body row index 1, cell index 3.
  it('shows the unadjusted appraisal in the base cell (spec §12.5)', () => {
    const inputs = buildInputs();
    const expected = `${runAppraisal(inputs).metrics.profit_on_cost_pct!.toFixed(1)}%`;
    render(<SensitivityPage inputs={inputs} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const baseRow = within(matrix).getAllByRole('row')[2]; // header + 'Cost -5%' precede it
    expect(within(baseRow).getAllByRole('rowheader')[0]).toHaveTextContent('Cost +0%');
    expect(within(baseRow).getAllByRole('cell')[3]).toHaveTextContent(expected);
  });

  it('re-renders the matrix in the selected metric', () => {
    const inputs = buildInputs();
    const expected = `${runAppraisal(inputs).metrics.ltgdv_developer_pct!.toFixed(1)}%`;
    render(<SensitivityPage inputs={inputs} />);
    fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'ltgdv_developer_pct' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const baseRow = within(matrix).getAllByRole('row')[2];
    expect(within(baseRow).getAllByRole('cell')[3]).toHaveTextContent(expected);
  });

  it('offers all six compact-record metrics', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const select = screen.getByLabelText(/metric/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
  });

  // Spec §12.2: a cell needing more debt than the committed facility does not
  // get it — it raises a flag, and the flag is the finding. Fixture F's +15%
  // cost row is the corner where that happens.
  it('marks flagged cells with their short codes', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const worstRow = within(matrix).getAllByRole('row')[5]; // 'Cost +15%', the last body row
    expect(within(worstRow).getAllByRole('rowheader')[0]).toHaveTextContent('Cost +15%');
    expect(within(worstRow).getAllByText(/\[(FE|FG|NR)/).length).toBeGreaterThan(0);
  });
});

describe('SensitivityPage — tornado', () => {
  it('lists bars widest swing first (spec §12.4)', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    const labels = within(tornado).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(labels).toEqual(['GDV', 'Construction cost', 'Timeline', 'Interest rate']);
  });

  it('states each bar range in its own unit', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    // GDV and Construction cost both default to a -10..+10 range (spec §12.3),
    // so this text is shared by two rows rather than unique to one.
    expect(within(tornado).getAllByText('-10% to +10%')).toHaveLength(2);
    expect(within(tornado).getByText('-3 to +3 months')).toBeInTheDocument();
    expect(within(tornado).getByText('-1.0 to +1.0 pp')).toBeInTheDocument();
  });

  it('prints the base profit as the tornado centre reference', () => {
    const inputs = buildInputs();
    const baseProfit = runAppraisal(inputs).metrics.profit_pence;
    const formatted = (baseProfit / 100).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
    render(<SensitivityPage inputs={inputs} />);
    expect(screen.getByText(new RegExp(`Base profit.*${formatted.replace(/[£,]/g, '\\$&')}`)))
      .toBeInTheDocument();
  });
});

describe('SensitivityPage — axis and step editor', () => {
  it('re-runs the suite on an edited column step list', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('GDV -20%')).toBeInTheDocument();
    expect(within(matrix).queryByText('GDV -15%')).not.toBeInTheDocument();
    // 5 cost rows unchanged, now 2 GDV columns + the row label column.
    const bodyRows = within(matrix).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(5);
    expect(within(bodyRows[0]).getAllByRole('cell')).toHaveLength(2);
  });

  it('switches a row axis to another lever', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 3' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('Timeline +3 months')).toBeInTheDocument();
  });

  // Spec §12.6 errors are input errors, not flags. Showing the reason and
  // hiding the grid is honest; showing the previous grid beside an invalid
  // config would present numbers that are not the current calculation (spec §2).
  it('states the reason and hides the matrix when both axes name one lever', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'gdv' } });
    expect(screen.getByText(/must use different levers/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /two-way sensitivity/i })).not.toBeInTheDocument();
  });

  it('rejects an empty step list', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '' } });
    expect(screen.getByText(/at least one step/i)).toBeInTheDocument();
  });

  it('rejects a fractional timeline step (spec §12.6)', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 1.5' } });
    expect(screen.getByText(/whole months/i)).toBeInTheDocument();
  });

  it('rejects more than nine steps on an axis', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), {
      target: { value: '-20,-15,-10,-5,0,5,10,15,20,25' },
    });
    expect(screen.getByText(/at most 9 steps/i)).toBeInTheDocument();
  });

  // R5: §12.7 replaced the page's own term guard. A mixed axis now renders — the
  // unmeasured row shows its reason and the measured rows show their numbers, which
  // tells the analyst where the deal stops being modellable instead of refusing the
  // whole grid. This must be able to fail against an implementation that renders
  // "—" in every cell (row captions alone can't tell a mixed grid from a blank one),
  // so it pins the unmeasured row's dash cells and the measured row's real values.
  it('renders unmeasured and measured rows side by side for a mixed timeline axis', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12, -11' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const rows = within(matrix).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 body rows

    const unmeasuredRow = rows[1];
    expect(within(unmeasuredRow).getAllByRole('rowheader')[0]).toHaveTextContent('Timeline -12 months');
    const unmeasuredCells = within(unmeasuredRow).getAllByRole('cell');
    expect(unmeasuredCells).toHaveLength(5); // default GDV column axis has 5 steps
    for (const cell of unmeasuredCells) {
      expect(cell).toHaveTextContent('—');
    }

    const measuredRow = rows[2];
    expect(within(measuredRow).getAllByRole('rowheader')[0]).toHaveTextContent('Timeline -11 months');
    for (const cell of within(measuredRow).getAllByRole('cell')) {
      expect(cell.textContent).toMatch(/-?\d+\.\d%/);
    }

    expect(screen.queryByText(/at least one month of term/i)).not.toBeInTheDocument();
  });

  // R6: `title` was the only carrier of an unmeasured cell's reason — invisible to a
  // screen reader, to print, and to touch, while the cell's "—" is indistinguishable
  // from a genuinely null metric. The reason now appears as visible text beneath the
  // matrix and is associated with each cell via aria-describedby.
  it('names an unmeasured cell\'s reason in visible text tied to the cell', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    // One reason invalidates the whole row, so it is stated once, not five times.
    const notes = screen.getAllByRole('listitem');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/whole number of months, at least 1/i);

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const cells = within(matrix).getAllByRole('cell');
    expect(cells).toHaveLength(5); // the default GDV column axis has 5 steps

    for (const cell of cells) {
      expect(cell).toHaveTextContent('—');
      expect(cell).toHaveStyle({ color: 'rgb(148, 163, 184)', fontStyle: 'italic' });
      // The association is programmatic, not just visual proximity.
      const describedBy = cell.getAttribute('aria-describedby');
      expect(describedBy).toBe(notes[0].id);
    }
  });

  // The retired carrier must actually be gone: leaving it would put the same sentence
  // in two places, which is the drift shape R4b and R5 each shipped once.
  it('no longer carries the reason in a title attribute', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const titled = within(matrix).getAllByRole('cell').filter((c) => c.hasAttribute('title'));
    expect(titled).toEqual([]);
  });

  // A measured grid gets no notes and no markers at all.
  it('prints no notes when every position in the grid is measured', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // Distinct reasons must not collapse into one note. A timeline row of -12 empties the
  // term; a GDV column of -100% zeroes every unit's estimated value (validation's
  // positive-value rule). The 2x2 grid of those two against a measured step gives
  // *three* distinct reasons, not two — the corner cell fails for both causes at once
  // and its note carries both sentences joined. That third note is the case worth
  // pinning: an implementation keyed on the first validation error alone would produce
  // two notes here and look correct.
  it('states each distinct reason as its own note, including a cell failing for two', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12, 0' } });
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-100, 0' } });

    const notes = screen.getAllByRole('listitem');
    expect(notes).toHaveLength(3);
    expect(new Set(notes.map((n) => n.textContent)).size).toBe(3);
    // Row-major order: the corner (-12, -100%) is reached first and carries both causes.
    expect(notes[0]).toHaveTextContent(/whole number of months, at least 1/i);
    expect(notes[0].textContent).toMatch(/value/i);
  });

  it('restores the spec defaults on reset', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('GDV -15%')).toBeInTheDocument();
  });

  // Design §5.1: view state only. The page has no onChange prop at all, so the
  // strongest available statement is that the inputs object it was handed is
  // untouched after every editor interaction.
  it('never mutates the inputs document', () => {
    const inputs = buildInputs();
    const before = JSON.stringify(inputs);
    render(<SensitivityPage inputs={inputs} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'interest_rate' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 2' } });
    expect(JSON.stringify(inputs)).toBe(before);
  });
});

// ── Spec §12.7 (R5): cell validity ──────────────────────────────────────
//
// The default tornado's fixed -3-month low endpoint drives finance.term_months
// to zero or less on any deal with a term of three months or less. That levered
// document fails validation (§12.7), so the endpoint is unmeasured and the bar
// has no span — it is dropped from the tornado table with the omission stated,
// while the two-way matrix and the rest of the tornado render normally.
describe('SensitivityPage — unmeasured tornado endpoint omission', () => {
  function buildShortTermInputs(): CalculatorInputsV8 {
    const inputs = buildInputs();
    return { ...inputs, finance: { ...inputs.finance, term_months: 3 } };
  }

  it('does not dead-end on first render for a deal whose term is too short for the fixed tornado range', () => {
    render(<SensitivityPage inputs={buildShortTermInputs()} />);
    // No "invalid grid" panel — the axes themselves are untouched and valid.
    expect(screen.queryByText(/does not describe a valid grid/i)).not.toBeInTheDocument();
    // The two-way matrix renders exactly as it does for any other deal.
    expect(screen.getByRole('table', { name: /two-way sensitivity/i })).toBeInTheDocument();
  });

  // The omission note must print the engine's own reason for the specific endpoint
  // that failed (spec §12.7), not a term-shaped guess reconstructed on this page —
  // a different lever (e.g. interest_rate going negative) fails for an unrelated
  // reason, so a hard-coded "term too short" caption would be false for it.
  it('drops the timeline bar from the tornado and states the engine-reported reason', () => {
    render(<SensitivityPage inputs={buildShortTermInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    const labels = within(tornado).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(labels).toEqual(['GDV', 'Construction cost', 'Interest rate']);
    expect(screen.getByText(/Timeline omitted/i)).toBeInTheDocument();
    expect(screen.getByText(/whole number of months, at least 1/i)).toBeInTheDocument();
  });

  it('still renders the tornado table for the levers that remain sound', () => {
    render(<SensitivityPage inputs={buildShortTermInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    expect(within(tornado).getByText('GDV')).toBeInTheDocument();
    expect(within(tornado).getByText('Construction cost')).toBeInTheDocument();
    expect(within(tornado).getByText('Interest rate')).toBeInTheDocument();
  });

  // R5: a user-entered axis step that empties the term no longer refuses the grid
  // (that was the page's own term guard, retired in favour of §12.7). The matrix
  // still renders, with the empty-term step unmeasured and its reason on the cell.
  it('renders an unmeasured row rather than refusing the grid when a timeline axis step empties the term', () => {
    render(<SensitivityPage inputs={buildShortTermInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, -3' } });
    expect(screen.queryByText(/does not describe a valid grid/i)).not.toBeInTheDocument();

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const rows = within(matrix).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 body rows

    const measuredRow = rows[1];
    expect(within(measuredRow).getAllByRole('rowheader')[0]).toHaveTextContent('Timeline +0 months');
    for (const cell of within(measuredRow).getAllByRole('cell')) {
      expect(cell.textContent).toMatch(/-?\d+\.\d%/);
      expect(cell).not.toHaveAttribute('title');
      expect(cell).not.toHaveAttribute('aria-describedby');
    }

    const unmeasuredRow = rows[2];
    expect(within(unmeasuredRow).getAllByRole('rowheader')[0]).toHaveTextContent('Timeline -3 months');
    const unmeasuredCells = within(unmeasuredRow).getAllByRole('cell');
    expect(unmeasuredCells).toHaveLength(5); // default GDV column axis has 5 steps
    const note = screen.getByRole('listitem');
    expect(note).toHaveTextContent('Term must be a whole number of months, at least 1.');
    for (const cell of unmeasuredCells) {
      expect(cell).toHaveTextContent('—');
      expect(cell).not.toHaveAttribute('title');
      expect(cell.getAttribute('aria-describedby')).toBe(note.id);
    }
  });
});

// R12 Task 17 (spec §18.9). `phase_slip` was withheld from the lever dropdown
// (Task 14) because its validation error had no control the user could
// satisfy -- and worse, `outcome = issues.length > 0 ? null : run(...)`
// blanked the whole matrix and tornado. The picker restores the lever with a
// target to hand, but only for a document that carries a phase network.
describe('SensitivityPage — the phase_slip lever and its phase-target picker', () => {
  it('does NOT offer phase_slip on a programme = null document (no phase to target)', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const rowLeverOptions = within(screen.getByLabelText(/row lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    expect(rowLeverOptions).not.toContain('Phase slip');
    const colLeverOptions = within(screen.getByLabelText(/column lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    expect(colLeverOptions).not.toContain('Phase slip');
    // No picker either -- there is nothing for it to populate from.
    expect(screen.queryByLabelText(/row phase/i)).not.toBeInTheDocument();
  });

  it('offers phase_slip, and shows the phase picker only once it is selected', () => {
    render(<SensitivityPage inputs={buildNetworkInputs()} />);
    expect(screen.queryByLabelText(/row phase/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'phase_slip' } });
    const picker = screen.getByLabelText(/row phase/i);
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Design', 'Construction']);
  });

  it('the phase picker is independent per axis -- selecting it for rows does not show it for columns', () => {
    render(<SensitivityPage inputs={buildNetworkInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'phase_slip' } });
    expect(screen.getByLabelText(/row phase/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/column phase/i)).not.toBeInTheDocument();
  });

  it('running phase_slip against a named phase produces a real (non-blanked) matrix', () => {
    render(<SensitivityPage inputs={buildNetworkInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'phase_slip' } });
    fireEvent.change(screen.getByLabelText(/row phase/i), { target: { value: 'construction' } });
    expect(screen.queryByText(/does not describe a valid grid/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be calculated/i)).not.toBeInTheDocument();
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    // R12 final review wave (Finding 3): the row header now names the phase
    // too, not just the bare lever short-name.
    expect(within(matrix).getAllByRole('rowheader')[0]).toHaveTextContent('Slip: Construction -5 months');
  });

  // R12 final review wave (Finding 3). The engine permits rows and cols to
  // both be phase_slip, targeting DIFFERENT phases (spec §18.9) -- before
  // this fix both axes rendered as the bare "Slip", the corner read
  // "Slip \ Slip", and neither header named which phase moved.
  it('two phase_slip axes targeting different phases render distinguishable labels', () => {
    render(<SensitivityPage inputs={buildNetworkInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'phase_slip' } });
    fireEvent.change(screen.getByLabelText(/row phase/i), { target: { value: 'design' } });
    fireEvent.change(screen.getByLabelText(/column lever/i), { target: { value: 'phase_slip' } });
    fireEvent.change(screen.getByLabelText(/column phase/i), { target: { value: 'construction' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const headerCells = within(matrix).getAllByRole('columnheader');
    const corner = headerCells[0];
    expect(corner).toHaveTextContent('Slip: Design');
    expect(corner).toHaveTextContent('Slip: Construction');
    // The old, indistinguishable text must be gone, not merely superseded.
    expect(corner.textContent).not.toBe('Slip \\ Slip');

    const colHeaderTexts = headerCells.slice(1).map((h) => h.textContent ?? '');
    expect(colHeaderTexts.some((t) => t.includes('Slip: Construction'))).toBe(true);
    expect(colHeaderTexts.some((t) => t.includes('Slip: Design'))).toBe(false);

    const rowHeaderTexts = within(matrix).getAllByRole('rowheader').map((h) => h.textContent ?? '');
    expect(rowHeaderTexts.some((t) => t.includes('Slip: Design'))).toBe(true);
    expect(rowHeaderTexts.some((t) => t.includes('Slip: Construction'))).toBe(false);
  });
});

// R13b Task 10 (spec §22.8). `sales_slip` needs a unit-sales ledger to have a
// completion date to move -- withheld from the lever dropdown, same
// reasoning as `phase_slip` and its phase network above.
describe('SensitivityPage — the sales_slip lever', () => {
  it('does NOT offer sales_slip on a document without a unit-sales ledger', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const rowLeverOptions = within(screen.getByLabelText(/row lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    expect(rowLeverOptions).not.toContain('Sales slip');
    const colLeverOptions = within(screen.getByLabelText(/column lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    expect(colLeverOptions).not.toContain('Sales slip');
  });

  it('offers sales_slip on a document with a unit-sales ledger', () => {
    render(<SensitivityPage inputs={unitSalesDoc()} />);
    const rowLeverOptions = within(screen.getByLabelText(/row lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    expect(rowLeverOptions).toContain('Sales slip');
  });
});

// R16 Task 7 (spec §25). Region 0: the standard lender stress pack, printed above
// the tornado/matrix regions -- `safeRunStressPack` handed straight to the table,
// no arithmetic in the component (spec §11.9).
describe('SensitivityPage — Region 0: standard lender stresses', () => {
  it('shows a table with the nine stresses in the pack\'s own order', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    const table = screen.getByRole('table', { name: /standard lender stresses/i });
    const rows = within(table).getAllByRole('row');
    // 1 header row + 9 stress rows.
    expect(rows).toHaveLength(10);
    const stressCellTexts = rows.slice(1).map((r) => within(r).getAllByRole('cell')[0]?.textContent
      ?? within(r).getAllByRole('rowheader')[0]?.textContent);
    expect(stressCellTexts).toEqual(STRESS_PACK.map((d) => d.label));
    expect(stressCellTexts[0]).toBe('One unit lost');
  });

  it('prints the abnormal-cost inapplicability note in its own row (ddDoc has no abnormal package)', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    const table = screen.getByRole('table', { name: /standard lender stresses/i });
    const rows = within(table).getAllByRole('row');
    const abnormalRow = rows.find((r) => /Abnormal cost \+10%/.test(r.textContent ?? ''));
    expect(abnormalRow).toBeDefined();
    expect(within(abnormalRow as HTMLElement).getByText(
      /No package carries the abnormal contingency class/i,
    )).toBeInTheDocument();
  });

  it('offers the four R16 stress-pack levers in the row-lever picker', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    const rowLeverOptions = within(screen.getByLabelText(/row lever/i)).getAllByRole('option')
      .map((o) => o.textContent);
    for (const label of ['Saleable area', 'Abnormal cost', 'Programme slip', 'Refinance LTV']) {
      expect(rowLeverOptions).toContain(label);
    }
  });

  // Fix round 1, Finding 1: `s.settings.map(formatStressSetting)` passed
  // Array.prototype.map's (element, index, array) straight through, binding
  // `formatStressSetting`'s optional `decimals` parameter to the array index on
  // every call -- so the `decimals === undefined` guard in sensitivity-format.ts
  // was never true and every setting was quoted at the WRONG precision
  // (abnormal_cost's pp levers lost their 1dp; risks_crystallise's second
  // setting, programme_slip, gained a bogus ".0" from index 1). Pinning the
  // literal rendered text is what makes that regression impossible to
  // reintroduce silently.
  it('quotes each Setting cell at formatStressSetting\'s own precision, not the array index', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    const table = screen.getByRole('table', { name: /standard lender stresses/i });
    const rows = within(table).getAllByRole('row');

    const abnormalRow = rows.find((r) => /Abnormal cost \+10%/.test(r.textContent ?? '')) as HTMLElement;
    const abnormalSettingCell = within(abnormalRow).getAllByRole('cell')[1];
    // The setting text is the cell's first text node; a sibling <div> (the
    // applicability note) follows it, so this is not the whole cell content.
    expect(abnormalSettingCell.childNodes[0].textContent).toBe(
      formatStressSetting({ lever: 'abnormal_cost', value: 10 }),
    );

    const risksRow = rows.find((r) => /Recorded risks crystallise/.test(r.textContent ?? '')) as HTMLElement;
    const risksSettingCell = within(risksRow).getAllByRole('cell')[1];
    // Fix wave FI1 (spec §25.5). Entry 9's `construction_cost` setting is
    // DERIVED from the document, so it is quoted to 2dp on BOTH surfaces --
    // this page and the memo -- through the shared `stressSettingText`. Until
    // this fix the page passed no `decimals` and printed "+10%", silently
    // rounding away the derivation the memo stated to the penny on the same
    // document. `9.807692307692` is ddDoc's own figure (stress-pack.test.ts
    // pins it), so "+9.81%" is `(9.807692307692).toFixed(2)`.
    expect(risksSettingCell.textContent).toContain('+9.81%');
    // The array-index regression this test was written for: `programme_slip`
    // is a 0dp month lever and must never carry a ".0". Neither does "+9.81%",
    // nor the "£25,500 recorded; 4 items, largest 3 months" parenthetical.
    expect(risksSettingCell.textContent).not.toMatch(/\.0/);
  });

  // Fix wave FI2. Entry 7's normative label reads "Refinance LTV -10 pp"; the
  // other levers' Settings are quoted adverse-positive. The label does not
  // change; the convention is stated once beneath the table, in the same
  // words the memo's own method sentence uses.
  it('states the adverse-positive sign convention beneath the stress table', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    expect(document.body.textContent).toContain(STRESS_SIGN_CONVENTION);
  });

  // R17 spec §13.2. Entry 7's Setting cell says what the lever does in words,
  // through the shared `stressSettingText`; the "+10.0 pp" quote that read as
  // a contradiction of the "-10 pp" label is gone from the page.
  it('prints the refi_ltv Setting as the reduced-by sentence, never "Refinance LTV +10.0 pp"', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    const table = screen.getByRole('table', { name: /standard lender stresses/i });
    const rows = within(table).getAllByRole('row');
    const refiRow = rows.find((r) => /Refinance LTV -10 pp/.test(r.textContent ?? '')) as HTMLElement;
    expect(refiRow).toBeDefined();
    const settingCell = within(refiRow).getAllByRole('cell')[1];
    expect(settingCell.childNodes[0].textContent).toBe(
      'Maximum refinance LTV reduced by 10.0 percentage points.',
    );
    expect(document.body.textContent).toContain('Refinance LTV -10 pp');
    expect(document.body.textContent).not.toContain('Refinance LTV +10.0 pp');
  });
});

// Fix round 1, Finding 2. Region 0 has no config of its own -- it must render
// even when the row/col axis editor's OWN config is invalid, since the two are
// independent failure surfaces.
describe('SensitivityPage — Region 0 renders on the axis-editor failure panel too', () => {
  it('still shows the standard-lender-stresses table when the axis config is invalid', () => {
    render(<SensitivityPage inputs={ddDoc()} />);
    // Force the §12.6 "different levers" config error by pointing both axes at
    // the same default row lever.
    const rowLeverValue = (screen.getByLabelText(/row lever/i) as HTMLSelectElement).value;
    fireEvent.change(screen.getByLabelText(/column lever/i), { target: { value: rowLeverValue } });
    expect(screen.getByText(/do not describe a valid grid/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /standard lender stresses/i })).toBeInTheDocument();
  });
});
