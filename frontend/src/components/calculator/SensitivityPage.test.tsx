import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import SensitivityPage from './SensitivityPage';
import { runAppraisal, migrateInputsToV4 } from '../../lib/model';
import type { CalculatorInputsV4 } from '../../lib/model';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function buildInputs(): CalculatorInputsV4 {
  return migrateInputsToV4(fixtureF.inputs);
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

  it('shows the validation reason on an unmeasured cell, and leaves measured cells untitled', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    // Every column in the row is unmeasured for the same reason (the row lever alone
    // drives the term below one month), so the title is repeated across the row —
    // pinned exactly at the default GDV column axis's step count, so this fails
    // against an implementation that titled the measured cells too.
    const titledCells = within(matrix).getAllByTitle(/whole number of months, at least 1/i);
    expect(titledCells).toHaveLength(5);
    for (const cell of titledCells) {
      expect(cell).toHaveTextContent('—');
      expect(cell).toHaveStyle({ color: 'rgb(148, 163, 184)', fontStyle: 'italic' });
    }
    // No other cell in the matrix carries a title.
    const allCells = within(matrix).getAllByRole('cell');
    expect(allCells.filter((cell) => cell.hasAttribute('title'))).toHaveLength(5);
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
  function buildShortTermInputs(): CalculatorInputsV4 {
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
    }

    const unmeasuredRow = rows[2];
    expect(within(unmeasuredRow).getAllByRole('rowheader')[0]).toHaveTextContent('Timeline -3 months');
    const unmeasuredCells = within(unmeasuredRow).getAllByRole('cell');
    expect(unmeasuredCells).toHaveLength(5); // default GDV column axis has 5 steps
    for (const cell of unmeasuredCells) {
      expect(cell).toHaveTextContent('—');
      expect(cell).toHaveAttribute('title', 'Term must be a whole number of months, at least 1.');
    }
  });
});
