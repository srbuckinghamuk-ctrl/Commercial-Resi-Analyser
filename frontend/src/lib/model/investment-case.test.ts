import { describe, it, expect } from 'vitest';
import {
  occupancyPctAt, grossPotentialMonthlyPence, operatingCostAt,
  noiSeries, stabilisedAnnualNoiPence, OPEX_CODES,
  annualDebtServiceFactor, investmentValuePence, sizeTakeout,
} from './investment-case';
import type { OperatingLine, TakeoutInputs } from './investment-case';

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

describe('grossPotentialMonthlyPence (§19.2)', () => {
  it('sums the retained rent roll', () => {
    expect(grossPotentialMonthlyPence([
      { monthly_rent_pence: 140_000 },
      { monthly_rent_pence: 155_000 },
    ])).toBe(295_000);
  });

  it('is zero for an empty rent roll', () => {
    expect(grossPotentialMonthlyPence([])).toBe(0);
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

  it('R13 fix-wave Minor 7: rounds a non-integer fixed-pence value half-up, matching the Python engine', () => {
    // `value` carries no integer constraint (§19.1) and validation permits a
    // non-integer fixed-pence line. The identical assertion (money_round, not
    // int()-truncation) lives in test_financial_model_investment_case.py.
    const fractional: OperatingLine[] = [
      { id: 'l1', code: 'insurance', label: 'Insurance', basis: 'fixed_pence_per_month', value: 25_000.5 },
    ];
    expect(operatingCostAt(fractional, 500_000)).toBe(25_001);
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

const IO: TakeoutInputs = {
  ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3,
  annual_rate_pct: 6, amortisation_years: null, term_years: 5,
};

describe('annualDebtServiceFactor (§19.4)', () => {
  it('is the bare rate on an interest-only take-out', () => {
    expect(annualDebtServiceFactor(IO)).toBeCloseTo(0.06, 12);
  });

  it('exceeds the rate once there is amortisation', () => {
    const a = annualDebtServiceFactor({ ...IO, amortisation_years: 25 });
    expect(a).toBeGreaterThan(0.06);
    // 6% over 25 years: monthly i = 0.005, N = 300 -> annual constant ~0.077322
    expect(a).toBeCloseTo(0.0773, 4);
  });

  it('handles a zero rate with amortisation as straight-line repayment', () => {
    // No interest: the whole principal amortises over N months, so the annual
    // constant is 12/N. Without this arm the annuity formula divides by zero.
    expect(annualDebtServiceFactor({ ...IO, annual_rate_pct: 0, amortisation_years: 10 }))
      .toBeCloseTo(12 / 120, 12);
  });
});

describe('investmentValuePence (§19.3)', () => {
  it('capitalises at the yield and deducts purchaser\'s costs in ONE rounding', () => {
    // 4_020_000 * 100 / 5.5 = 73_090_909.09; / 1.0675 = 68_469_235.68
    expect(investmentValuePence(4_020_000, 5.5, 6.75)).toBe(68_469_236);
  });

  it('is zero for a non-positive NOI', () => {
    expect(investmentValuePence(0, 5.5, 6.75)).toBe(0);
    expect(investmentValuePence(-1_000, 5.5, 6.75)).toBe(0);
  });
});

describe('sizeTakeout (§19.4)', () => {
  it('names LTV when the value cap is the tightest, and publishes all three', () => {
    // NOI 500_000/yr, value 20_000_000. LTV 65% -> 13_000_000.
    // DSCR: 500_000 / (1.3 × 0.06) = 6_410_256 -> DSCR binds, so raise NOI
    // instead: NOI 2_000_000 -> DSCR cap 25_641_025, ICR the same (interest-only).
    const s = sizeTakeout(2_000_000, 20_000_000, IO);
    expect(s.ltv_cap_pence).toBe(13_000_000);
    expect(s.dscr_cap_pence).toBe(25_641_025);
    expect(s.icr_cap_pence).toBe(25_641_025);
    expect(s.quantum_pence).toBe(13_000_000);
    expect(s.binding_constraint).toBe('ltv');
  });

  it('names DSCR when coverage is the tightest', () => {
    const s = sizeTakeout(500_000, 20_000_000, IO);
    expect(s.quantum_pence).toBe(6_410_256);
    expect(s.binding_constraint).toBe('dscr');
    expect(s.quantum_pence).toBeLessThan(s.ltv_cap_pence);
  });

  it('separates DSCR from ICR exactly when there is amortisation', () => {
    const amortising = { ...IO, amortisation_years: 25 };
    const io = sizeTakeout(500_000, 20_000_000, IO);
    expect(io.dscr_cap_pence).toBe(io.icr_cap_pence);

    const am = sizeTakeout(500_000, 20_000_000, amortising);
    expect(am.dscr_cap_pence).toBeLessThan(am.icr_cap_pence!);
    expect(am.binding_constraint).toBe('dscr');
  });

  it('floors every cap — a cap rounded up is a cap breached', () => {
    // The numerator is chosen so the fractional part EXCEEDS 0.5, which is the
    // only way this test can tell flooring from rounding:
    //   1_000_006 / (1 × 0.06) = 16_666_766.67
    //   floor -> 16_666_766      round-half-up -> 16_666_767
    // An earlier draft used 1_000_001, whose .333 fraction rounds DOWN anyway,
    // so the test named for this property proved nothing about it.
    const s = sizeTakeout(1_000_006, 999_999_999_999, {
      ...IO, dscr_floor: 1, icr_floor: 1, ltv_cap_pct: 100,
    });
    expect(s.dscr_cap_pence).toBe(16_666_766);
  });

  it('drops the coverage caps out of the minimum at a zero rate', () => {
    const s = sizeTakeout(500_000, 20_000_000, { ...IO, annual_rate_pct: 0 });
    expect(s.dscr_cap_pence).toBeNull();
    expect(s.icr_cap_pence).toBeNull();
    expect(s.binding_constraint).toBe('ltv');
    expect(s.quantum_pence).toBe(13_000_000);
  });

  it('reports the binding ratio as AT LEAST its floor, never below it', () => {
    const s = sizeTakeout(500_000, 20_000_000, IO);
    expect(s.achieved_dscr).toBeGreaterThanOrEqual(IO.dscr_floor);
    // Better than the floor by less than one pence of debt — the floor rounding
    // is the only reason it is not exact.
    expect(s.achieved_dscr!).toBeLessThan(
      500_000 / ((s.quantum_pence) * 0.06) + 1e-6,
    );
  });

  it('sizes to nothing on a non-positive NOI and names no constraint', () => {
    const s = sizeTakeout(0, 0, IO);
    expect(s.quantum_pence).toBe(0);
    expect(s.binding_constraint).toBeNull();
    expect(s.achieved_ltv_pct).toBeNull();
  });

  it('agrees with the Python engine on the pinned triple', () => {
    // The identical assertion lives in tests/test_financial_model_investment_case.py.
    // If you change one of these numbers, change both files or the engines have diverged.
    // NOTE: the LTV cap here (30_539_731) was hand-derived independently of the
    // task brief's draft figure. floor(46_984_203 * 65 / 100) = floor(30_539_731.95)
    // = 30_539_731 -- the brief's draft (30_540_036) did not reconcile by hand and
    // has been corrected in both engines' tests.
    const noi = stabilisedAnnualNoiPence({
      termMonths: 24, stabilisationMonth: 0, rampMonths: 0,
      stabilisedOccupancyPct: 96, grossPotentialMonthlyPence: 295_000, lines: LINES,
    });
    expect(noi).toBe(2_758_560);
    const value = investmentValuePence(noi, 5.5, 6.75);
    expect(value).toBe(46_984_203);
    const s = sizeTakeout(noi, value, { ...IO, amortisation_years: 25 });
    expect(s.binding_constraint).toBe('dscr');
    expect(s.ltv_cap_pence).toBe(30_539_731);
    expect(s.icr_cap_pence).toBe(35_366_153);
    // R13 fix-wave Minor 5. This is the binding cap -- the only figure a
    // lender actually sizes against -- so it is pinned to the pence rather
    // than banded. Hand-derived from a = 12 x i/(1-(1+i)^-300), i = 0.005,
    // N = 300: a = 0.07731616817826173 (float64). floor(2_758_560 /
    // (1.3 x a)) = floor(27_445_349.152...) = 27_445_349. This sits inside
    // the former 27_400_000..27_500_000 band, so the band was correct; it is
    // now redundant with the exact pin and removed.
    expect(s.dscr_cap_pence).toBe(27_445_349);
    expect(s.quantum_pence).toBe(s.dscr_cap_pence);
  });
});
