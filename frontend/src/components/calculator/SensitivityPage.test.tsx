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
