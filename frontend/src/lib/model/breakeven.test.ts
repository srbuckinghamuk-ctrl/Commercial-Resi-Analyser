import { describe, it, expect } from 'vitest';
import { solveSeniorBreakeven } from './breakeven';
import type { SeniorBreakevenTerms } from './breakeven';

function terms(partial: Partial<SeniorBreakevenTerms>): SeniorBreakevenTerms {
  return {
    redemption_balance_pence: 0,
    exit_fee_pence: 0,
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    enforcement_cost_assumption_pence: 0,
    ...partial,
  };
}

describe('solveSeniorBreakeven (spec §5.11)', () => {
  it('fixture G worksheet: redemption 58,604,953 + exit fee 660,000 + 1.5% agent + £4,000 legal → 60,573,556', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 58_604_953,
      exit_fee_pence: 660_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
      enforcement_cost_assumption_pence: 0,
    }));
    expect(p).toBe(60_573_556);
    // Hand-checked boundary (docs/financial-model/test-cases.md): 60,573,555 is infeasible
    // because round(0.015 × 60,573,555) = 908,603 leaves the fee-sum unchanged at
    // 60,573,556, one penny above the candidate itself.
    const feeFloor = 58_604_953 + 660_000 + 400_000;
    expect(feeFloor + Math.round((60_573_555 * 1.5) / 100)).toBe(60_573_556);
    expect(60_573_555).toBeLessThan(60_573_556);
  });

  it('zero agent pct → exact sum of redemption, exit fee, legal and enforcement', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 10_000_000,
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 0,
      selling_legal_fee_pence: 400_000,
      enforcement_cost_assumption_pence: 50_000,
    }));
    expect(p).toBe(10_000_000 + 100_000 + 400_000 + 50_000);
  });

  it('agent fee ≥ 100% is unsolvable — returns null', () => {
    expect(solveSeniorBreakeven(terms({ redemption_balance_pence: 1_000_000, selling_agent_fee_pct: 100 }))).toBeNull();
    expect(solveSeniorBreakeven(terms({ redemption_balance_pence: 1_000_000, selling_agent_fee_pct: 150 }))).toBeNull();
  });

  it('zero redemption balance (facility already discharged) still solves to the fixed-cost sum', () => {
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 400_000, selling_agent_fee_pct: 1.5 }));
    // feeFloor = 400,000; hi-guess ~ 406,091; hand-check: P=406,091 → round(1.5%×406,091)=6,091 → 406,091 (feasible)
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThanOrEqual(400_000);
    const disposalCost = Math.round((p! * 1.5) / 100);
    expect(p!).toBeGreaterThanOrEqual(400_000 + disposalCost);
  });

  it('rounds the agent fee half-up, not down — off-by-one boundary case', () => {
    // feeFloor = 1, pct = 50%. At P=1: 0.5 rounds half-up to 1 -> 1 >= 1+1=2 is false
    // (infeasible). At P=2: 1.0 rounds to 1 -> 2 >= 1+1=2 is true (feasible). A
    // round-down (floor) implementation would wrongly accept P=1 as feasible.
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 1, selling_agent_fee_pct: 50 }));
    expect(p).toBe(2);
  });

  it('regression: converges to the exact integer for a large deal that a 32-bit `>>1` midpoint ' +
    'used to break (fixed — see docs/financial-model/test-cases.md)', () => {
    // Historical bug (fixed in the same change that added this regression test): the
    // midpoint used to be computed as `(lo + hi) >> 1`, which coerces to a 32-bit signed
    // integer in JS. For a redemption balance at or above 2^31 pence (~£21.47m — a
    // realistic scale for a large commercial deal), the closed-form `hi` exceeded the safe
    // 32-bit range and the bit-shift corrupted `mid`, exhausting the 200-iteration cap and
    // returning null for a genuinely solvable deal. `mid` is now `Math.floor((lo+hi)/2)`,
    // which has no such ceiling. Closed-form worksheet: fee_floor = 5,000,000,000 +
    // 100,000 + 400,000 = 5,000,500,000; guess = 5,000,500,000 / 0.985 =
    // 5,076,649,746.19…; hand-checked boundary — at P=5,076,649,745,
    // round(1.5% × P) = 76,149,746, RHS = 5,076,649,746, P < RHS (infeasible); at
    // P=5,076,649,746, round(1.5% × P) = 76,149,746, RHS = 5,076,649,746, P >= RHS
    // (feasible, equality) — minimum feasible P = 5,076,649,746. Python's `//2` midpoint
    // (which never had the 32-bit issue) converges to the identical integer — see
    // tests/test_financial_model_breakeven.py's matching regression test; both languages
    // must agree exactly.
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 5_000_000_000,
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBe(5_076_649_746);
    const feeFloor = 5_000_000_000 + 100_000 + 400_000;
    expect(feeFloor + Math.round((5_076_649_745 * 1.5) / 100)).toBe(5_076_649_746);
    expect(5_076_649_745).toBeLessThan(5_076_649_746);
  });

  it('converges correctly for realistic large deals', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 500_000_000, // £5m senior balance
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).not.toBeNull();
    const disposalCost = Math.round((p! * 1.5) / 100);
    expect(p!).toBeGreaterThanOrEqual(500_000_000 + 100_000 + disposalCost + 400_000);
  });

  it('iteration-cap guard: returns null rather than a wrong number when the search genuinely ' +
    'cannot converge within 200 steps', () => {
    // `Math.floor((lo+hi)/2)` has no 32-bit ceiling, but IEEE-754 double precision still
    // bounds how many meaningful bisection steps are possible: at an astronomic fee floor
    // (10^80 — far beyond any real financial figure), the ~266 steps needed
    // (log2(10^80) ≈ 265.75) genuinely exceed the 200-iteration cap, which correctly
    // returns null (never a partially-bisected, wrong number) rather than looping forever
    // or silently returning early. Mirrors the Python regression
    // (test_iteration_cap_guard_genuinely_reachable_at_extreme_magnitude) at the same
    // magnitude.
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 1e80, selling_agent_fee_pct: 50 }));
    expect(p).toBeNull();
  });
});
