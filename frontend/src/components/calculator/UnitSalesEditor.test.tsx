import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnitSalesEditor, { seedUnitSales, reconcileUnitSalesRows } from './UnitSalesEditor';
import { runAppraisal } from '../../lib/model';
import type { UnitSalesInputs } from '../../lib/model';
import { unitSalesDoc } from '../../lib/model/__fixtures__/unit-sales-docs';

/**
 * R13b Task 11 (spec §22.6). `renderEditor` mirrors the task brief's own
 * setup: a real `runAppraisal(doc)` run so `result` is the engine's actual
 * `metrics.unit_sales`, never a hand-authored stub -- the whole point of "no
 * calculation in the component" is that these tests would catch it computing
 * its own figures instead of reading the result block.
 */
function renderEditor(doc = unitSalesDoc(), onChange = vi.fn()) {
  const run = runAppraisal(doc);
  render(<UnitSalesEditor
    unitSales={doc.unit_sales!}
    result={run.metrics.unit_sales}
    phases={doc.programme?.phases ?? []}
    term={24}
    units={doc.unit_mix.units.map((u) => ({ id: u.id, type: u.type }))}
    schemeAgentPct={1.5}
    schemeLegalPence={500000}
    onChange={onChange}
  />);
  return { doc, onChange, run };
}

describe('UnitSalesEditor', () => {
  it('renders one row per unit with the resolved months read off the result block', () => {
    renderEditor();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 4 + 1); // header + 4 units + totals
    expect(screen.getAllByText(/resolves to month 12/).length).toBeGreaterThan(0); // u1 completion
    expect(screen.getByText(/Pre-sold 81.48%/)).toBeInTheDocument();             // read, not computed
  });

  it('emits the whole block with the one changed field', () => {
    const { doc, onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('u4 deposit %'), { target: { value: '7.5' } });
    const next = onChange.mock.calls[0][0] as UnitSalesInputs;
    expect(next.units[3].deposit_pct).toBe(7.5);
    expect(next.units[0]).toEqual(doc.unit_sales!.units[0]);
  });

  it('a blank legal override emits null, an explicit 0 emits 0', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('u2 legal £'), { target: { value: '' } });
    expect((onChange.mock.calls[0][0] as UnitSalesInputs).units[1].legal_fee_pence).toBeNull();
    fireEvent.change(screen.getByLabelText('u2 legal £'), { target: { value: '0' } });
    expect((onChange.mock.calls[1][0] as UnitSalesInputs).units[1].legal_fee_pence).toBe(0);
  });

  it('switching an exchange to simultaneous also zeroes the deposit in the same emit', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('u1 exchange simultaneous'));
    const next = onChange.mock.calls[0][0] as UnitSalesInputs;
    expect(next.units[0].exchange).toBeNull();
    expect(next.units[0].deposit_pct).toBe(0);
  });

  it('seedUnitSales and reconcileUnitSalesRows keep exactly one row per sold unit', () => {
    const seeded = seedUnitSales(['u1', 'u2'], 24);
    expect(seeded).toEqual({
      deposit_release: 'held_to_completion',
      units: [
        { unit_id: 'u1', exchange: null, completion: { month_offset: 23, anchor: null }, deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null },
        { unit_id: 'u2', exchange: null, completion: { month_offset: 23, anchor: null }, deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null },
      ],
    });
    const r = reconcileUnitSalesRows(unitSalesDoc().unit_sales!, ['u2', 'u3', 'u9'], 24);
    expect(r.units.map((x) => x.unit_id)).toEqual(['u2', 'u3', 'u9']);
    expect(r.units[0]).toEqual(unitSalesDoc().unit_sales!.units[1]); // survivor untouched
  });
});
