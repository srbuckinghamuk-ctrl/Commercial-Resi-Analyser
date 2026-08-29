import { describe, expect, it } from 'vitest';
import {
  curveWeights, spreadBackLoaded, spreadByCurve, spreadSCurve, spreadUserDefined,
} from './curves';

describe('spreadSCurve', () => {
  it('matches the hand-derived raised-cosine table for 60,000,000p over 6 months', () => {
    // W(k) = (1 − cos(πk/6))/2 — worksheet in test-cases.md (fixture H)
    expect(spreadSCurve(60_000_000, 6)).toEqual([
      4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238,
    ]);
  });
  it('sums exactly to the total for awkward amounts', () => {
    const out = spreadSCurve(999_999, 7);
    expect(out.reduce((a, b) => a + b, 0)).toBe(999_999);
    expect(out).toHaveLength(7);
  });
  it('degenerates to the whole total for a 1-month window', () => {
    expect(spreadSCurve(123_456, 1)).toEqual([123_456]);
  });
  it('returns [] for months <= 0', () => {
    expect(spreadSCurve(1000, 0)).toEqual([]);
  });
});

describe('spreadBackLoaded', () => {
  it('matches w_k = 2k/(D(D+1)): 3,000,000p over 2 months = [1,000,000, 2,000,000]', () => {
    expect(spreadBackLoaded(3_000_000, 2)).toEqual([1_000_000, 2_000_000]);
  });
  it('is non-decreasing and sums exactly', () => {
    const out = spreadBackLoaded(1_000_001, 5);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});

describe('spreadUserDefined', () => {
  it('normalises weights: [1, 3] over 40,000 = [10,000, 30,000]', () => {
    expect(spreadUserDefined(40_000, [1, 3])).toEqual([10_000, 30_000]);
  });
  it('zero-weight months get zero pence; final month still absorbs residue', () => {
    expect(spreadUserDefined(100, [0, 1, 2])).toEqual([0, 33, 67]);
  });

  // R16 minor: a zero weight sum used to divide by zero (NaN weights); it
  // must instead degrade to a uniform spread.
  it('a zero weight sum degrades to a uniform spread instead of dividing by zero', () => {
    expect(spreadUserDefined(90, [0, 0, 0])).toEqual([30, 30, 30]);
  });

  // R16 fix round 1: an empty weights array is n = 0, the degenerate case of
  // the zero-sum fallback — pinned here to hold the engines' parity that the
  // Python side's `[1 / n] * n` broke (it evaluates `1 / n` once for n = 0
  // before repeating it zero times, raising ZeroDivisionError). This
  // Array.from-based fallback never invokes its callback for length 0, so it
  // has always returned [] here; the test exists to keep it that way.
  it('an empty weights array returns [] rather than dividing by zero', () => {
    expect(spreadUserDefined(100, [])).toEqual([]);
  });
});

describe('spreadByCurve', () => {
  it('dispatches straight_line to the existing spreadStraightLine (identity-critical)', () => {
    // 100p over 3 months: Math.round(100/3)=33 per month, final absorbs → [33, 33, 34]
    expect(spreadByCurve(100, 3, { kind: 'straight_line' })).toEqual([33, 33, 34]);
  });
  it('dispatches s_curve / back_loaded / user_defined', () => {
    expect(spreadByCurve(3_000_000, 2, { kind: 'back_loaded' })).toEqual([1_000_000, 2_000_000]);
    expect(spreadByCurve(40_000, 2, { kind: 'user_defined', weights: [1, 3] })).toEqual([10_000, 30_000]);
    expect(spreadByCurve(60_000_000, 6, { kind: 's_curve' })[2]).toBe(15_000_000);
  });

  // CRITICAL 1c: durationMonths comes straight from a ProgrammePackage; a
  // fractional value must not reach spreadStraightLine's `new Array(months)`,
  // which throws RangeError for a non-integer length.
  it('floors a fractional duration instead of throwing (straight_line)', () => {
    expect(() => spreadByCurve(100, 2.9, { kind: 'straight_line' })).not.toThrow();
    expect(spreadByCurve(100, 2.9, { kind: 'straight_line' })).toEqual(spreadByCurve(100, 2, { kind: 'straight_line' }));
  });

  it('identity: an already-integer duration is unaffected by the floor', () => {
    expect(spreadByCurve(100, 3, { kind: 'straight_line' })).toEqual([33, 33, 34]);
  });
});

describe('curveWeights (R15b spec §24.2)', () => {
  it('back_loaded over 3 is 1/6, 2/6, 3/6', () => {
    expect(curveWeights(3, { kind: 'back_loaded' })).toEqual([1 / 6, 2 / 6, 3 / 6]);
  });
  it('straight_line over 4 is four quarters; user_defined normalises', () => {
    expect(curveWeights(4, { kind: 'straight_line' })).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(curveWeights(2, { kind: 'user_defined', weights: [1, 3] })).toEqual([0.25, 0.75]);
  });
  it('agrees with spreadByCurve on every non-final month (the spread is round(total × w_k))', () => {
    const w = curveWeights(5, { kind: 's_curve' });
    const s = spreadByCurve(1_000_003, 5, { kind: 's_curve' });
    for (let k = 0; k < 4; k++) expect(s[k]).toBe(Math.round(1_000_003 * w[k]));
    expect(s.reduce((a, b) => a + b, 0)).toBe(1_000_003);
  });
  it('a non-positive duration gives []', () => { expect(curveWeights(0, { kind: 'back_loaded' })).toEqual([]); });

  // R16 minor: a zero (or non-finite) weight sum must degrade to uniform
  // weights rather than dividing by zero / propagating NaN.
  it('a zero weight sum degrades to uniform weights', () => {
    expect(curveWeights(3, { kind: 'user_defined', weights: [0, 0, 0] })).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('a non-finite weight sum degrades to uniform weights', () => {
    expect(curveWeights(2, { kind: 'user_defined', weights: [1, NaN] })).toEqual([0.5, 0.5]);
  });

  // R16 fix round 1: an empty weights array on a positive duration bypasses
  // curveWeights' own months <= 0 guard (durationMonths is 3 here, not 0)
  // and reaches the user_defined case with n = 0 — the degenerate case of
  // the zero-sum fallback. Pinned to hold parity with the Python fix.
  it('an empty weights array on a positive duration gives []', () => {
    expect(curveWeights(3, { kind: 'user_defined', weights: [] })).toEqual([]);
  });
});
