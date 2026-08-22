import { describe, it, expect } from 'vitest';
import {
  occupancyPctAt, operatingCostAt,
  noiSeries, stabilisedAnnualNoiPence, OPEX_CODES,
} from './investment-case';
import type { OperatingLine } from './investment-case';

const LINES: OperatingLine[] = [
  { id: 'l1', code: 'management', label: 'Management', basis: 'pct_of_gross_rent', value: 10 },
  { id: 'l2', code: 'insurance', label: 'Insurance', basis: 'fixed_pence_per_month', value: 25_000 },
];

describe('occupancyPctAt (§19.2)', () => {
  it('is zero before the stabilisation month', () => {
    expect(occupancyPctAt(2, 3, 3, 96)).toBe(0);
  });

  it('ramps to the stabilised figure in the FINAL ramp month, not the month after', () => {
    // R = 3, U = 96: months 3,4,5 -> 32, 64, 96. Month 5 is s + R - 1.
    expect(occupancyPctAt(3, 3, 3, 96)).toBeCloseTo(32, 9);
    expect(occupancyPctAt(4, 3, 3, 96)).toBeCloseTo(64, 9);
    expect(occupancyPctAt(5, 3, 3, 96)).toBeCloseTo(96, 9);
    expect(occupancyPctAt(6, 3, 3, 96)).toBeCloseTo(96, 9);
  });

  it('with ramp_months = 0 is stabilised from the stabilisation month itself', () => {
    expect(occupancyPctAt(3, 3, 0, 96)).toBeCloseTo(96, 9);
    expect(occupancyPctAt(2, 3, 0, 96)).toBe(0);
  });
});

describe('operatingCostAt (§19.2)', () => {
  it('charges a percentage line on the EFFECTIVE gross rent, not potential rent', () => {
    // 10% of 500_000 = 50_000, plus the 25_000 fixed line.
    expect(operatingCostAt(LINES, 500_000)).toBe(75_000);
    // Half-occupied: the percentage line halves, the fixed line does not.
    expect(operatingCostAt(LINES, 250_000)).toBe(50_000);
  });

  it('is zero for an empty line schedule', () => {
    expect(operatingCostAt([], 500_000)).toBe(0);
  });
});

describe('noiSeries (§19.2)', () => {
  const args = {
    termMonths: 8,
    stabilisationMonth: 3,
    rampMonths: 2,
    stabilisedOccupancyPct: 100,
    grossPotentialMonthlyPence: 400_000,
    lines: LINES,
  };

  it('books nothing before stabilisation and the full figure after the ramp', () => {
    const s = noiSeries(args);
    expect(s).toHaveLength(8);
    expect(s[2]).toEqual({
      month: 2, occupancy_pct: 0, gross_potential_rent_pence: 400_000,
      effective_gross_rent_pence: 0, operating_cost_pence: 0, noi_pence: 0,
    });
    // month 3: 50% of 400_000 = 200_000 egr; opex = 20_000 + 25_000
    expect(s[3].effective_gross_rent_pence).toBe(200_000);
    expect(s[3].operating_cost_pence).toBe(45_000);
    expect(s[3].noi_pence).toBe(155_000);
    // month 4 onward: full 400_000; opex = 40_000 + 25_000
    expect(s[4].noi_pence).toBe(335_000);
    expect(s[7].noi_pence).toBe(335_000);
  });

  it('produces a SIGNED negative NOI when operating costs exceed rent', () => {
    const s = noiSeries({
      ...args, rampMonths: 0, grossPotentialMonthlyPence: 20_000,
    });
    // egr 20_000, opex = 2_000 + 25_000 = 27_000
    expect(s[3].noi_pence).toBe(-7_000);
  });
});

describe('stabilisedAnnualNoiPence (§19.2)', () => {
  it('is twelve times the STABILISED month, never the sum of the first twelve actual months', () => {
    const args = {
      termMonths: 24, stabilisationMonth: 3, rampMonths: 6,
      stabilisedOccupancyPct: 100, grossPotentialMonthlyPence: 400_000, lines: LINES,
    };
    const stabilised = stabilisedAnnualNoiPence(args);
    expect(stabilised).toBe(12 * 335_000);

    // The ramp makes the first twelve months materially lower. If the
    // implementation ever averages the series instead, this diverges — which is
    // the whole point of asserting both.
    const firstTwelve = noiSeries(args).slice(0, 12)
      .reduce((sum, m) => sum + m.noi_pence, 0);
    expect(firstTwelve).toBeLessThan(stabilised);
  });
});

describe('OPEX_CODES', () => {
  it('holds the ten §19.1 codes', () => {
    expect(OPEX_CODES).toEqual([
      'management', 'letting_and_re_letting', 'insurance',
      'repairs_and_maintenance', 'service_charge_shortfall', 'ground_rent',
      'utilities_on_voids', 'compliance_and_safety', 'bad_debt', 'other',
    ]);
  });
});
