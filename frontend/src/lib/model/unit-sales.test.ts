/** R13b spec §22.2-22.4. Twin of tests/test_financial_model_unit_sales.py. Every
 *  literal is from the plan's hand-derivation table; if one does not
 *  reconcile, report it. */
import { describe, it, expect } from 'vitest';
import { computeUnitSales } from './unit-sales';
import {
  anchorResolver, heldTwinDoc, noProgrammeDoc, pcEarlyDoc, residueDoc, soldGross, unitSalesDoc,
} from './__fixtures__/unit-sales-docs';
import type { CalculatorInputsV12 } from './finance-types';

const run = (doc: CalculatorInputsV12) => computeUnitSales(doc, 24, anchorResolver(doc), soldGross(doc))!;

function row(result: ReturnType<typeof run>, unitId: string) {
  return result.units.find((x) => x.unit_id === unitId)!;
}

describe('computeUnitSales (§22.2-22.4)', () => {
  it('returns null exactly when the input block is null', () => {
    const doc = unitSalesDoc({ unitSales: null });
    expect(computeUnitSales(doc, 24, anchorResolver(doc), soldGross(doc))).toBeNull();
    expect(run(unitSalesDoc())).not.toBeNull();
  });

  it('per-unit figures match the hand derivation', () => {
    const r = run(unitSalesDoc());
    expect(r.units.map((x) => [x.unit_id, x.gross_pence, x.deposit_pence, x.agent_fee_pence, x.legal_fee_pence, x.net_pence])).toEqual([
      ['u1', 26_000_000, 2_600_000, 390_000, 201_550, 25_408_450],
      ['u2', 30_000_000, 3_000_000, 450_000, 150_000, 29_400_000],
      ['u3', 17_500_000, 0, 350_000, 135_659, 17_014_341],
      ['u4', 21_000_000, 1_050_000, 315_000, 162_791, 20_522_209],
    ]);
    expect(r.totals).toEqual({
      gross_pence: 94_500_000, deposits_pence: 6_650_000, deposits_released_pence: 6_650_000,
      agent_fees_pence: 1_505_000, legal_fees_pence: 650_000, net_pence: 92_345_000,
    });
  });

  it('resolved months and released deposits', () => {
    const r = run(unitSalesDoc());
    expect(r.units.map((x) => [x.exchange_month, x.completion_month, x.deposit_released_pence])).toEqual([
      [8, 12, 2_600_000], [10, 13, 3_000_000], [null, 13, 0], [11, 20, 1_050_000],
    ]);
  });

  it('held twin releases nothing but still reports the deposits', () => {
    const r = run(heldTwinDoc());
    expect(r.units.map((x) => x.deposit_released_pence)).toEqual([0, 0, 0, 0]);
    expect(r.units.map((x) => x.deposit_pence)).toEqual([2_600_000, 3_000_000, 0, 1_050_000]);
    expect(r.totals.deposits_pence).toBe(6_650_000);
    expect(r.totals.deposits_released_pence).toBe(0);
    expect(r.months.every((m) => m.deposits_received_pence === 0)).toBe(true);
  });

  it('monthly series are cumulative and deposits land in exchange months', () => {
    const r = run(unitSalesDoc());
    const m = new Map(r.months.map((x) => [x.month, x]));
    expect(r.months).toHaveLength(24);
    expect([
      m.get(7)!.exchanged_value_pence, m.get(8)!.exchanged_value_pence, m.get(10)!.exchanged_value_pence,
      m.get(11)!.exchanged_value_pence, m.get(12)!.exchanged_value_pence, m.get(13)!.exchanged_value_pence,
    ]).toEqual([0, 26_000_000, 56_000_000, 77_000_000, 77_000_000, 94_500_000]);
    expect([
      m.get(11)!.completed_value_pence, m.get(12)!.completed_value_pence, m.get(13)!.completed_value_pence,
      m.get(19)!.completed_value_pence, m.get(20)!.completed_value_pence, m.get(23)!.completed_value_pence,
    ]).toEqual([0, 26_000_000, 73_500_000, 73_500_000, 94_500_000, 94_500_000]);
    const nonZero: Record<number, number> = {};
    for (const v of r.months) if (v.deposits_received_pence) nonZero[v.month] = v.deposits_received_pence;
    expect(nonZero).toEqual({ 8: 2_600_000, 10: 3_000_000, 11: 1_050_000 });
  });

  it('pre-sold uses the earliest practical_completion start', () => {
    expect(run(unitSalesDoc()).pre_sold).toEqual({
      reference_month: 12, basis: 'practical_completion', exchanged_value_pence: 77_000_000, pct: 81.48,
    });
  });

  it('pre-sold basis switches and the reference month moves', () => {
    // Same rows, no network: basis changes, reference month is the first completion.
    expect(run(noProgrammeDoc()).pre_sold).toEqual({
      reference_month: 12, basis: 'first_completion', exchanged_value_pence: 77_000_000, pct: 81.48,
    });
    // Same rows, PC at month 9: only u1 has exchanged by then.
    expect(run(pcEarlyDoc()).pre_sold).toEqual({
      reference_month: 9, basis: 'practical_completion', exchanged_value_pence: 26_000_000, pct: 27.51,
    });
  });

  it('null-legal residue is absorbed by the last null-legal row', () => {
    const r = run(residueDoc());
    expect(r.units.map((x) => x.legal_fee_pence)).toEqual([33, 33, 34]);
    expect(r.totals.legal_fees_pence).toBe(100);
  });

  it('all legal overrides set leaves the scheme fee unused', () => {
    const rows = ['u1', 'u2', 'u3', 'u4'].map((u) => ({
      unit_id: u, exchange: null, completion: { month_offset: 12, anchor: null },
      deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: 1_000,
    }));
    const r = run(unitSalesDoc({ rows }));
    expect(r.totals.legal_fees_pence).toBe(4_000); // not 500,000
  });

  it('deposit and agent scale with the unit gross', () => {
    // u3's 2.0% override on 17,500,000 = 350,000; u1's scheme 1.5% on 26,000,000
    // (parking included) = 390,000 -- the ancillary is inside the base.
    const r = run(unitSalesDoc());
    expect(row(r, 'u3').agent_fee_pence).toBe(350_000);
    expect(row(r, 'u1').agent_fee_pence).toBe(390_000);
  });

  it('completion month is clamped into the term', () => {
    const rows = [{
      unit_id: 'u1', exchange: null, completion: { month_offset: 40, anchor: null },
      deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null,
    }];
    const doc = unitSalesDoc({ rows });
    const r = computeUnitSales(doc, 24, anchorResolver(doc), [['u1', 26_000_000]])!;
    expect(r.units[0].completion_month).toBe(23); // validation owns the real rule
  });
});
