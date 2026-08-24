import { describe, it, expect } from 'vitest';
import { validateInputs } from '../validation';
import {
  anchorResolver, heldTwinDoc, noProgrammeDoc, pcEarlyDoc, residueDoc, soldGross, unitSalesDoc,
} from './unit-sales-docs';

function errs(doc: Parameters<typeof validateInputs>[0]) {
  return validateInputs(doc).filter((i) => i.severity === 'error');
}

describe('unit-sales-docs fixture builders', () => {
  it('X is v12 and carries the ledger', () => {
    const d = unitSalesDoc();
    expect(d.inputs_version).toBe(12);
    expect(d.unit_sales).not.toBeNull();
    expect(d.unit_sales!.units).toHaveLength(4);
    expect(soldGross(d)).toEqual([
      ['u1', 26_000_000], ['u2', 30_000_000], ['u3', 17_500_000], ['u4', 21_000_000],
    ]);
  });

  it('X resolves the hand-derived months', () => {
    const d = unitSalesDoc();
    const r = anchorResolver(d);
    const rows = d.unit_sales!.units;
    expect(r(rows[0].exchange!.anchor, rows[0].exchange!.month_offset)).toBe(8);
    expect(r(rows[0].completion.anchor, rows[0].completion.month_offset)).toBe(12);
    expect(r(rows[1].completion.anchor, rows[1].completion.month_offset)).toBe(13);
    expect(r(rows[2].completion.anchor, rows[2].completion.month_offset)).toBe(13);
    expect(r(rows[3].completion.anchor, rows[3].completion.month_offset)).toBe(20);
  });

  it('pcEarly moves practical completion to month 9', () => {
    const d = pcEarlyDoc();
    const r = anchorResolver(d);
    const rows = d.unit_sales!.units;
    expect(r(rows[0].completion.anchor, 0)).toBe(9);
    expect(r(rows[1].completion.anchor, 0)).toBe(10);
    expect(r(rows[2].completion.anchor, 0)).toBe(10);
  });

  it('variants differ from X by exactly their one change', () => {
    expect(heldTwinDoc().unit_sales!.deposit_release).toBe('held_to_completion');
    expect(noProgrammeDoc().programme).toBeNull();
    expect(noProgrammeDoc().unit_sales!.units.map((r) => r.completion.month_offset)).toEqual([12, 13, 13, 20]);
    const rd = residueDoc();
    expect(rd.unit_mix.units.map((u) => u.estimated_value_pence)).toEqual([10_000_000, 10_000_000, 10_000_000]);
    expect(rd.exit_strategy.selling_legal_fee_pence).toBe(100);
  });

  it('every builder validates clean before Task 5 adds rules', () => {
    // Task 5 keeps this true for the four valid variants; the controls
    // (salesPhasingToo, dropRow, extraRow) are meant to FAIL there.
    for (const d of [unitSalesDoc(), heldTwinDoc(), noProgrammeDoc(), pcEarlyDoc(), residueDoc()]) {
      expect(errs(d)).toEqual([]);
    }
  });
});
