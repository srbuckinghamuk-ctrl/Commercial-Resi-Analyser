import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TAX_TABLES, TAX_TABLE_VERSION, calculateAcquisitionTax, selectBandSet,
  deriveJurisdiction, regimeFor,
} from './acquisition-tax';
import type { Jurisdiction, TaxBasis } from './acquisition-tax';

// The audited York consideration (R7: 9 & 9A Stonegate, £753,482) and a price
// above Wales's £1m 6% threshold, so the table is exercised on both sides of
// the point where LTT overtakes SDLT.
const YORK = 75_348_200;
const TWO_MILLION = 200_000_000;

describe('non-residential acquisition tax by jurisdiction', () => {
  const cases: Array<[Jurisdiction, number, number]> = [
    ['england_ni', YORK, 2_717_410],
    ['scotland', YORK, 2_617_410],
    ['wales', YORK, 2_542_410],
    ['england_ni', TWO_MILLION, 8_950_000],
    ['scotland', TWO_MILLION, 8_850_000],
    ['wales', TWO_MILLION, 9_775_000],
  ];

  it.each(cases)('%s at %ip is %ip', (jurisdiction, price, expected) => {
    const r = calculateAcquisitionTax({
      consideration_pence: price, jurisdiction,
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.total_pence).toBe(expected);
  });

  // GOV.UK's own worked example: £275,000 freehold commercial → £3,250.
  it('reproduces the GOV.UK worked example', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: 27_500_000, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.total_pence).toBe(325_000);
  });

  it('taxes nothing at or below the nil-rate threshold and one penny above it', () => {
    const at = calculateAcquisitionTax({
      consideration_pence: 15_000_000, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(at.total_pence).toBe(0);
    const above = calculateAcquisitionTax({
      consideration_pence: 15_000_001, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(above.total_pence).toBe(0); // 1p at 2% rounds to 0p
    const clear = calculateAcquisitionTax({
      consideration_pence: 15_002_500, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(clear.total_pence).toBe(50);
  });

  it('returns zero for zero and negative consideration', () => {
    for (const p of [0, -1]) {
      const r = calculateAcquisitionTax({
        consideration_pence: p, jurisdiction: 'england_ni',
        basis: 'non_residential', date: '2026-08-17',
      });
      expect(r.total_pence).toBe(0);
      expect(r.effective_rate_pct).toBe(0);
    }
  });
});

describe('residential higher rates', () => {
  // England: bands to 2,767,410p plus a 5% supplement on the whole 75,348,200p.
  it('adds England’s flat supplement on the whole consideration', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'residential_higher', date: '2026-08-17',
    });
    expect(r.surcharge_pence).toBe(3_767_410);
    expect(r.total_pence).toBe(6_534_820);
  });

  it('applies no supplement in Wales — the uplift is inside the bands', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'wales',
      basis: 'residential_higher', date: '2026-08-17',
    });
    expect(r.surcharge_pence).toBe(0);
  });
});

describe('band set selection', () => {
  it('names the regime for each jurisdiction', () => {
    expect(regimeFor('england_ni')).toBe('SDLT');
    expect(regimeFor('scotland')).toBe('LBTT');
    expect(regimeFor('wales')).toBe('LTT');
  });

  it('marks a null date as an assumed-current basis rather than failing', () => {
    const { dateBasis, set } = selectBandSet('scotland', 'non_residential', null);
    expect(dateBasis).toBe('assumed_current');
    expect(set.effective_to).toBeNull();
  });

  it('throws for a date no band set covers, naming the earliest covered date', () => {
    expect(() => selectBandSet('wales', 'non_residential', '1990-01-01'))
      .toThrow(/1990-01-01.*2020-12-22/);
  });

  it('has contiguous, non-overlapping windows in every group', () => {
    const groups = new Map<string, typeof TAX_TABLES>();
    for (const s of TAX_TABLES) {
      const key = `${s.jurisdiction}|${s.basis}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    expect(groups.size).toBe(6); // 3 jurisdictions x 2 bases
    for (const [key, sets] of groups) {
      const sorted = [...sets].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].effective_to, `${key} set ${i} must close`).toBe(sorted[i + 1].effective_from);
      }
      expect(sorted[sorted.length - 1].effective_to, `${key} must end open`).toBeNull();
    }
  });

  it('orders every band set ascending and leaves the top band unbounded', () => {
    for (const s of TAX_TABLES) {
      const tops = s.bands.map((b) => b.up_to_pence);
      expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      expect(tops[tops.length - 1]).toBe(Infinity);
    }
  });
});

describe('override', () => {
  it('replaces the total, preserves the computed figure, and records the reason', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
      override_pence: 1_000_000, override_reason: 'Group relief claimed (FA2003 Sch 7).',
    });
    expect(r.total_pence).toBe(1_000_000);
    expect(r.is_override).toBe(true);
    expect(r.computed_total_pence).toBe(2_717_410);
    expect(r.override_reason).toBe('Group relief claimed (FA2003 Sch 7).');
  });

  it('reports no override when none is supplied', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.is_override).toBe(false);
    expect(r.computed_total_pence).toBeNull();
  });
});

describe('jurisdiction derivation', () => {
  it.each([
    ['England', 'england_ni'], ['Northern Ireland', 'england_ni'],
    ['Scotland', 'scotland'], ['Wales', 'wales'],
  ])('maps %s to %s', (country, expected) => {
    expect(deriveJurisdiction(country)).toBe(expected);
  });

  it('returns null for an unknown, empty or absent country', () => {
    for (const c of ['Isle of Man', '', null, undefined]) {
      expect(deriveJurisdiction(c)).toBeNull();
    }
  });
});

describe('parity with the normative table', () => {
  it('matches fixtures/tax/acquisition-tax-tables.json field for field', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/tax/acquisition-tax-tables.json'), 'utf-8'),
    );
    expect(raw.table_version).toBe(TAX_TABLE_VERSION);
    // JSON cannot hold Infinity, so an unbounded top band is encoded as null.
    // Map in one direction only, and assert the count, so a genuinely missing
    // value cannot pass as unbounded.
    const normalised = raw.band_sets.map((s: Record<string, unknown>) => ({
      ...s,
      bands: (s.bands as Array<{ up_to_pence: number | null; rate_pct: number }>).map((b) => ({
        up_to_pence: b.up_to_pence === null ? Infinity : b.up_to_pence,
        rate_pct: b.rate_pct,
      })),
    }));
    expect(normalised).toEqual(TAX_TABLES);
    const nullTops = raw.band_sets.filter(
      (s: { bands: Array<{ up_to_pence: number | null }> }) =>
        s.bands.filter((b) => b.up_to_pence === null).length === 1,
    );
    expect(nullTops.length).toBe(raw.band_sets.length);
  });
});
